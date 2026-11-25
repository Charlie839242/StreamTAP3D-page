(() => {
    "use strict";

    // ---------------------------------------------------------------------
    // Playback: only one video plays at a time.
    //  - Starting any video (autoplay, controls, hover, lightbox) pauses all others.
    //  - Autoplay picks the visible video closest to the viewport center.
    //  - A video the user started stays active until it scrolls out of view.
    // ---------------------------------------------------------------------
    const autoVideos = document.querySelectorAll("video[data-autoplay]");
    const ratios = new Map();
    let autoTarget = null;  // video most recently started by autoplay
    let pinned = null;      // video the user explicitly started
    let lightboxOpen = false;

    const load = (v) => {
        if (!v.getAttribute("src") && v.dataset.src) v.src = v.dataset.src;
    };

    const pauseOthers = (keep) => {
        document.querySelectorAll("video").forEach((v) => {
            if (v !== keep && !v.paused) v.pause();
        });
    };

    // "play" does not bubble, so listen in the capture phase.
    document.addEventListener("play", (e) => {
        const v = e.target;
        if (!(v instanceof HTMLVideoElement)) return;
        if (v !== autoTarget) pinned = v;
        pauseOthers(v);
    }, true);

    const pick = () => {
        if (lightboxOpen) return;
        if (pinned && (ratios.get(pinned) || 0) >= 0.25) return;
        pinned = null;

        let best = null;
        let bestDist = Infinity;
        const mid = window.innerHeight / 2;
        ratios.forEach((r, v) => {
            if (r < 0.5) return;
            const b = v.getBoundingClientRect();
            const d = Math.abs(b.top + b.height / 2 - mid);
            if (d < bestDist) { bestDist = d; best = v; }
        });

        if (!best) { pauseOthers(null); return; }
        if (best === autoTarget && !best.paused) return;
        autoTarget = best;
        load(best);
        best.play().catch(() => {});
    };

    let pickQueued = false;
    const schedulePick = () => {
        if (pickQueued) return;
        pickQueued = true;
        requestAnimationFrame(() => { pickQueued = false; pick(); });
    };

    const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => ratios.set(e.target, e.isIntersecting ? e.intersectionRatio : 0));
        schedulePick();
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] });

    autoVideos.forEach((v) => io.observe(v));
    window.addEventListener("scroll", schedulePick, { passive: true });

    // Hovering a carousel clip plays that clip instead.
    document.querySelectorAll(".clip-rail video").forEach((v) => {
        v.closest(".clip-media").addEventListener("mouseenter", () => {
            load(v);
            v.play().catch(() => {});
        });
    });

    // ---------------------------------------------------------------------
    // Carousel: prev/next buttons, page dots, counter.
    // ---------------------------------------------------------------------
    document.querySelectorAll("[data-carousel]").forEach((root) => {
        const rail = root.querySelector("[data-rail]");
        const prev = root.querySelector("[data-rail-prev]");
        const next = root.querySelector("[data-rail-next]");
        const dots = root.querySelector("[data-rail-dots]");
        const count = root.querySelector("[data-rail-count]");

        // One page = rail width + the column gap between pages.
        const gap = () => parseFloat(getComputedStyle(rail).columnGap) || 0;
        const stride = () => rail.clientWidth + gap();
        const pages = () => Math.max(1, Math.round((rail.scrollWidth + gap()) / stride()));
        const current = () => Math.round(rail.scrollLeft / stride());
        const goTo = (i) => rail.scrollTo({ left: i * stride(), behavior: "smooth" });

        const buildDots = () => {
            dots.innerHTML = "";
            for (let i = 0; i < pages(); i++) {
                const b = document.createElement("button");
                b.type = "button";
                b.setAttribute("role", "tab");
                b.setAttribute("aria-label", `Page ${i + 1}`);
                b.addEventListener("click", () => goTo(i));
                dots.appendChild(b);
            }
            update();
        };

        const update = () => {
            const n = pages();
            const c = Math.min(current(), n - 1);
            dots.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-selected", String(i === c)));
            if (count) count.textContent = `${c + 1} / ${n}`;
            if (prev) prev.disabled = c <= 0;
            if (next) next.disabled = c >= n - 1;
        };

        prev?.addEventListener("click", () => goTo(current() - 1));
        next?.addEventListener("click", () => goTo(current() + 1));
        rail.addEventListener("scroll", () => requestAnimationFrame(update), { passive: true });
        rail.addEventListener("keydown", (e) => {
            if (e.key === "ArrowRight") { e.preventDefault(); goTo(current() + 1); }
            if (e.key === "ArrowLeft") { e.preventDefault(); goTo(current() - 1); }
        });
        window.addEventListener("resize", buildDots);
        buildDots();
    });

    // ---------------------------------------------------------------------
    // Playback-speed buttons (1x / 2x / 4x) overlaid on each video.
    // ---------------------------------------------------------------------
    // Browsers reset playbackRate when the source changes, so the chosen rate
    // is kept in data-rate and re-applied whenever new media loads.
    const setRate = (v, rate) => {
        v.dataset.rate = rate;
        v.defaultPlaybackRate = rate;
        v.playbackRate = rate;
        const ctl = v.parentElement.querySelector(".speed");
        if (!ctl) return;
        ctl.classList.toggle("is-changed", rate !== 1);
        ctl.querySelectorAll("button").forEach((b) => {
            b.setAttribute("aria-pressed", String(+b.dataset.rate === rate));
        });
    };

    const addSpeed = (container, rates, position) => {
        const v = container.querySelector("video");
        const ctl = document.createElement("div");
        ctl.className = `speed speed-${position}`;
        ctl.setAttribute("role", "group");
        ctl.setAttribute("aria-label", "Playback speed");
        rates.forEach((r) => {
            const b = document.createElement("button");
            b.type = "button";
            b.dataset.rate = r;
            b.textContent = `${r}\u00d7`;
            b.setAttribute("aria-label", `Play at ${r}x speed`);
            b.addEventListener("click", (e) => {
                e.stopPropagation();  // don't open the lightbox
                setRate(v, r);
            });
            ctl.appendChild(b);
        });
        container.appendChild(ctl);
        v.addEventListener("loadedmetadata", () => setRate(v, +(v.dataset.rate || 1)));
        setRate(v, 1);
    };

    document.querySelectorAll(".clip-rail:not(.is-single) .clip-media").forEach((c) => addSpeed(c, [1, 2], "bottom"));
    document.querySelectorAll(".player-media, .clip-media.is-live").forEach((c) => addSpeed(c, [1, 2, 4], "top"));
    addSpeed(document.querySelector(".lightbox-media"), [1, 2], "top");

    // ---------------------------------------------------------------------
    // Long-video player with thumbnail selector.
    // ---------------------------------------------------------------------
    // The video itself is lazy-loaded / autoplayed by the playback logic above.
    document.querySelectorAll("[data-player]").forEach((root) => {
        const video = root.querySelector("[data-player-video]");
        const thumbs = root.querySelectorAll(".thumb");

        const select = (t, play) => {
            thumbs.forEach((x) => x.classList.toggle("is-active", x === t));
            video.poster = t.dataset.poster;
            video.dataset.src = t.dataset.video;
            if (play) {
                video.src = t.dataset.video;
                video.play().catch(() => {});
            }
        };

        thumbs.forEach((t) => t.addEventListener("click", () => select(t, true)));
        select(thumbs[0], false);
    });

    // ---------------------------------------------------------------------
    // Lightbox for carousel clips.
    // ---------------------------------------------------------------------
    const lb = document.getElementById("lightbox");
    const lbVideo = document.getElementById("lightboxVideo");
    const lbCaption = document.getElementById("lightboxCaption");

    let lbSource = null;  // carousel video the lightbox was opened from

    const openLb = (v, caption) => {
        lbSource = v;
        lbVideo.dataset.rate = v.dataset.rate || 1;
        lbVideo.src = v.dataset.src;
        lbCaption.textContent = caption || "";
        lb.classList.add("is-open");
        lb.setAttribute("aria-hidden", "false");
        lightboxOpen = true;
        lbVideo.play().catch(() => {});
    };
    const closeLb = () => {
        lb.classList.remove("is-open");
        lb.setAttribute("aria-hidden", "true");
        lbVideo.pause();
        if (lbSource) setRate(lbSource, +lbVideo.dataset.rate);  // keep speed chosen in the lightbox
        lbSource = null;
        lbVideo.removeAttribute("src");
        lbVideo.load();
        lightboxOpen = false;
        pinned = null;
        schedulePick();
    };

    // Live demos have their own controls, so they are not opened in the lightbox.
    document.querySelectorAll(".clip-rail:not(.is-single) .clip").forEach((fig) => {
        fig.querySelector(".clip-media").addEventListener("click", () => {
            const v = fig.querySelector("video");
            openLb(v, fig.querySelector("figcaption")?.textContent);
        });
    });
    lb.addEventListener("click", (e) => { if (e.target === lb || e.target.closest(".lightbox-close")) closeLb(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && lb.classList.contains("is-open")) closeLb(); });

    // ---------------------------------------------------------------------
    // Copy BibTeX.
    // ---------------------------------------------------------------------
    document.querySelectorAll("[data-copy]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const text = btn.parentElement.querySelector("pre").textContent;
            navigator.clipboard?.writeText(text).then(() => {
                btn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-check"/></svg>';
                setTimeout(() => { btn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-copy"/></svg>'; }, 1500);
            });
        });
    });
})();
