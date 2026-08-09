/* The landing. Runs on the game field between the cutscene and play.
 *
 * Bob has eaten the wiring, so the ship arrives as debris: it comes down hard,
 * skids along the ground throwing dust, and settles venting steam. Kelvin
 * climbs out, and the moment his boots hit the dirt the player has control.
 *
 * It draws into the game's own world transform, so the ship is in level
 * coordinates and simply stays there afterwards as scenery.
 */

(function () {
  const SHIP_W = 420;                // drawn width in world units
  const START_X = -520, START_Y = -260;
  const TOUCH_X = -120;              // where it first hits the ground
  const REST_X = 20;                 // where it finally stops, left of spawn
  const HATCH_X = 92;                // where Kelvin lands

  const T = {                        // timeline, seconds
    fall: 1.15,
    skid: 1.25,
    settle: 1.1,
    climb: 0.95,
  };
  const TOTAL = T.fall + T.skid + T.settle + T.climb;

  const ship = new Image();
  let shipReady = false;
  const puffs = [];
  let sparks = [];

  const state = { t: 0, running: false, done: false, hit: false, hissed: false };
  let onFinish = null;

  const ease = (k) => 1 - Math.pow(1 - k, 3);

  /** Ship pose at time t. groundY is the surface it lands on. */
  function pose(t, groundY) {
    const rest = { x: REST_X, y: groundY - 54, rot: 0.06 };
    if (t < T.fall) {
      const k = t / T.fall;
      return {
        x: START_X + (TOUCH_X - START_X) * k,
        y: START_Y + (groundY - 54 - START_Y) * (k * k),   // gravity-ish
        rot: -0.55 + 0.5 * k * k,
      };
    }
    if (t < T.fall + T.skid) {
      const k = ease((t - T.fall) / T.skid);
      return {
        x: TOUCH_X + (REST_X - TOUCH_X) * k,
        y: groundY - 54 + Math.sin(k * Math.PI) * -16,      // one bounce
        rot: 0.05 + Math.sin(k * Math.PI * 2) * 0.06,
      };
    }
    return rest;
  }

  function puff(x, y, opts = {}) {
    puffs.push({
      x, y,
      vx: (Math.random() - 0.5) * (opts.spread || 40) + (opts.vx || 0),
      vy: -(18 + Math.random() * (opts.lift || 34)),
      r: 10 + Math.random() * (opts.size || 26),
      life: 0, max: 1.1 + Math.random() * (opts.max || 1.4),
      seed: (Math.random() * 1e9) | 0,
    });
  }

  function update(dt, groundY) {
    if (!state.running || state.done) return;
    const prev = state.t;
    state.t += dt;
    const t = state.t;
    const p = pose(t, groundY);

    // impact: dust sheet, a bang, and a kick to the camera
    if (!state.hit && t >= T.fall) {
      state.hit = true;
      for (let i = 0; i < 26; i++) {
        puff(p.x + (Math.random() - 0.5) * 220, groundY - 6,
             { spread: 260, lift: 60, size: 34, max: 1.6 });
      }
      const A = window.Intro && window.Intro.audio;
      if (A) {
        A.noise({ dur: 0.9, gain: 0.3, cutoff: 1800, sweep: -1500 });
        A.tone({ freq: 110, dur: 0.5, gain: 0.22, type: 'square', slide: -70, cutoff: 400 });
        A.tone({ freq: 54, dur: 0.8, gain: 0.2, type: 'sine', slide: -18 });
      }
      window.CrashShake = 1;
    }

    // skid: dust off the nose, and a scrape that dies with the motion
    if (t > T.fall && t < T.fall + T.skid) {
      if (Math.random() < dt * 60) puff(p.x - 120, groundY - 10, { spread: 90, vx: -70, lift: 26 });
      const A = window.Intro && window.Intro.audio;
      if (A && Math.random() < dt * 6) {
        A.noise({ dur: 0.18, gain: 0.05 * (1 - (t - T.fall) / T.skid), cutoff: 2600, sweep: -1200 });
      }
    }

    // settled: steam vents from the hull, and keeps venting into the game
    if (t >= T.fall + T.skid) {
      if (Math.random() < dt * 22) {
        puff(p.x + 60 + (Math.random() - 0.5) * 120, groundY - 70,
             { spread: 26, lift: 46, size: 22, max: 2.2 });
      }
      const A = window.Intro && window.Intro.audio;
      if (!state.hissed && A) {
        state.hissed = true;
        A.noise({ dur: 2.4, gain: 0.09, cutoff: 5200, sweep: -3600 });
      }
    }

    for (let i = puffs.length - 1; i >= 0; i--) {
      const q = puffs[i];
      q.life += dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vy += 12 * dt;                 // steam slows as it rises
      q.vx *= 1 - dt * 0.8;
      q.r += dt * 22;
      if (q.life > q.max) puffs.splice(i, 1);
    }

    if (prev < TOTAL && state.t >= TOTAL) {
      state.done = true;
      if (onFinish) { const f = onFinish; onFinish = null; f(); }
    }
  }

  /** How far through the climb-out Kelvin is, 0 before it starts. */
  function climb() {
    const start = T.fall + T.skid + T.settle;
    if (state.t < start) return 0;
    return Math.min(1, (state.t - start) / T.climb);
  }

  function render(ctx, groundY, t) {
    if (!state.running) return;
    const p = pose(state.t, groundY);

    // entry trail: the ship is already on fire coming in
    if (state.t < T.fall && Math.random() < 0.6) {
      puff(p.x - 90, p.y + 20, { spread: 30, vx: -120, lift: 10, size: 16, max: 0.7 });
    }

    // puffs behind the hull
    for (const q of puffs) {
      const k = q.life / q.max;
      const a = (1 - k) * 0.5;
      if (a <= 0) continue;
      const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, q.r * (0.6 + k));
      g.addColorStop(0, `rgba(120, 112, 100, ${a * 0.55})`);
      g.addColorStop(1, 'rgba(120, 112, 100, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.r * (0.6 + k), 0, Math.PI * 2);
      ctx.fill();
    }

    if (shipReady) {
      const h = SHIP_W * (ship.naturalHeight / ship.naturalWidth);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      // second pass darkens it, same trick the sprites use after downscaling
      for (const alpha of [1, 0.5]) {
        ctx.globalAlpha = alpha;
        ctx.drawImage(ship, -SHIP_W / 2, -h / 2, SHIP_W, h);
      }
      ctx.restore();
    }
  }

  window.Crash = {
    load() {
      return new Promise((res) => {
        ship.onload = () => { shipReady = true; res(); };
        ship.onerror = () => res();
        ship.src = 'assets/ship.png';
      });
    },
    begin(done) { onFinish = done; state.running = true; state.t = 0; },
    skip() {
      state.t = TOTAL;
      state.done = true;
      if (onFinish) { const f = onFinish; onFinish = null; f(); }
    },
    get active() { return state.running && !state.done; },
    get shipX() { return REST_X; },
    get hatchX() { return HATCH_X; },
    climb, update, render,
    // the wreck and its steam stay on the field once play starts
    idle(dt, groundY) {
      if (Math.random() < dt * 8) {
        puff(REST_X + 60 + (Math.random() - 0.5) * 110, groundY - 70,
             { spread: 20, lift: 34, size: 18, max: 2.4 });
      }
      for (let i = puffs.length - 1; i >= 0; i--) {
        const q = puffs[i];
        q.life += dt; q.x += q.vx * dt; q.y += q.vy * dt;
        q.vy += 12 * dt; q.vx *= 1 - dt * 0.8; q.r += dt * 22;
        if (q.life > q.max) puffs.splice(i, 1);
      }
    },
    renderWreck(ctx, groundY) {
      const p = { x: REST_X, y: groundY - 54, rot: 0.06 };
      for (const q of puffs) {
        const k = q.life / q.max;
        const a = (1 - k) * 0.4;
        if (a <= 0) continue;
        const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, q.r * (0.6 + k));
        g.addColorStop(0, `rgba(120, 112, 100, ${a * 0.5})`);
        g.addColorStop(1, 'rgba(120, 112, 100, 0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r * (0.6 + k), 0, Math.PI * 2); ctx.fill();
      }
      if (!shipReady) return;
      const h = SHIP_W * (ship.naturalHeight / ship.naturalWidth);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      for (const alpha of [1, 0.5]) {
        ctx.globalAlpha = alpha;
        ctx.drawImage(ship, -SHIP_W / 2, -h / 2, SHIP_W, h);
      }
      ctx.restore();
    },
  };
})();
