(() => {
    "use strict";

    // ---------------------------------------------------------------------
    // Playback: only one video plays at a time.
    //  - Starting any video (autoplay, controls, hover) pauses all others.
    //  - Autoplay picks the visible video closest to the viewport center.
    //  - A video the user started stays active until it scrolls out of view.
    // ---------------------------------------------------------------------
    const autoVideos = document.querySelectorAll("video[data-autoplay]");
    const ratios = new Map();
    let autoTarget = null;  // video most recently started by autoplay
    let pinned = null;      // video the user explicitly started

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

    // Hovering a carousel clip (real-time demos) plays that clip instead.
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
    // Playback-speed buttons overlaid on each video.
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
            b.addEventListener("click", () => setRate(v, r));
            ctl.appendChild(b);
        });
        container.appendChild(ctl);
        v.addEventListener("loadedmetadata", () => setRate(v, +(v.dataset.rate || 1)));
        setRate(v, 1);
    };

    // Real-world clips are only a few seconds long, so slow motion is offered instead of 4x.
    document.querySelectorAll("[data-autoadvance] .player-media").forEach((c) => addSpeed(c, [0.5, 1, 2], "top"));
    document.querySelectorAll("[data-player]:not([data-autoadvance]) .player-media, .clip-media.is-live").forEach((c) => addSpeed(c, [1, 2, 4], "top"));

    // ---------------------------------------------------------------------
    // Player with thumbnail selector (real-world clips and long videos).
    // ---------------------------------------------------------------------
    // The video itself is lazy-loaded / autoplayed by the playback logic above.
    // With data-autoadvance="N", each clip plays N times before moving on to the
    // next thumbnail; once the user picks a clip, that clip just loops.
    // Prev/next "peek" panels beside the video show part of the neighbouring clips.
    document.querySelectorAll("[data-player]").forEach((root) => {
        const video = root.querySelector("[data-player-video]");
        const thumbs = [...root.querySelectorAll(".thumb")];
        const loops = +root.dataset.autoadvance || 0;
        let auto = loops > 0;
        let plays = 0;

        const label = (t) => t.querySelector("span").firstChild.textContent.trim();
        const at = (offset) => {
            const i = thumbs.findIndex((x) => x.classList.contains("is-active"));
            return thumbs[(i + offset + thumbs.length) % thumbs.length];
        };

        const makePeek = (dir) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = `peek peek-${dir}`;
            b.innerHTML = '<img alt="" decoding="async"><span class="peek-content">'
                + '<span class="peek-arrow"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></span>'
                + `<span class="peek-copy"><span class="peek-kicker">${dir === "prev" ? "Previous" : "Next"}</span><span class="peek-name"></span></span></span>`;
            return b;
        };
        const media = root.querySelector(".player-media");
        const stage = document.createElement("div");
        stage.className = "player-stage";
        const prevPeek = makePeek("prev");
        const nextPeek = makePeek("next");
        media.before(stage);
        stage.append(prevPeek, media, nextPeek);

        const select = (t, play) => {
            thumbs.forEach((x) => x.classList.toggle("is-active", x === t));
            // On phones the thumbnails are a horizontal strip; keep the active one in view.
            const strip = t.parentElement;
            strip.scrollTo({ left: t.offsetLeft - strip.offsetLeft, behavior: "smooth" });
            plays = 0;
            video.poster = t.dataset.poster;
            video.dataset.src = t.dataset.video;
            [[prevPeek, -1, "Previous"], [nextPeek, 1, "Next"]].forEach(([b, offset, word]) => {
                const n = at(offset);
                b.querySelector("img").src = n.dataset.poster;
                b.querySelector(".peek-name").textContent = label(n);
                b.setAttribute("aria-label", `${word}: ${label(n)}`);
            });
            if (play) {
                video.src = t.dataset.video;
                video.play().catch(() => {});
            }
        };

        const pick = (t) => {
            if (auto) { auto = false; video.loop = true; }
            select(t, true);
        };
        thumbs.forEach((t) => t.addEventListener("click", () => pick(t)));
        prevPeek.addEventListener("click", () => pick(at(-1)));
        nextPeek.addEventListener("click", () => pick(at(1)));

        // Arrow keys switch clips, except on the video itself where they seek.
        root.addEventListener("keydown", (e) => {
            if (e.target === video || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
            e.preventDefault();
            const t = at(e.key === "ArrowLeft" ? -1 : 1);
            pick(t);
            (thumbs.includes(e.target) ? t : e.target).focus({ preventScroll: true });
        });

        // Warm the HTTP cache with the upcoming clip so auto-advance doesn't stall on a fresh download.
        video.addEventListener("playing", () => {
            if (!auto) return;
            const t = at(1);
            if (t.dataset.fetched) return;
            t.dataset.fetched = "1";
            fetch(t.dataset.video).catch(() => {});
        });

        video.addEventListener("ended", () => {
            if (!auto) return;
            if (++plays < loops) { video.play().catch(() => {}); return; }
            select(at(1), true);
        });

        select(thumbs[0], false);
    });

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
