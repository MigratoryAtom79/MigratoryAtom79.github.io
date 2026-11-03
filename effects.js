// Subtle visual effects: particle background, cursor glow, scroll reveals.
(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hasHover = window.matchMedia("(hover: hover)").matches;

    /* ---------------- Scroll reveal ---------------- */
    if (!reduceMotion && "IntersectionObserver" in window) {
        const targets = document.querySelectorAll(
            "header, #readme-section, section:not(#readme-section) > h2, .toolbar"
        );

        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add("in");
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1 });

        targets.forEach((el, i) => {
            el.classList.add("reveal");
            el.style.transitionDelay = `${i * 80}ms`;
            observer.observe(el);
        });
    }

    /* ---------------- Particle background ---------------- */
    const canvas = document.getElementById("bg");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const mouse = { x: -9999, y: -9999 };

    let w = 0, h = 0, dpr = 1;
    let particles = [];
    let rgb = [88, 166, 255];
    let running = false;

    function readAccent() {
        const value = getComputedStyle(document.documentElement)
            .getPropertyValue("--accent").trim();
        const m = /^#?([0-9a-f]{6})$/i.exec(value);
        if (m) {
            const n = parseInt(m[1], 16);
            rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        }
    }

    function makeParticle() {
        const bx = (Math.random() - 0.5) * 0.25;
        const by = (Math.random() - 0.5) * 0.25;
        return {
            x: Math.random() * w,
            y: Math.random() * h,
            bx, by, vx: bx, vy: by,
            r: 1 + Math.random() * 1.2
        };
    }

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        w = window.innerWidth;
        h = window.innerHeight;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const target = Math.min(80, Math.floor((w * h) / 18000));
        while (particles.length < target) particles.push(makeParticle());
        particles.length = target;

        if (reduceMotion) draw();
    }

    function step() {
        for (const p of particles) {
            // Ease any pushed velocity back to the particle's base drift.
            p.vx += (p.bx - p.vx) * 0.02;
            p.vy += (p.by - p.vy) * 0.02;

            // Gently repel from the cursor.
            const dx = p.x - mouse.x;
            const dy = p.y - mouse.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 140 && dist > 0.1) {
                const force = (1 - dist / 140) * 0.05;
                p.vx += (dx / dist) * force;
                p.vy += (dy / dist) * force;
            }

            p.x += p.vx;
            p.y += p.vy;

            // Wrap around the edges.
            if (p.x < -10) p.x = w + 10;
            else if (p.x > w + 10) p.x = -10;
            if (p.y < -10) p.y = h + 10;
            else if (p.y > h + 10) p.y = -10;
        }
    }

    function draw() {
        ctx.clearRect(0, 0, w, h);
        const [r, g, b] = rgb;

        // Lines between nearby particles.
        for (let i = 0; i < particles.length; i++) {
            const a = particles[i];
            for (let j = i + 1; j < particles.length; j++) {
                const c = particles[j];
                const d = Math.hypot(a.x - c.x, a.y - c.y);
                if (d < 120) {
                    ctx.strokeStyle = `rgba(${r},${g},${b},${(1 - d / 120) * 0.15})`;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(c.x, c.y);
                    ctx.stroke();
                }
            }

            // Lines from the cursor to nearby particles.
            const md = Math.hypot(a.x - mouse.x, a.y - mouse.y);
            if (md < 160) {
                ctx.strokeStyle = `rgba(${r},${g},${b},${(1 - md / 160) * 0.35})`;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(mouse.x, mouse.y);
                ctx.stroke();
            }
        }

        // Dots.
        ctx.fillStyle = `rgba(${r},${g},${b},0.5)`;
        for (const p of particles) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /* ---------------- Cursor glow ---------------- */
    let glow = null;
    let gx = 0, gy = 0;

    if (!reduceMotion && hasHover) {
        glow = document.getElementById("cursor-glow");
    }

    function frame() {
        if (!running) return;
        step();
        draw();

        if (glow) {
            gx += (mouse.x - gx) * 0.12;
            gy += (mouse.y - gy) * 0.12;
            glow.style.transform = `translate(${gx - 250}px, ${gy - 250}px)`;
        }

        requestAnimationFrame(frame);
    }

    function start() {
        if (running || reduceMotion) return;
        running = true;
        requestAnimationFrame(frame);
    }

    /* ---------------- Events ---------------- */
    window.addEventListener("pointermove", event => {
        mouse.x = event.clientX;
        mouse.y = event.clientY;
        if (glow) glow.classList.add("on");
    }, { passive: true });

    document.addEventListener("pointerleave", () => {
        mouse.x = mouse.y = -9999;
        if (glow) glow.classList.remove("on");
    });

    // Click sends a small ripple through nearby particles.
    window.addEventListener("pointerdown", event => {
        if (reduceMotion) return;
        for (const p of particles) {
            const dx = p.x - event.clientX;
            const dy = p.y - event.clientY;
            const dist = Math.hypot(dx, dy);
            if (dist < 200 && dist > 0.1) {
                const push = (1 - dist / 200) * 2.5;
                p.vx += (dx / dist) * push;
                p.vy += (dy / dist) * push;
            }
        }
    }, { passive: true });

    window.addEventListener("resize", resize);

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            running = false;
        } else {
            start();
        }
    });

    // Re-read the accent colour when the theme is toggled.
    new MutationObserver(() => {
        readAccent();
        if (reduceMotion) draw();
    }).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"]
    });

    readAccent();
    resize();
    start();
})();