/* The jetpack corridor: the chasm in the middle of the map.
 *
 * There is no floor and a ceiling you cannot climb over, so the only way
 * across is to fly. Hangers drop from the roof and pillars rise from the drop,
 * and saucers hold station in between and shoot.
 *
 * The bullets are the point. Every saucer telegraphs before it fires - it banks
 * toward you and its underside lamp winds up, then snaps dark on release - so a
 * pattern can be read and dodged rather than reacted to. Placement is fixed,
 * never random: a corridor you can learn is a corridor worth replaying.
 *
 * If assets/ufo.png is missing the hater's drawn poses stand in, so the
 * corridor degrades rather than emptying.
 */

(function () {
  const SPEED = 250;                 // bullet travel, world units / sec
  const CREATURE_H = 150;
  const HP = 2;
  // A saucer is wide and flat where the gremlin was tall, so the boxes follow
  // the disc rather than the sprite square. The one that hurts is tighter than
  // the one you can shoot - being clipped by a hull you thought you cleared
  // feels cheap, and missing a shot that looked on target feels worse.
  const BODY = { x: 60, y: 40 };
  const SHOOTABLE = { x: 70, y: 52 };

  // Fixed roster. y is the height it holds station at.
  const ROSTER = [
    { x: 2010, y: 170, type: 'volley', phase: 0.0 },
    { x: 2330, y: 540, type: 'fan', phase: 0.9 },
    { x: 2690, y: 210, type: 'swoop', phase: 0.4 },
    { x: 3010, y: 520, type: 'volley', phase: 1.3 },
    { x: 3280, y: 250, type: 'fan', phase: 0.6 },
  ];

  const CYCLE = { idle: 1.15, wind: 0.62, fire: 0.22 };
  const TOTAL = CYCLE.idle + CYCLE.wind + CYCLE.fire;

  const sheet = new Image();          // fallback: the hater's drawn poses
  const ufo = new Image();            // preferred: the drawn saucer
  let ready = false;
  let ufoReady = false;
  let creatures = [];
  let bullets = [];

  const META = () => (window.SPRITE_META && window.SPRITE_META.hater) || null;

  function reset() {
    creatures = ROSTER.map((c) => ({
      ...c, hp: HP, t: c.phase, dead: false, flinch: 0,
      homeY: c.y, cy: c.y, vx: 0, vy: 0, fired: false,
    }));
    bullets = [];
  }

  function shoot(c, px, py, spread, count, speed = SPEED) {
    const dx = px - c.x, dy = py - c.cy;
    const base = Math.atan2(dy, dx);
    for (let i = 0; i < count; i++) {
      const a = base + (count === 1 ? 0 : (i / (count - 1) - 0.5) * spread);
      bullets.push({
        x: c.x, y: c.cy,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        r: 11, life: 5.5, seed: (Math.random() * 1e9) | 0,
      });
    }
  }

  /** Advances the corridor. `active` is false once the player has left it. */
  function update(dt, player, active, hurt) {
    const px = player.x + 27, py = player.y + 86;

    for (const c of creatures) {
      if (c.dead) continue;
      c.flinch = Math.max(0, c.flinch - dt);
      if (!active) continue;

      c.t += dt;
      const k = c.t % TOTAL;

      if (c.type === 'swoop') {
        // charges the player's height, then eases back to its station
        if (k < CYCLE.idle) {
          c.cy += (c.homeY - c.cy) * Math.min(1, dt * 2.2);
          c.vx += (0 - c.vx) * Math.min(1, dt * 3);
        } else {
          const to = py - c.cy;
          c.cy += Math.sign(to) * Math.min(Math.abs(to), 240 * dt);
          c.vx += (Math.sign(px - c.x) * 90 - c.vx) * Math.min(1, dt * 2);
        }
        c.x += c.vx * dt;
      } else {
        c.cy = c.homeY + Math.sin(c.t * 1.6 + c.phase) * 16;   // hover
      }

      // fire once per cycle, on the beat the wind-up resolves
      const firing = k >= CYCLE.idle + CYCLE.wind;
      if (firing && !c.fired) {
        c.fired = true;
        if (c.type === 'volley') shoot(c, px, py, 0, 1, SPEED * 1.25);
        if (c.type === 'fan') shoot(c, px, py, 0.9, 5);
        if (c.type === 'swoop') shoot(c, px, py, 0.35, 2, SPEED * 0.9);
      }
      if (!firing && k < CYCLE.idle) c.fired = false;
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) { bullets.splice(i, 1); continue; }
      // a generous player box would feel unfair; this is tighter than the art
      if (Math.abs(b.x - px) < 24 + b.r && Math.abs(b.y - py) < 62 + b.r) {
        bullets.splice(i, 1);
        hurt();
      }
    }

    // bodies hurt too, so a swooper is a threat even after it has fired
    if (active) {
      for (const c of creatures) {
        if (c.dead) continue;
        if (Math.abs(c.x - px) < BODY.x && Math.abs(c.cy - py) < BODY.y + 38) hurt();
      }
    }
  }

  /** A player shot landing on a creature. Returns true if it connected. */
  function hitTest(x, y) {
    for (const c of creatures) {
      if (c.dead) continue;
      if (Math.abs(c.x - x) < SHOOTABLE.x && Math.abs(c.cy - y) < SHOOTABLE.y) {
        c.hp--;
        c.flinch = 0.22;
        if (c.hp <= 0) c.dead = true;
        return true;
      }
    }
    return false;
  }

  function render(ctx, t) {
    const m = META();
    const px = window.player ? window.player.x : 0;

    for (const c of creatures) {
      if (c.dead) continue;
      const k = c.t % TOTAL;
      const winding = k >= CYCLE.idle && k < CYCLE.idle + CYCLE.wind;
      const charge = winding ? (k - CYCLE.idle) / CYCLE.wind : (k < CYCLE.idle ? 0 : 1);
      const shake = c.flinch > 0 ? Math.sin(c.flinch * 90) * 7 : 0;

      if (ufoReady) {
        // A saucer has one drawn pose, so the tell has to be motion and light:
        // it banks toward the target and the underside lamp winds up, then
        // snaps dark on release. Same read as the gremlin's rear-back, no
        // extra frames needed.
        const w = CREATURE_H * (ufo.naturalWidth / ufo.naturalHeight);
        const bank = Math.sin(t * 1.3 + c.phase) * 0.05
          + (winding ? Math.sign(px - c.x) * 0.22 * charge : 0);

        ctx.save();
        ctx.translate(c.x + shake, c.cy);

        // charge glow under the hull, brightest just before it fires
        if (charge > 0.02) {
          const r = CREATURE_H * (0.5 + charge * 0.9);
          const g = ctx.createRadialGradient(0, CREATURE_H * 0.22, 0, 0, CREATURE_H * 0.22, r);
          g.addColorStop(0, `rgba(255, 150, 60, ${0.5 * charge})`);
          g.addColorStop(0.5, `rgba(230, 90, 40, ${0.2 * charge})`);
          g.addColorStop(1, 'rgba(200, 60, 30, 0)');
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(0, CREATURE_H * 0.22, r, 0, Math.PI * 2); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        }

        ctx.rotate(bank);
        const pump = 1 + charge * 0.07;
        for (const pass of [1, 0.5]) {
          ctx.globalAlpha = pass * (c.flinch > 0 ? 0.6 : 1);
          ctx.drawImage(ufo, -w / 2 * pump, -CREATURE_H / 2 * pump,
                        w * pump, CREATURE_H * pump);
        }
        ctx.restore();
        continue;
      }

      if (!ready || !m) continue;
      // the drawn poses double as the tell: hanging, then rearing, then strike
      let frame = m.hang[0];
      if (k >= CYCLE.idle) frame = m.prep[0];
      if (k >= CYCLE.idle + CYCLE.wind * 0.6) frame = m.load[0];
      if (k >= CYCLE.idle + CYCLE.wind) frame = m.strike[0];
      if (c.flinch > 0) frame = m.hurt[0];

      const scale = CREATURE_H / m.frameHeight;
      const face = c.x > px ? -1 : 1;
      const pump = winding ? 1 + 0.12 * charge : 1;

      ctx.save();
      ctx.translate(c.x + shake, c.cy);
      ctx.scale(scale * face * pump, scale * pump);
      for (const pass of [1, 0.5]) {
        ctx.globalAlpha = pass;
        ctx.drawImage(sheet, frame * m.frameWidth, 0, m.frameWidth, m.frameHeight,
          -m.centerX, -m.gripY - m.frameHeight * 0.34, m.frameWidth, m.frameHeight);
      }
      ctx.restore();
    }

    // bullets: scribbled ink balls, so they belong on the page
    for (const b of bullets) {
      const rand = mulberry32(b.seed);
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(t * 5 + b.seed);
      ctx.strokeStyle = 'rgba(46, 42, 38, 0.85)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      const pts = [];
      for (let i = 0; i <= 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const r = b.r * (0.82 + rand() * 0.3);
        pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
      }
      tracePath(ctx, pts, true);
      ctx.strokeStyle = 'rgba(46, 42, 38, 0.35)';
      ctx.lineWidth = 2;
      tracePath(ctx, jitterLine(-b.r * 0.4, 0, b.r * 0.4, 0, rand, 1.5, 6), false);
      ctx.restore();
    }
  }

  window.Flight = {
    load() {
      // the saucer is preferred; the hater's frames stand in until it exists,
      // so a missing asset degrades instead of emptying the corridor
      const one = (img, src, done) => new Promise((res) => {
        img.onload = () => { done(); res(); };
        img.onerror = () => res();
        img.src = src;
      });
      return Promise.all([
        one(sheet, 'assets/hater_sheet.png', () => { ready = true; }),
        one(ufo, 'assets/ufo.png', () => { ufoReady = true; }),
      ]);
    },
    get usingUfo() { return ufoReady; },
    reset, update, render, hitTest,
    get creatures() { return creatures; },
    get bullets() { return bullets; },
    get alive() { return creatures.filter((c) => !c.dead).length; },
  };
  reset();
})();
