// Sbtle visual effects: ASCII fluid background, cursor glow, scroll reveals.
(() => {

    const hasHover = window.matchMedia("(hover: hover)").matches;

    /* ---------------- Scroll reveal ---------------- */
    if ("IntersectionObserver" in window) {
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

    /* ---------------- ASCII fluid background ---------------- */
    const canvas = document.getElementById("bg");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    // Tweak these to taste.
    const FONT_PX = 12;          // character size
    const MAX_CELLS = 24000;     // cap on grid size (performance on big screens)
    const FPS = 30;              // simulation + draw rate
    const DISSIPATION = 0.975;   // how fast the "ink" fades (lower = fades faster)
    const VELOCITY_DAMP = 0.995; // how fast the flow calms down
    const MAX_ALPHA = 0.4;       // brightest character opacity
    const RAMP = " .:-=+*#%@";   // dark -> bright

    let w = 0, h = 0, dpr = 1;
    let cols = 0, rows = 0, cw = 8, ch = 14, stride = 0;
    let u, v, u0, v0, d, d0, p, div, levels;
    let rgb = [88, 166, 255];
    let running = false;
    let lastFrame = 0;

    const mouse = { x: -9999, y: -9999, active: false };

    const IX = (i, j) => i + stride * j;

    /* ---- Stable-fluids solver (after Jos Stam) ---- */

    function setBnd(b, x) {
        for (let i = 1; i <= cols; i++) {
            x[IX(i, 0)] = b === 2 ? -x[IX(i, 1)] : x[IX(i, 1)];
            x[IX(i, rows + 1)] = b === 2 ? -x[IX(i, rows)] : x[IX(i, rows)];
        }
        for (let j = 1; j <= rows; j++) {
            x[IX(0, j)] = b === 1 ? -x[IX(1, j)] : x[IX(1, j)];
            x[IX(cols + 1, j)] = b === 1 ? -x[IX(cols, j)] : x[IX(cols, j)];
        }
        x[IX(0, 0)] = 0.5 * (x[IX(1, 0)] + x[IX(0, 1)]);
        x[IX(0, rows + 1)] = 0.5 * (x[IX(1, rows + 1)] + x[IX(0, rows)]);
        x[IX(cols + 1, 0)] = 0.5 * (x[IX(cols, 0)] + x[IX(cols + 1, 1)]);
        x[IX(cols + 1, rows + 1)] = 0.5 * (x[IX(cols, rows + 1)] + x[IX(cols + 1, rows)]);
    }

    function linSolve(b, x, x0, a, c, iterations) {
        const inv = 1 / c;
        for (let k = 0; k < iterations; k++) {
            for (let j = 1; j <= rows; j++) {
                let idx = IX(1, j);
                for (let i = 1; i <= cols; i++, idx++) {
                    x[idx] = (x0[idx] + a * (x[idx - 1] + x[idx + 1] + x[idx - stride] + x[idx + stride])) * inv;
                }
            }
            setBnd(b, x);
        }
    }

    function advect(b, dst, src, uu, vv) {
        for (let j = 1; j <= rows; j++) {
            for (let i = 1; i <= cols; i++) {
                const idx = IX(i, j);
                let x = i - uu[idx];
                let y = j - vv[idx];

                if (x < 0.5) x = 0.5; else if (x > cols + 0.5) x = cols + 0.5;
                if (y < 0.5) y = 0.5; else if (y > rows + 0.5) y = rows + 0.5;

                const i0 = x | 0, j0 = y | 0;
                const s1 = x - i0, s0 = 1 - s1;
                const t1 = y - j0, t0 = 1 - t1;

                dst[idx] =
                    s0 * (t0 * src[IX(i0, j0)] + t1 * src[IX(i0, j0 + 1)]) +
                    s1 * (t0 * src[IX(i0 + 1, j0)] + t1 * src[IX(i0 + 1, j0 + 1)]);
            }
        }
        setBnd(b, dst);
    }

    function project(uu, vv, pp, dv) {
        for (let j = 1; j <= rows; j++) {
            for (let i = 1; i <= cols; i++) {
                const idx = IX(i, j);
                dv[idx] = -0.5 * (uu[idx + 1] - uu[idx - 1] + vv[idx + stride] - vv[idx - stride]);
                pp[idx] = 0;
            }
        }
        setBnd(0, dv);
        setBnd(0, pp);
        linSolve(0, pp, dv, 1, 4, 10);

        for (let j = 1; j <= rows; j++) {
            for (let i = 1; i <= cols; i++) {
                const idx = IX(i, j);
                uu[idx] -= 0.5 * (pp[idx + 1] - pp[idx - 1]);
                vv[idx] -= 0.5 * (pp[idx + stride] - pp[idx - stride]);
            }
        }
        setBnd(1, uu);
        setBnd(2, vv);
    }

    function stepFluid() {
        // Velocity.
        u0.set(u);
        v0.set(v);
        advect(1, u, u0, u0, v0);
        advect(2, v, v0, u0, v0);
        project(u, v, p, div);

        for (let i = 0; i < u.length; i++) {
            u[i] *= VELOCITY_DAMP;
            v[i] *= VELOCITY_DAMP;
        }

        // Density ("ink").
        d0.set(d);
        advect(0, d, d0, u, v);

        for (let i = 0; i < d.length; i++) d[i] *= DISSIPATION;
    }

    /* ---- Adding energy ---- */

    // Push velocity and ink into the cells around (gx, gy), in grid coordinates.
    function splat(gx, gy, fu, fv, fd, radius) {
        const r2 = radius * radius;
        const i0 = Math.max(1, Math.floor(gx - radius));
        const i1 = Math.min(cols, Math.ceil(gx + radius));
        const j0 = Math.max(1, Math.floor(gy - radius));
        const j1 = Math.min(rows, Math.ceil(gy + radius));

        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                const dx = i - gx, dy = j - gy;
                const dist2 = dx * dx + dy * dy;
                if (dist2 > r2) continue;

                const wgt = 1 - dist2 / r2;
                const idx = IX(i, j);
                u[idx] += fu * wgt;
                v[idx] += fv * wgt;
                d[idx] = Math.min(1, d[idx] + fd * wgt);
            }
        }
    }

    // Two slow, faint "ghost" stirrers keep the background gently alive.
    const ghosts = [
        { fx: 0.00011, fy: 0.00017, px: 0.0, py: 1.3 },
        { fx: 0.00015, fy: 0.00009, px: 2.1, py: 0.4 }
    ];

    function stirGhosts(t) {
        for (const g of ghosts) {
            const x = (0.5 + 0.42 * Math.sin(t * g.fx * 6.283 + g.px)) * cols;
            const y = (0.5 + 0.38 * Math.sin(t * g.fy * 6.283 + g.py)) * rows;
            const vx = Math.cos(t * g.fx * 6.283 + g.px) * 0.35;
            const vy = Math.cos(t * g.fy * 6.283 + g.py) * 0.25;
            splat(x, y, vx, vy, 0.05, 4);
        }
    }

    /* ---- Setup / resize ---- */

    function readAccent() {
        const value = getComputedStyle(document.documentElement)
            .getPropertyValue("--accent").trim();
        const m = /^#?([0-9a-f]{6})$/i.exec(value);
        if (m) {
            const n = parseInt(m[1], 16);
            rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        }
    }

    function setFont(px) {
        ctx.font = `${px}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
        ctx.textBaseline = "top";
        cw = ctx.measureText("M").width;
        ch = px * 1.2;
    }

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        w = window.innerWidth;
        h = window.innerHeight;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Pick a character size that keeps the grid within the cell budget.
        let px = FONT_PX;
        setFont(px);
        let c = Math.ceil(w / cw), r = Math.ceil(h / ch);
        if (c * r > MAX_CELLS) {
            px = FONT_PX * Math.sqrt((c * r) / MAX_CELLS);
            setFont(px);
            c = Math.ceil(w / cw);
            r = Math.ceil(h / ch);
        }

        // Only rebuild the simulation if the grid actually changed
        // (mobile browsers fire resize when the address bar hides).
        if (c !== cols || r !== rows) {
            cols = c;
            rows = r;
            stride = cols + 2;
            const size = stride * (rows + 2);
            u = new Float32Array(size);
            v = new Float32Array(size);
            u0 = new Float32Array(size);
            v0 = new Float32Array(size);
            d = new Float32Array(size);
            d0 = new Float32Array(size);
            p = new Float32Array(size);
            div = new Float32Array(size);
            levels = new Uint8Array(size);
        }

        draw();
    }

    /* ---- Drawing ---- */

    function draw() {
        ctx.clearRect(0, 0, w, h);
        if (!d) return;

        const n = RAMP.length - 1;

        // Map density to a character level for every visible cell.
        let any = false;
        for (let j = 1; j <= rows; j++) {
            for (let i = 1; i <= cols; i++) {
                const idx = IX(i, j);
                const dens = d[idx];
                const lvl = dens < 0.03 ? 0 : Math.min(n, Math.round(Math.pow(Math.min(dens, 1), 0.7) * n));
                levels[idx] = lvl;
                if (lvl) any = true;
            }
        }
        if (!any) return;

        const [r, g, b] = rgb;

        // One pass per level, so the fill style only changes ~9 times a frame.
        for (let lvl = 1; lvl <= n; lvl++) {
            ctx.fillStyle = `rgba(${r},${g},${b},${(0.08 + (lvl / n) * (MAX_ALPHA - 0.08)).toFixed(3)})`;
            const chr = RAMP[lvl];

            for (let j = 1; j <= rows; j++) {
                for (let i = 1; i <= cols; i++) {
                    if (levels[IX(i, j)] === lvl) {
                        ctx.fillText(chr, (i - 1) * cw, (j - 1) * ch);
                    }
                }
            }
        }
    }

    /* ---------------- Cursor glow ---------------- */
    let glow = null;
    let gx = 0, gy = 0;

    if (hasHover) {
        glow = document.getElementById("cursor-glow");
    }

    /* ---------------- Main loop ---------------- */
    function frame(now) {
        if (!running) return;
        requestAnimationFrame(frame);

        if (glow) {
            gx += (mouse.x - gx) * 0.12;
            gy += (mouse.y - gy) * 0.12;
            glow.style.transform = `translate(${gx - 250}px, ${gy - 250}px)`;
        }

        // Throttle the fluid itself to a steady, cheaper rate.
        if (now - lastFrame < 1000 / FPS) return;
        lastFrame = now;

        stirGhosts(now);
        stepFluid();
        draw();
    }

    function start() {
        if (running) return;
        running = true;
        requestAnimationFrame(frame);
    }

    /* ---------------- Events ---------------- */
    let lastX = null, lastY = null;

    window.addEventListener("pointermove", event => {
        mouse.x = event.clientX;
        mouse.y = event.clientY;
        if (glow) glow.classList.add("on");
        if (!d) return;

        if (lastX !== null) {
            // Stir the fluid along the direction the cursor moved.
            const dx = (event.clientX - lastX) / cw;
            const dy = (event.clientY - lastY) / ch;
            const speed = Math.hypot(dx, dy);

            if (speed > 0.01) {
                const clamp = x => Math.max(-6, Math.min(6, x));
                splat(
                    event.clientX / cw + 0.5,
                    event.clientY / ch + 0.5,
                    clamp(dx) * 0.6,
                    clamp(dy) * 0.6,
                    Math.min(0.35, 0.08 + speed * 0.05),
                    3
                );
            }
        }

        lastX = event.clientX;
        lastY = event.clientY;
    }, { passive: true });

    document.addEventListener("pointerleave", () => {
        mouse.x = mouse.y = -9999;
        lastX = lastY = null;
        if (glow) glow.classList.remove("on");
    });

    // Click: a small burst that pushes outward from the cursor.
    window.addEventListener("pointerdown", event => {
        if (!d) return;

        const cx = event.clientX / cw + 0.5;
        const cy = event.clientY / ch + 0.5;
        const radius = 9;

        for (let j = Math.max(1, Math.floor(cy - radius)); j <= Math.min(rows, Math.ceil(cy + radius)); j++) {
            for (let i = Math.max(1, Math.floor(cx - radius)); i <= Math.min(cols, Math.ceil(cx + radius)); i++) {
                const dx = i - cx, dy = j - cy;
                const dist = Math.hypot(dx, dy);
                if (dist > radius || dist < 0.01) continue;

                const wgt = 1 - dist / radius;
                const idx = IX(i, j);
                u[idx] += (dx / dist) * wgt * 2.2;
                v[idx] += (dy / dist) * wgt * 2.2;
                d[idx] = Math.min(1, d[idx] + wgt * 0.6);
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

    // Re-read the accent color when the theme is toggled.
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