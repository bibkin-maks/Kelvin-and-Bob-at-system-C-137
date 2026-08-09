/* Opening cutscene - the Figma panels played as a comic.
 *
 * Panels are flat exports on purpose: the artwork uses Figma blend modes to
 * knock the white page out of each pasted asset, so a panel only looks right
 * once it has been composited there. The one exception is the cockpit, which
 * ships twice - once with Bob and once without - so he can vanish mid-scene.
 *
 * Each panel slams onto the page, settles into an idle drift keyed to what it
 * depicts, then types its captions one beat at a time. Beats can fire effects:
 * the lights go down, Bob disappears, the siren starts, the ship blows up.
 *
 * The panel art is exported with its caption box EMPTY on purpose - the words
 * live here so they can be typed. See the README before re-exporting.
 */

(function () {
  const W = 1440, H = 1024;          // panel art size; everything below is in
                                     // this space and scaled to fit the window

  // box: [x, y, w, h] of the caption plate inside the artwork.
  // mood drives the idle motion, so each panel moves like what it depicts.
  const PANELS = [
    {
      src: 'assets/scenes/s1.png', box: [480, 825, 481, 129], pitch: 600, mood: 'calm',
      beats: [
        { lines: ['SYSTEM C-137'] },
        { lines: ['NOTHING OUT HERE BUT DUST.'] },
      ],
    },
    {
      src: 'assets/scenes/s2.png', box: [68, 512, 566, 129], pitch: 500, mood: 'rage',
      beats: [
        { lines: ['SCARY AHH PLANET.'] },
        { lines: ["GOOD THING WE'RE JUST PASSING."] },
        { lines: ['SOMETHING DOWN THERE', 'SURVIVED THE APOCALYPSE.'] },
      ],
    },
    {
      src: 'assets/scenes/s3.png', box: [53, 836, 481, 129], pitch: 670, mood: 'drift',
      beats: [
        { lines: ["KELVIN WASN'T STOPPING HERE."] },
        { lines: ['KELVIN HAD A REAL MISSION.', 'THREE SYSTEMS OVER.'] },
      ],
    },
    {
      src: 'assets/scenes/s4.png', box: [60, 74, 481, 129], pitch: 560, mood: 'hum',
      // the empty version is swapped in when Bob leaves his seat
      alt: 'assets/scenes/s4_empty.png',
      beats: [
        { lines: ['KELVIN NEEDED A PILOT.'] },
        { lines: ['THIS IS BOB.'] },
        { lines: ['BOB IS A SQUIRREL.'] },
        { lines: ['HR CLEARED HIM IN NINE MINUTES.', 'NOBODY ELSE APPLIED.'] },
        { lines: ['THE FORM NEVER ASKED HIS SPECIES.', 'KELVIN NEVER READ THE FORM.'] },
        { lines: ['...BOB?'], fx: ['dim', 'bobGone', 'siren'], pitch: 420 },
        { lines: ['BOB.'], pitch: 420 },
      ],
    },
    {
      src: 'assets/scenes/s5.png', box: [60, 74, 492, 129], pitch: 520, mood: 'rage',
      dark: true,
      beats: [
        { lines: ['HE IS IN THE WIRING LOOM.'] },
        { lines: ['HE IS EATING THE SHIP.'] },
      ],
    },
    {
      src: 'assets/scenes/s6.png', box: [60, 74, 492, 129], pitch: 480, mood: 'blast',
      beats: [
        { lines: ['BOB!'], fx: ['explode'] },
        { lines: ['YOU ABSOLUTE FUCKING IDIOT.'] },
        { lines: ['WE ARE NOT WHERE', 'WE WERE GOING.'] },
      ],
    },
  ];

  const INK = '69, 27, 11';          // the caption box's own dark brown

  const TYPE_MS = 34;                // per character
  const PAUSE = { '.': 260, ',': 140, '!': 260, '?': 260, '-': 60 };
  const ENTER = 0.42;                // panel slam-in duration
  const PIX = 2;                     // text is rendered small then upscaled
                                     // with smoothing off, to match the box

  /* ------------------------------------------------------------------ sound */

  // Everything is synthesised: blips per character, a thud when a panel lands,
  // a two-tone siren, an explosion. No audio files, so the game stays a single
  // self-contained folder.
  const Audio_ = {
    ctx: null, ready: false, siren: null, noiseBuf: null,

    unlock() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.ready = true;
    },

    tone({ freq = 600, dur = 0.05, type = 'square', gain = 0.05, slide = 0, cutoff = 2600, delay = 0 }) {
      if (!this.ready) return;
      const t = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const amp = this.ctx.createGain();
      const lp = this.ctx.createBiquadFilter();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);

      lp.type = 'lowpass';
      lp.frequency.value = cutoff;     // takes the fizz off a raw square

      // near-instant attack, exponential tail: a printer tick, not a beep
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(gain, t + 0.004);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      osc.connect(lp).connect(amp).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },

    /** Filtered white noise - steam, blast debris, skidding metal. */
    noise({ dur = 0.5, gain = 0.15, cutoff = 1400, sweep = 0, delay = 0 }) {
      if (!this.ready) return;
      const t = this.ctx.currentTime + delay;
      if (!this.noiseBuf) {
        const n = this.ctx.sampleRate * 2;
        this.noiseBuf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(cutoff, t);
      if (sweep) lp.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff + sweep), t + dur);
      const amp = this.ctx.createGain();
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.05, dur * 0.2));
      amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(lp).connect(amp).connect(this.ctx.destination);
      src.start(t);
      src.stop(t + dur + 0.05);
    },

    blip(base, ch) {
      // punctuation lands lower and longer, which gives typed lines a cadence
      const punct = ch in PAUSE;
      this.tone({
        freq: (punct ? base * 0.62 : base) * (0.94 + Math.random() * 0.12),
        dur: punct ? 0.075 : 0.042,
        gain: punct ? 0.045 : 0.035,
      });
    },

    thud() {
      this.tone({ freq: 150, dur: 0.11, gain: 0.09, slide: -70, cutoff: 900 });
      this.tone({ freq: 62, dur: 0.16, gain: 0.07, type: 'sine', slide: -20 });
    },

    page() { this.tone({ freq: 900, dur: 0.05, gain: 0.03, slide: 260 }); },

    /** Two-tone alarm on a repeating timer, so it keeps wailing under the scene. */
    startSiren() {
      if (!this.ready || this.siren) return;
      const cycle = () => {
        this.tone({ freq: 620, dur: 0.42, gain: 0.05, type: 'sawtooth', cutoff: 1200, slide: 180 });
        this.tone({ freq: 470, dur: 0.42, gain: 0.045, type: 'sawtooth', cutoff: 1200, slide: 140, delay: 0.45 });
      };
      cycle();
      this.siren = setInterval(cycle, 900);
    },

    stopSiren() {
      if (this.siren) { clearInterval(this.siren); this.siren = null; }
    },

    explode() {
      this.stopSiren();
      this.noise({ dur: 1.5, gain: 0.34, cutoff: 2200, sweep: -1900 });
      this.tone({ freq: 220, dur: 0.7, gain: 0.22, type: 'square', slide: -190, cutoff: 500 });
      this.tone({ freq: 80, dur: 1.1, gain: 0.26, type: 'sine', slide: -50 });
    },
  };

  /* ------------------------------------------------------------------ state */

  const state = {
    i: 0, beat: 0,     // panel, and which caption beat inside it
    t: 0,              // seconds inside the current panel
    shown: 0,          // characters typed
    nextAt: 0,         // ms until the next character
    typing: false,
    started: false,    // false until the first keypress (also unlocks audio)
    done: false,
    fade: 0,           // 0 -> 1 wipe out at the end
    shake: 0,          // impulse, decays
    dim: 0,            // "shadow down" on the cockpit
    red: 0,            // siren glow
    flash: 0,          // explosion whiteout
    bobGone: false,
  };

  const images = [];
  const alts = [];
  let onFinish = null;
  let textCanvas = null;

  const panel = () => PANELS[state.i];
  const beat = () => panel().beats[state.beat];
  const flat = () => beat().lines.join('\n');
  const pitch = () => beat().pitch || panel().pitch;

  function startBeat(reset) {
    state.shown = 0;
    state.nextAt = reset ? 260 : 90;   // longer beat when the panel just landed
    state.typing = true;
    for (const fx of beat().fx || []) {
      if (fx === 'dim') state.dim = 1;
      if (fx === 'bobGone') state.bobGone = true;
      if (fx === 'siren') { state.red = 1; Audio_.startSiren(); }
      if (fx === 'explode') { state.flash = 1; state.shake = 1.6; Audio_.explode(); }
    }
  }

  function beginPanel(i) {
    state.i = i;
    state.beat = 0;
    state.t = 0;
    state.shake = 1;
    if (!PANELS[i].keepFx) { state.dim = PANELS[i].dark ? 0.45 : 0; state.red = 0; }
    Audio_.thud();
    startBeat(true);
  }

  function advance() {
    if (!state.started) {            // first press: wake audio, start panel 1
      Audio_.unlock();
      state.started = true;
      beginPanel(0);
      return;
    }
    if (state.typing) {              // mid-line: finish it instantly
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
    if (state.i < PANELS.length - 1) { Audio_.page(); beginPanel(state.i + 1); return; }
    state.done = true;               // last panel: wipe through to the crash
  }

  function skip() {
    Audio_.unlock();
    Audio_.stopSiren();
    state.started = true;
    state.done = true;
  }

  /* ----------------------------------------------------------------- update */

  function update(dt) {
    state.shake = Math.max(0, state.shake - dt * 2.6);
    state.flash = Math.max(0, state.flash - dt * 1.7);

    if (state.done) {
      Audio_.stopSiren();
      state.fade = Math.min(1, state.fade + dt * 1.8);
      if (state.fade >= 1 && onFinish) { const f = onFinish; onFinish = null; f(); }
      return;
    }
    if (!state.started) return;

    state.t += dt;
    if (!state.typing || state.t < ENTER * 0.55) return;

    const text = flat();
    state.nextAt -= dt * 1000;
    while (state.nextAt <= 0 && state.shown < text.length) {
      const ch = text[state.shown];
      state.shown++;
      // every other character, so a line ticks rather than machine-guns
      if (ch.trim() && state.shown % 2 === 0) Audio_.blip(pitch(), ch);
      state.nextAt += TYPE_MS + (PAUSE[ch] || 0) + (ch === '\n' ? 220 : 0);
    }
    if (state.shown >= text.length) state.typing = false;
  }

  /* ----------------------------------------------------------------- render */

  /** Chunky upscaled text, so the caption matches the pixel plate it sits on. */
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

    ctx.imageSmoothingEnabled = false;   // the whole point: hard pixel edges
    ctx.drawImage(c, 0, 0, w, h, Math.round(cx - (w * PIX) / 2), Math.round(y), w * PIX, h * PIX);
    ctx.imageSmoothingEnabled = true;
  }

  /** Idle motion, per panel mood. Small, but it keeps the page alive. */
  function drift(mood, t) {
    switch (mood) {
      case 'rage':   // a tremor that swells and backs off
        return { x: Math.sin(t * 23) * (1.4 + Math.sin(t * 1.7) * 1.4),
                 y: Math.cos(t * 19) * 1.1, r: Math.sin(t * 11) * 0.0016 };
      case 'drift':  // the ship: long slow sweep
        return { x: Math.sin(t * 0.5) * 5, y: Math.cos(t * 0.37) * 3.4, r: Math.sin(t * 0.3) * 0.0012 };
      case 'hum':    // cockpit: engine buzz
        return { x: Math.sin(t * 31) * 0.8, y: Math.cos(t * 27) * 0.7, r: 0 };
      case 'blast':  // the detonation still ringing
        return { x: Math.sin(t * 37) * 2.6, y: Math.cos(t * 41) * 2.2, r: Math.sin(t * 29) * 0.002 };
      default:       // deep space: almost still
        return { x: Math.sin(t * 0.7) * 2.2, y: Math.cos(t * 0.5) * 1.8, r: 0 };
    }
  }

  function render(ctx, cssW, cssH, t) {
    const p = panel();
    // Bob's seat empties on cue: the cockpit ships as two flat exports and the
    // scene simply swaps to the one drawn without him
    const img = (state.bobGone && alts[state.i]) ? alts[state.i] : images[state.i];

    // paper first, so the letterbox reads as the page the comic is drawn on
    ctx.fillStyle = '#f7f6f2';
    ctx.fillRect(0, 0, cssW, cssH);
    if (window.paperPattern) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = window.paperPattern;
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.restore();
    }

    // leave a margin so the page shows around the panel and the hint below it
    // never lands on the artwork
    const scale = Math.min(cssW / W, (cssH - 54) / H) * 0.97;
    const d = state.started ? drift(p.mood, t) : { x: 0, y: 0, r: 0 };

    // slam-in: overshoot the scale and shudder, then settle
    const k = Math.min(1, state.t / ENTER);
    const ease = 1 - Math.pow(1 - k, 3);
    const pop = state.started ? 1 + (1 - ease) * 0.05 : 1;
    const sh = state.shake * state.shake;
    const jx = (Math.random() - 0.5) * 26 * sh + d.x;
    const jy = (Math.random() - 0.5) * 26 * sh + d.y;

    ctx.save();
    ctx.translate(cssW / 2 + jx, cssH / 2 + jy);
    ctx.rotate(d.r + (Math.random() - 0.5) * 0.01 * sh);
    ctx.scale(scale * pop, scale * pop);
    ctx.globalAlpha = state.started ? ease : 1;

    if (img && img.complete) ctx.drawImage(img, -W / 2, -H / 2, W, H);

    // lights down, then the alarm lamp washes the cockpit red
    if (state.dim > 0) {
      ctx.fillStyle = `rgba(14, 12, 20, ${0.62 * state.dim})`;
      ctx.fillRect(-W / 2, -H / 2, W, H);
    }
    if (state.red > 0) {
      const pulse = 0.35 + Math.abs(Math.sin(t * 3.4)) * 0.65;
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 120, 60, 0, 120, W * 0.72);
      g.addColorStop(0, `rgba(255, 40, 26, ${0.42 * pulse * state.red})`);
      g.addColorStop(0.5, `rgba(220, 26, 18, ${0.20 * pulse * state.red})`);
      g.addColorStop(1, 'rgba(160, 0, 0, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(-W / 2, -H / 2, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }

    // pencil border, so the panel sits on the page like the rest of the game
    if (typeof jitterLine === 'function' && typeof mulberry32 === 'function') {
      const rand = mulberry32(1000 + state.i);
      ctx.strokeStyle = `rgba(${INK}, 0.55)`;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      const x0 = -W / 2, y0 = -H / 2, x1 = W / 2, y1 = H / 2;
      for (const [ax, ay, bx, by] of [
        [x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0],
      ]) tracePath(ctx, jitterLine(ax, ay, bx, by, rand, 4, 90), false);
    }

    // caption: typed into the plate the artwork already carries
    const [bx, by, bw, bh] = p.box;
    const lines = flat().slice(0, state.shown).split('\n');
    const longest = Math.max(...beat().lines.map((l) => l.length));
    const size = Math.min(30, ((bw - 52) / longest) * 1.85);
    const lh = size * 1.34;
    // center based on visible lines so typing doesn't shift the block
    const visibleLines = Math.max(1, lines.length);
    const top = by + bh / 2 - (visibleLines * lh) / 2;

    if (state.started) {
      for (let i = 0; i < lines.length; i++) {
        pixelText(ctx, lines[i], bx - W / 2 + bw / 2, top - H / 2 + i * lh, size, `rgb(${INK})`);
      }
      // blinking continue arrow once the line has finished printing
      if (!state.typing && Math.floor(t * 2.2) % 2 === 0) {
        pixelText(ctx, '▼', bx - W / 2 + bw - 30, by - H / 2 + bh - 34, size * 0.8, `rgb(${INK})`);
      }
    } else if (Math.floor(t * 1.6) % 2 === 0) {
      pixelText(ctx, 'PRESS ANY KEY', bx - W / 2 + bw / 2, top - H / 2, size, `rgb(${INK})`);
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

    // the plate already says "press any key" before the scene starts, so the
    // margin hint only appears once there is something to continue or skip
    if (state.started) {
      const below = cssH / 2 + (H / 2) * scale + 26;
      ctx.font = '400 15px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
      ctx.fillStyle = 'rgba(70,62,52,0.4)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('SPACE  continue      ESC  skip', cssW / 2, Math.min(below, cssH - 14));
    }

    if (state.flash > 0) {
      ctx.fillStyle = `rgba(255, 248, 236, ${Math.min(1, state.flash)})`;
      ctx.fillRect(0, 0, cssW, cssH);
    }
    if (state.fade > 0) {
      ctx.fillStyle = `rgba(247, 246, 242, ${state.fade})`;
      ctx.fillRect(0, 0, cssW, cssH);
    }
  }

  /* ------------------------------------------------------------------- api */

  window.Intro = {
    audio: Audio_,

    load() {
      const one = (src, put) => new Promise((res) => {
        const im = new Image();
        im.onload = im.onerror = () => res();   // a missing panel skips, not hangs
        im.src = src;
        put(im);
      });
      const jobs = PANELS.map((p, i) => one(p.src, (im) => { images[i] = im; }));
      PANELS.forEach((p, i) => { if (p.alt) jobs.push(one(p.alt, (im) => { alts[i] = im; })); });
      return Promise.all(jobs);
    },

    begin(done) { onFinish = done; },

    key(e) {
      if (state.done) return true;
      if (e.code === 'Escape' || e.code === 'KeyS') skip();
      else advance();
      return true;                              // swallow input while playing
    },

    update, render,
  };
})();
