/* Mid-boss transformation cutscene.
 *
 * When the hater reaches half health a UFO screams across the arena and lasers
 * Kelvin for a moderate hit. Two comic panels then play - Kelvin remembers his
 * mum and Bob, and transforms into a jacked brawler. On completion the game
 * resumes with the muscular sprite and melee combat.
 *
 * Same IIFE pattern as intro.js and crash.js so nothing leaks.
 */

(function () {
  const W = 1440, H = 1024;            // panel art space, same as intro.js

  /* ---------------------------------------------------------------- panels */

  const PANELS = [
    {
      src: 'assets/scenes/muscle1.png',
      box: [42, 808, 460, 120],         // dialogue box location in the artwork
      pitch: 440, mood: 'solemn',
      beats: [
        { lines: ['MUM...'] },
        { lines: ['BOB...'] },
        { lines: ['THEY NEED ME.', 'I CAN\'T GO DOWN LIKE THIS.'] },
        { lines: ['I HAVE TO FIGHT.'] },
      ],
    },
    {
      src: 'assets/scenes/muslce2.png',
      box: [42, 808, 460, 120],
      pitch: 360, mood: 'power',
      beats: [
        { lines: ['NO MORE RUNNING.'], fx: ['flash'] },
        { lines: ['NO MORE HIDING.'] },
        { lines: ['TIME TO END THIS.'], fx: ['flash'] },
      ],
    },
  ];

  const INK = '69, 27, 11';
  const TYPE_MS = 30;
  const PAUSE = { '.': 280, ',': 140, '!': 280, '?': 280, '-': 60 };
  const ENTER = 0.48;
  const PIX = 2;

  /* ------------------------------------------------------------------ ufo */

  const UFO_DUR = 2.8;       // total fly-across time
  const LASER_START = 0.6;   // when the beam starts (fraction of UFO_DUR)
  const LASER_END = 0.82;    // when the beam ends
  const UFO_DMG = 30;        // health points taken by the laser

  /* ----------------------------------------------------------------- sound */

  // Re-uses the intro audio engine if it's available
  const Audio_ = {
    get ctx() { return window.Intro && window.Intro.audio && window.Intro.audio.ctx; },
    get ready() { return !!(this.ctx); },

    tone(opts) {
      if (!this.ready) return;
      const c = this.ctx;
      const t = c.currentTime + (opts.delay || 0);
      const osc = c.createOscillator();
      const amp = c.createGain();
      const lp = c.createBiquadFilter();
      osc.type = opts.type || 'square';
      osc.frequency.setValueAtTime(opts.freq || 440, t);
      if (opts.slide) osc.frequency.exponentialRampToValueAtTime(
        Math.max(40, (opts.freq || 440) + opts.slide), t + (opts.dur || 0.1));
      lp.type = 'lowpass'; lp.frequency.value = opts.cutoff || 2600;
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(opts.gain || 0.05, t + 0.004);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + (opts.dur || 0.1));
      osc.connect(lp).connect(amp).connect(c.destination);
      osc.start(t); osc.stop(t + (opts.dur || 0.1) + 0.02);
    },

    noise(opts) {
      if (!this.ready) return;
      const c = this.ctx;
      const t = c.currentTime + (opts.delay || 0);
      if (!this._noiseBuf) {
        const n = c.sampleRate * 2;
        this._noiseBuf = c.createBuffer(1, n, c.sampleRate);
        const d = this._noiseBuf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      }
      const src = c.createBufferSource();
      src.buffer = this._noiseBuf; src.loop = true;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(opts.cutoff || 1400, t);
      if (opts.sweep) lp.frequency.exponentialRampToValueAtTime(
        Math.max(80, (opts.cutoff || 1400) + opts.sweep), t + (opts.dur || 0.5));
      const amp = c.createGain();
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(opts.gain || 0.15, t + Math.min(0.05, (opts.dur || 0.5) * 0.2));
      amp.gain.exponentialRampToValueAtTime(0.0001, t + (opts.dur || 0.5));
      src.connect(lp).connect(amp).connect(c.destination);
      src.start(t); src.stop(t + (opts.dur || 0.5) + 0.05);
    },

    blip(base, ch) {
      const punct = ch in PAUSE;
      this.tone({
        freq: (punct ? base * 0.6 : base) * (0.94 + Math.random() * 0.12),
        dur: punct ? 0.08 : 0.045, gain: punct ? 0.045 : 0.035,
      });
    },

    thud() {
      this.tone({ freq: 140, dur: 0.12, gain: 0.1, slide: -70, cutoff: 900 });
      this.tone({ freq: 58, dur: 0.18, gain: 0.08, type: 'sine', slide: -20 });
    },

    page() { this.tone({ freq: 900, dur: 0.05, gain: 0.03, slide: 260 }); },

    laserCharge() {
      this.tone({ freq: 180, dur: 1.4, gain: 0.12, type: 'sawtooth', slide: 600, cutoff: 1800 });
      this.noise({ dur: 1.6, gain: 0.08, cutoff: 3200, sweep: -1800 });
    },

    laserHit() {
      this.noise({ dur: 0.7, gain: 0.28, cutoff: 2800, sweep: -2200 });
      this.tone({ freq: 260, dur: 0.4, gain: 0.18, type: 'square', slide: -220, cutoff: 600 });
      this.tone({ freq: 70, dur: 0.9, gain: 0.22, type: 'sine', slide: -40 });
    },

    ufoHum() {
      this.tone({ freq: 90, dur: 2.6, gain: 0.06, type: 'sawtooth', cutoff: 600 });
      this.tone({ freq: 135, dur: 2.6, gain: 0.04, type: 'square', cutoff: 400, slide: 40 });
    },

    powerUp() {
      for (let i = 0; i < 6; i++) {
        this.tone({ freq: 200 + i * 120, dur: 0.15, gain: 0.06, type: 'square',
                    slide: 200, cutoff: 2000, delay: i * 0.08 });
      }
      this.noise({ dur: 0.8, gain: 0.12, cutoff: 4000, sweep: -2400, delay: 0.4 });
    },
  };

  /* ----------------------------------------------------------------- state */

  const state = {
    phase: 'idle',       // 'idle' | 'ufo' | 'panels' | 'done'
    t: 0,
    // ufo sub-state
    ufoT: 0,
    laserFired: false,
    laserHitFired: false,
    // panel sub-state
    i: 0, beat: 0,
    shown: 0, nextAt: 0,
    typing: false,
    panelT: 0,
    shake: 0, flash: 0,
    fade: 0,
  };

  const images = [];
  let ufoImg = null;
  let ufoReady = false;
  let onFinish = null;
  let onDamage = null;   // callback to deal UFO laser damage
  let textCanvas = null;

  const panel = () => PANELS[state.i];
  const beat = () => panel().beats[state.beat];
  const flat = () => beat().lines.join('\n');
  const pitch = () => beat().pitch || panel().pitch;

  /* -------------------------------------------------------------- loading */

  function load() {
    const one = (src) => new Promise((res) => {
      const im = new Image();
      im.onload = im.onerror = () => res(im);
      im.src = src;
    });
    return Promise.all([
      one('assets/scenes/muscle1.png').then((im) => { images[0] = im; }),
      one('assets/scenes/muslce2.png').then((im) => { images[1] = im; }),
      one('assets/ufo.png').then((im) => { ufoImg = im; ufoReady = true; }),
    ]);
  }

  /* ----------------------------------------------------------- panel logic */

  function startBeat(reset) {
    state.shown = 0;
    state.nextAt = reset ? 300 : 100;
    state.typing = true;
    for (const fx of beat().fx || []) {
      if (fx === 'flash') { state.flash = 1.2; state.shake = 0.8; }
    }
  }

  function beginPanel(i) {
    state.i = i;
    state.beat = 0;
    state.panelT = 0;
    state.shake = 1;
    Audio_.thud();
    startBeat(true);
  }

  function advancePanel() {
    if (state.typing) {
      state.shown = flat().length;
      state.typing = false;
      Audio_.page();
      return;
    }
    if (state.beat < panel().beats.length - 1) {
      state.beat++;
      Audio_.page();
      startBeat(false);
      return;
    }
    if (state.i < PANELS.length - 1) {
      Audio_.page();
      if (state.i === PANELS.length - 2) {
        // transitioning to last panel — power up sound
        Audio_.powerUp();
      }
      beginPanel(state.i + 1);
      return;
    }
    // last panel done — flash out
    state.phase = 'done';
    state.flash = 1.5;
    state.fade = 0;
  }

  /* ---------------------------------------------------------------- begin */

  function begin(done, damage) {
    onFinish = done;
    onDamage = damage;
    state.phase = 'ufo';
    state.t = 0;
    state.ufoT = 0;
    state.laserFired = false;
    state.laserHitFired = false;
    state.fade = 0;
    state.flash = 0;
    state.shake = 0;
    Audio_.ufoHum();
  }

  /* --------------------------------------------------------------- update */

  function update(dt) {
    state.t += dt;
    state.shake = Math.max(0, state.shake - dt * 2.8);
    state.flash = Math.max(0, state.flash - dt * 1.8);

    if (state.phase === 'ufo') {
      state.ufoT += dt;
      const k = state.ufoT / UFO_DUR;

      // fire laser charge sound
      if (!state.laserFired && k >= LASER_START - 0.3) {
        state.laserFired = true;
        Audio_.laserCharge();
      }
      // laser hits the player
      if (!state.laserHitFired && k >= LASER_END) {
        state.laserHitFired = true;
        state.shake = 1.6;
        state.flash = 1.2;
        Audio_.laserHit();
        if (onDamage) onDamage(UFO_DMG);
      }

      if (state.ufoT >= UFO_DUR + 0.6) {
        // UFO has passed, transition to panels
        state.phase = 'panels';
        beginPanel(0);
      }
      return;
    }

    if (state.phase === 'panels') {
      state.panelT += dt;

      if (state.typing && state.panelT > ENTER * 0.5) {
        const text = flat();
        state.nextAt -= dt * 1000;
        while (state.nextAt <= 0 && state.shown < text.length) {
          const ch = text[state.shown];
          state.shown++;
          if (ch.trim() && state.shown % 2 === 0) Audio_.blip(pitch(), ch);
          state.nextAt += TYPE_MS + (PAUSE[ch] || 0) + (ch === '\n' ? 220 : 0);
        }
        if (state.shown >= text.length) state.typing = false;
      }
      return;
    }

    if (state.phase === 'done') {
      state.fade = Math.min(1, state.fade + dt * 2.0);
      if (state.fade >= 1 && onFinish) {
        const f = onFinish;
        onFinish = null;
        f();
      }
    }
  }

  /* --------------------------------------------------------------- render */

  /** Chunky upscaled text — same approach as intro.js */
  function pixelText(ctx, str, cx, y, size, color) {
    if (!str) return;
    if (!textCanvas) textCanvas = document.createElement('canvas');
    const c = textCanvas;
    const g = c.getContext('2d');
    const small = Math.max(6, Math.round(size / PIX));
    const font = `bold ${small}px "Consolas", "DejaVu Sans Mono", "Courier New", monospace`;
    g.font = font;
    const w = Math.ceil(g.measureText(str).width) + 2;
    const h = Math.ceil(small * 1.5);
    if (c.width < w || c.height < h) { c.width = w; c.height = h; }
    g.clearRect(0, 0, c.width, c.height);
    g.font = font;
    g.textBaseline = 'top';
    g.fillStyle = color;
    g.fillText(str, 1, 1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, 0, 0, w, h, Math.round(cx - (w * PIX) / 2), Math.round(y), w * PIX, h * PIX);
    ctx.imageSmoothingEnabled = true;
  }

  /** Idle motion per panel mood */
  function drift(mood, t) {
    switch (mood) {
      case 'solemn':
        return { x: Math.sin(t * 0.4) * 2, y: Math.cos(t * 0.3) * 1.5, r: Math.sin(t * 0.2) * 0.001 };
      case 'power':
        return { x: Math.sin(t * 29) * 2.2, y: Math.cos(t * 23) * 1.6, r: Math.sin(t * 17) * 0.002 };
      default:
        return { x: 0, y: 0, r: 0 };
    }
  }

  function renderUfo(ctx, cssW, cssH, t) {
    // paper background
    ctx.fillStyle = '#f7f6f2';
    ctx.fillRect(0, 0, cssW, cssH);
    if (window.paperPattern) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = window.paperPattern;
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.restore();
    }

    const k = state.ufoT / UFO_DUR;
    // UFO path: sweeps from top-right to mid-left
    const ux = cssW * (1.3 - k * 1.6);
    const uy = cssH * (0.08 + k * 0.35);

    if (ufoReady && ufoImg && ufoImg.naturalWidth > 0) {
      const size = Math.min(cssW, cssH) * 0.22;
      const aspect = ufoImg.naturalWidth / ufoImg.naturalHeight;
      const uw = size * aspect;
      const uh = size;

      // UFO shadow / glow
      ctx.save();
      ctx.translate(ux, uy);

      // rotation wobble
      const wobble = Math.sin(state.ufoT * 8) * 0.06;
      ctx.rotate(wobble);

      // charge glow under the UFO
      const chargeK = Math.max(0, Math.min(1, (k - (LASER_START - 0.2)) / 0.2));
      if (chargeK > 0) {
        const gr = size * (0.6 + chargeK * 1.2);
        const g = ctx.createRadialGradient(0, uh * 0.3, 0, 0, uh * 0.3, gr);
        g.addColorStop(0, `rgba(120, 255, 80, ${0.6 * chargeK})`);
        g.addColorStop(0.4, `rgba(80, 200, 60, ${0.3 * chargeK})`);
        g.addColorStop(1, 'rgba(40, 150, 30, 0)');
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, uh * 0.3, gr, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }

      // draw UFO double-pass for pencil weight
      for (const pass of [1, 0.5]) {
        ctx.globalAlpha = pass;
        ctx.drawImage(ufoImg, -uw / 2, -uh / 2, uw, uh);
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // LASER BEAM
      if (k >= LASER_START && k < LASER_END + 0.15) {
        const beamK = Math.min(1, (k - LASER_START) / 0.08);
        const fadeK = k > LASER_END ? Math.max(0, 1 - (k - LASER_END) / 0.15) : 1;
        const targetX = cssW * 0.45;
        const targetY = cssH * 0.75;

        ctx.save();
        ctx.globalAlpha = beamK * fadeK;

        // main beam
        const grad = ctx.createLinearGradient(ux, uy + uh * 0.4, targetX, targetY);
        grad.addColorStop(0, 'rgba(120, 255, 80, 0.9)');
        grad.addColorStop(0.5, 'rgba(180, 255, 120, 0.7)');
        grad.addColorStop(1, 'rgba(255, 255, 200, 0.5)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 6 + Math.sin(state.ufoT * 40) * 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ux, uy + uh * 0.4);
        ctx.lineTo(targetX, targetY);
        ctx.stroke();

        // outer glow
        ctx.strokeStyle = `rgba(120, 255, 80, ${0.25 * beamK * fadeK})`;
        ctx.lineWidth = 22 + Math.sin(state.ufoT * 30) * 6;
        ctx.beginPath();
        ctx.moveTo(ux, uy + uh * 0.4);
        ctx.lineTo(targetX, targetY);
        ctx.stroke();

        // impact flash at target
        if (beamK > 0.5) {
          const ir = 30 + Math.sin(state.ufoT * 50) * 12;
          const ig = ctx.createRadialGradient(targetX, targetY, 0, targetX, targetY, ir);
          ig.addColorStop(0, `rgba(255, 255, 220, ${0.8 * fadeK})`);
          ig.addColorStop(0.5, `rgba(180, 255, 120, ${0.4 * fadeK})`);
          ig.addColorStop(1, 'rgba(120, 255, 80, 0)');
          ctx.fillStyle = ig;
          ctx.beginPath(); ctx.arc(targetX, targetY, ir, 0, Math.PI * 2); ctx.fill();
        }

        ctx.restore();
      }
    } else {
      // image not available — draw a simple fallback UFO silhouette so the
      // scene reads even when the asset fails to load.
      const size = Math.min(cssW, cssH) * 0.22;
      const uw = size * 1.6;
      const uh = size * 0.6;
      ctx.save();
      ctx.translate(ux, uy);
      const wobble = Math.sin(state.ufoT * 8) * 0.06;
      ctx.rotate(wobble);
      // body
      ctx.globalAlpha = 1;
      const bodyGrad = ctx.createLinearGradient(-uw / 2, 0, uw / 2, 0);
      bodyGrad.addColorStop(0, 'rgba(80,80,80,0.95)');
      bodyGrad.addColorStop(0.5, 'rgba(140,140,140,0.98)');
      bodyGrad.addColorStop(1, 'rgba(80,80,80,0.95)');
      ctx.fillStyle = bodyGrad;
      ctx.beginPath(); ctx.ellipse(0, 0, uw / 2, uh / 2, 0, 0, Math.PI * 2); ctx.fill();
      // dome
      ctx.fillStyle = 'rgba(180,220,200,0.9)';
      ctx.beginPath(); ctx.ellipse(0, -uh * 0.18, uw * 0.35, uh * 0.28, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // LASER BEAM (same as above)
      if (k >= LASER_START && k < LASER_END + 0.15) {
        const beamK = Math.min(1, (k - LASER_START) / 0.08);
        const fadeK = k > LASER_END ? Math.max(0, 1 - (k - LASER_END) / 0.15) : 1;
        const targetX = cssW * 0.45;
        const targetY = cssH * 0.75;
        ctx.save();
        ctx.globalAlpha = beamK * fadeK;
        const ux2 = ux; const uy2 = uy + uh * 0.4;
        const grad = ctx.createLinearGradient(ux2, uy2, targetX, targetY);
        grad.addColorStop(0, 'rgba(120, 255, 80, 0.9)');
        grad.addColorStop(0.5, 'rgba(180, 255, 120, 0.7)');
        grad.addColorStop(1, 'rgba(255, 255, 200, 0.5)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 6 + Math.sin(state.ufoT * 40) * 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ux2, uy2);
        ctx.lineTo(targetX, targetY);
        ctx.stroke();
        ctx.strokeStyle = `rgba(120, 255, 80, ${0.25 * beamK * fadeK})`;
        ctx.lineWidth = 22 + Math.sin(state.ufoT * 30) * 6;
        ctx.beginPath();
        ctx.moveTo(ux2, uy2);
        ctx.lineTo(targetX, targetY);
        ctx.stroke();
        if (beamK > 0.5) {
          const ir = 30 + Math.sin(state.ufoT * 50) * 12;
          const ig = ctx.createRadialGradient(targetX, targetY, 0, targetX, targetY, ir);
          ig.addColorStop(0, `rgba(255, 255, 220, ${0.8 * fadeK})`);
          ig.addColorStop(0.5, `rgba(180, 255, 120, ${0.4 * fadeK})`);
          ig.addColorStop(1, 'rgba(120, 255, 80, 0)');
          ctx.fillStyle = ig;
          ctx.beginPath(); ctx.arc(targetX, targetY, ir, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
    }

    // pencil-style label
    const pencil = '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
    if (k > 0.15 && k < 0.7) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, (k - 0.15) / 0.1) * (k < 0.6 ? 1 : Math.max(0, 1 - (k - 0.6) / 0.1));
      ctx.font = `600 26px ${pencil}`;
      ctx.fillStyle = `rgba(${INK}, 0.7)`;
      ctx.textAlign = 'center';
      ctx.fillText('! ! !', cssW / 2, cssH * 0.92);
      ctx.restore();
    }

    // vignette
    const vig = ctx.createRadialGradient(
      cssW / 2, cssH / 2, Math.min(cssW, cssH) * 0.35,
      cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.78,
    );
    vig.addColorStop(0, 'rgba(90,80,66,0)');
    vig.addColorStop(1, 'rgba(90,80,66,0.22)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, cssW, cssH);
  }

  function renderPanels(ctx, cssW, cssH, t) {
    const p = panel();
    const img = images[state.i];

    // paper background
    ctx.fillStyle = '#f7f6f2';
    ctx.fillRect(0, 0, cssW, cssH);
    if (window.paperPattern) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = window.paperPattern;
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.restore();
    }

    const scale = Math.min(cssW / W, (cssH - 54) / H) * 0.97;
    const d = drift(p.mood, t);

    // slam-in
    const k = Math.min(1, state.panelT / ENTER);
    const ease = 1 - Math.pow(1 - k, 3);
    const pop = 1 + (1 - ease) * 0.06;
    const sh = state.shake * state.shake;
    const jx = (Math.random() - 0.5) * 30 * sh + d.x;
    const jy = (Math.random() - 0.5) * 30 * sh + d.y;

    ctx.save();
    ctx.translate(cssW / 2 + jx, cssH / 2 + jy);
    ctx.rotate(d.r + (Math.random() - 0.5) * 0.012 * sh);
    ctx.scale(scale * pop, scale * pop);
    ctx.globalAlpha = ease;

    if (img && img.complete) ctx.drawImage(img, -W / 2, -H / 2, W, H);

    // pencil border
    if (typeof jitterLine === 'function' && typeof mulberry32 === 'function') {
      const rand = mulberry32(2000 + state.i);
      ctx.strokeStyle = `rgba(${INK}, 0.55)`;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      const x0 = -W / 2, y0 = -H / 2, x1 = W / 2, y1 = H / 2;
      for (const [ax, ay, bx, by] of [
        [x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0],
      ]) tracePath(ctx, jitterLine(ax, ay, bx, by, rand, 4, 90), false);
    }

    // caption text
    const [bx, by, bw, bh] = p.box;
    const lines = flat().slice(0, state.shown).split('\n');
    const longest = Math.max(...beat().lines.map((l) => l.length));
    const size = Math.min(28, ((bw - 46) / longest) * 1.85);
    const lh = size * 1.34;
    // center based on visible lines so typing doesn't shift the block
    const visibleLines = Math.max(1, lines.length);
    const top = by + bh / 2 - (visibleLines * lh) / 2;

    for (let i = 0; i < lines.length; i++) {
      pixelText(ctx, lines[i], bx - W / 2 + bw / 2, top - H / 2 + i * lh, size, `rgb(${INK})`);
    }
    // blinking continue arrow
    if (!state.typing && Math.floor(t * 2.2) % 2 === 0) {
      pixelText(ctx, '▼', bx - W / 2 + bw - 28, by - H / 2 + bh - 32, size * 0.8, `rgb(${INK})`);
    }

    ctx.restore();

    // vignette
    const vig = ctx.createRadialGradient(
      cssW / 2, cssH / 2, Math.min(cssW, cssH) * 0.4,
      cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.75,
    );
    vig.addColorStop(0, 'rgba(90,80,66,0)');
    vig.addColorStop(1, 'rgba(90,80,66,0.22)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, cssW, cssH);

    // bottom hint
    const pencil = '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
    const below = cssH / 2 + (H / 2) * scale + 26;
    ctx.font = `400 15px ${pencil}`;
    ctx.fillStyle = 'rgba(70,62,52,0.4)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('SPACE  continue', cssW / 2, Math.min(below, cssH - 14));
  }

  function render(ctx, cssW, cssH, t) {
    if (state.phase === 'ufo') {
      renderUfo(ctx, cssW, cssH, t);
    } else if (state.phase === 'panels' || state.phase === 'done') {
      renderPanels(ctx, cssW, cssH, t);
    }

    // screen flash
    if (state.flash > 0) {
      ctx.fillStyle = `rgba(255, 248, 236, ${Math.min(1, state.flash)})`;
      ctx.fillRect(0, 0, cssW, cssH);
    }
    // fade out
    if (state.fade > 0) {
      ctx.fillStyle = `rgba(247, 246, 242, ${state.fade})`;
      ctx.fillRect(0, 0, cssW, cssH);
    }
  }

  /* ---------------------------------------------------------- input / api */

  function key(e) {
    if (state.phase === 'ufo') return true;   // can't skip the UFO
    if (state.phase === 'panels') {
      advancePanel();
      return true;
    }
    return false;
  }

  window.Transform = {
    load,
    begin,
    update,
    render,
    key,
    get phase() { return state.phase; },
    get active() { return state.phase !== 'idle' && state.phase !== 'done'; },
    get ufoT() { return state.ufoT; },
    UFO_DUR,
    LASER_START,
    LASER_END,
    UFO_DMG,
  };
})();
