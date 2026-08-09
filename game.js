/* Paper Soldier - a 2D platformer drawn on the same sheet as its hero.
 *
 * The character frames come out of soldier.mp4 via tools/extract_sprites.py.
 * Everything else - ground, platforms, pickups - is stroked at runtime with a
 * jittered pencil line so the level looks like it was sketched next to him.
 */

const META = window.SPRITE_META.soldier;
const BOSS = window.SPRITE_META.hater;
// the buffed form: torso and legs are drawn on separate frames, so the game
// composites them at runtime instead of using one baked pose per frame
const MUSCLE = window.SPRITE_META.muscule;

const VIEW_H = 620;          // world units visible vertically, at any window size
const GROUND_Y = 560;        // top surface of the ground
const DEATH_Y = 1150;

const GRAVITY = 2300;
const MAX_FALL = 1500;
const MOVE_SPEED = 335;
const GROUND_ACCEL = 2600;
const AIR_ACCEL = 1600;
const GROUND_FRICTION = 3000;
const AIR_DRAG = 500;
const JUMP_V = 960;
const JUMP_CUT = 0.45;       // velocity kept when the jump key is released early
const COYOTE = 0.10;         // grace period after walking off a ledge
const BUFFER = 0.12;         // jump pressed just before landing still counts

const PLAYER_W = 54;
const PLAYER_H = 172;
// Scale against collar-to-boots, so the body fills the hitbox and the grafted
// head rides above it rather than the whole figure shrinking to fit.
const SPRITE_SCALE = PLAYER_H / META.bodyH;
const RIFLE_Y = 638;     // barrel height above the boot line, in sprite pixels

const SHOT_SPEED = 980;
// Heavy, deliberate rifle rather than a machine gun: at a faster rate the fight
// is over before the hater finishes his first swing.
const SHOT_COOLDOWN = 0.5;
// Shots die well short of the far end of the arena, so there is no spot you can
// stand and safely whittle him down from - to hurt him you have to be somewhere
// he can reach you back.
const SHOT_RANGE = 520;

// Jetpack. Thrust beats gravity comfortably so the corridor is controllable,
// but not so much that you can pin yourself to the roof and coast.
const JET_THRUST = 3500;
const JET_MAX = 430;
const jetPuffs = [];
const HURT_TIME = 1.2;       // invulnerability after the hater connects

const PLAYER_MAX_HP = 100;
const BOSS_HIT_DMG = 20;     // claw hit damage
const JAB_RANGE = 130;       // melee reach in muscular mode
const JAB_COOLDOWN = 0.32;   // faster than rifle, but you're in his face
const JAB_DMG_HITBOX = { w: 130, h: 200 };  // jab hitbox vs boss

// The hater hangs off a tube over the last stretch of the level. His timings
// are the whole fight: a long telegraph you can read and run out of, then a
// slam that owns the ground beneath him.
const TUBE_Y = 120;
const BOSS_START_X = 4800;
const BOSS_H = 380;                    // drawn height in world units
const BOSS_SCALE = BOSS_H / BOSS.frameHeight;
const BOSS_HP = 12;
const BOSS_TRANSFORM_HP = Math.floor(BOSS_HP / 2);  // trigger at half health
const BOSS_TIMING = { hang: 1.0, prep: 0.45, load: 0.35, strike: 0.55 };
// Only the impact hurts, not the whole swing animation. Any longer and a player
// who jumped it falls back into the claw before it lifts.
const STRIKE_ACTIVE = 0.14;
const BOSS_SLIDE = 240;                // how fast he hauls himself along the pipe
const BOSS_REACH = 300;                // he only commits once you're this close
const BOSS_HIT = { w: 300, h: 300, cy: TUBE_Y + 205 };   // where shots land
// Matched to where the claw is actually inked in the strike frame, relative to
// his position and mirrored with his facing. y0 is a floor rather than a
// ceiling: it owns the ground under him, so backing off works and so does a
// jump timed over the swing.
// y0 sits where the claw is actually inked at the bottom of its swing, so a
// jump timed near its apex passes over the top of it.
const CLAW_ZONE = { near: 70, far: 230, y0: 400 };

const INK = '46, 42, 38';

/* ---------------------------------------------------------------- sketching */

/** Small deterministic PRNG, so a given line wobbles the same way every frame. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A straight run from a to b, broken into segments that drift off the line. */
function jitterLine(x1, y1, x2, y2, rand, amp = 2.2, step = 26) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const n = Math.max(2, Math.round(len / step));
  const nx = -dy / len, ny = dx / len;   // unit normal, to push points sideways
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // pin the ends so corners still meet
    const edge = Math.min(t, 1 - t) * 2;
    const off = (rand() - 0.5) * 2 * amp * Math.min(1, edge * 2.5);
    pts.push({ x: x1 + dx * t + nx * off, y: y1 + dy * t + ny * off });
  }
  return pts;
}

/** Corner list -> one jittered outline. tracePath smooths hard, so shapes with
 *  few corners need their edges subdivided or they round off into blobs. */
function polyPath(corners, rand, amp = 2, step = 16) {
  const pts = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    pts.push(...jitterLine(a[0], a[1], b[0], b[1], rand, amp, step).slice(0, -1));
  }
  return pts;
}

function tracePath(ctx, pts, close) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    // midpoint smoothing keeps the wobble organic instead of angular
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  if (close) ctx.closePath();
  ctx.stroke();
}

/** Outline + shading for one solid block, baked once at level build time. */
function sketchBlock(x, y, w, h, seed, opts = {}) {
  const rand = mulberry32(seed);
  const shadeDepth = Math.min(opts.shadeDepth || h, h);
  const outline = [
    jitterLine(x, y, x + w, y, rand, 2.6),
    jitterLine(x + w, y, x + w, y + h, rand, 2.2),
    jitterLine(x + w, y + h, x, y + h, rand, 2.2),
    jitterLine(x, y + h, x, y, rand, 2.2),
  ];
  // a second, looser pass over the top edge - the line an artist redraws
  const topAccent = jitterLine(x + 4, y + 2, x + w - 4, y + 2, rand, 3.4);

  const hatch = [];
  const spacing = opts.hatchSpacing || 15;
  for (let sx = x - shadeDepth; sx < x + w; sx += spacing) {
    const x1 = Math.max(x + 2, sx);
    const y1 = y + 2 + (x1 - sx);
    const x2 = Math.min(x + w - 2, sx + shadeDepth);
    const y2 = y + 2 + (x2 - sx);
    if (x2 - x1 < 4 || y1 > y + h - 2) continue;
    const cy2 = Math.min(y2, y + h - 2);
    // uneven pressure per stroke, so the shading doesn't read as machine fill
    hatch.push({
      pts: jitterLine(x1, y1, x1 + (cy2 - y1), cy2, rand, 1.4, 40),
      alpha: 0.13 + rand() * 0.16,
      width: 1.5 + rand() * 1.2,
    });
  }
  return { outline, topAccent, hatch, x, y, w, h };
}

function drawBlock(ctx, block) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const line of block.hatch) {
    ctx.strokeStyle = `rgba(${INK}, ${line.alpha})`;
    ctx.lineWidth = line.width;
    tracePath(ctx, line.pts, false);
  }

  ctx.strokeStyle = `rgba(${INK}, 0.82)`;
  ctx.lineWidth = 3.2;
  for (const edge of block.outline) tracePath(ctx, edge, false);

  ctx.strokeStyle = `rgba(${INK}, 0.45)`;
  ctx.lineWidth = 1.6;
  tracePath(ctx, block.topAccent, false);
}

/* ------------------------------------------------------------------- level */

const LEVEL_W = 5300;

const GROUND_SPANS = [
  [-260, 900], [1120, 1780], [3400, LEVEL_W + 260],
];

// The jetpack corridor. No floor, a roof you cannot climb over, and a drop
// that kills - the only way to the far side is to fly it.
const FLIGHT = { x0: 1780, x1: 3400, roof: 0, deathY: 810 };
// hangers drop from the roof, pillars rise out of the dark; alternating, so
// crossing is a weave rather than a straight line
const FLIGHT_HANG = [[1900, 300], [2400, 340], [2900, 280]];
const FLIGHT_RISE = [[2150, 460], [2650, 420], [3150, 480]];

// the hater's arena: flat ground, nothing to hide behind, one long pipe
const TUBE_X0 = 4300;
const TUBE_X1 = LEVEL_W + 120;

const PLATFORM_RECTS = [
  [560, 420, 165, 26], [830, 322, 145, 26],
  // this last one has to end clear of the corridor mouth: a ledge reaching
  // into it would wedge you against the first hanger with no way under
  [1210, 425, 180, 26], [1450, 335, 150, 26], [1600, 250, 150, 26],
  // nothing between 1780 and 3400: that stretch is the flight corridor.
  // Past it, the run-up to the arena is kept low on purpose - a high ledge
  // inside rifle range would be a safe perch to shoot the hater from.
  [3520, 438, 165, 26], [3820, 462, 150, 26],
];
// Nothing stands between the last platform and the tube. A perch inside rifle
// range is a free win: the claw sweeps the floor, so anything up on a ledge is
// out of its reach while still being able to shoot back. checkGame asserts no
// platform can reach him.

const PICKUPS = [
  [340, 480], [642, 360], [912, 262], [1160, 300], [1298, 365],
  [1545, 275], [1740, 190],
  // strung through the corridor, so flying well is worth something
  [2010, 380], [2280, 210], [2560, 470], [2860, 230], [3120, 400], [3330, 180],
  [3600, 390], [3880, 415], [4040, 470],
  [4120, 470], [4270, 470],
];

const solids = [];
const blocks = [];
let seedCounter = 1;

// invisible bookends, so you can't run off either edge of the page
solids.push({ x: GROUND_SPANS[0][0] - 40, y: -900, w: 40, h: 1600 });
solids.push({ x: LEVEL_W + 160, y: -900, w: 40, h: 1600 });

// the wrecked ship is solid once it has landed, so Kelvin can climb the hull.
// Kept narrower and lower than the drawing: the nose and tail taper to nothing
// and standing on empty air where the art thins out reads as a bug.
const WRECK = { x: -130, y: GROUND_Y - 92, w: 310, h: 92 };
solids.push(WRECK);

for (const [x0, x1] of GROUND_SPANS) {
  solids.push({ x: x0, y: GROUND_Y, w: x1 - x0, h: 620 });
  blocks.push(sketchBlock(x0, GROUND_Y, x1 - x0, 620, seedCounter++, {
    shadeDepth: 78, hatchSpacing: 17,
  }));
}
for (const [x, y, w, h] of PLATFORM_RECTS) {
  solids.push({ x, y, w, h });
  blocks.push(sketchBlock(x, y, w, h, seedCounter++, { shadeDepth: 22, hatchSpacing: 11 }));
}

// the corridor roof, and the teeth hanging off it / rising into it
{
  const w = FLIGHT.x1 - FLIGHT.x0 + 80;
  solids.push({ x: FLIGHT.x0 - 40, y: FLIGHT.roof - 620, w, h: 620 });
  blocks.push(sketchBlock(FLIGHT.x0 - 40, FLIGHT.roof - 620, w, 620, seedCounter++,
    { shadeDepth: 70, hatchSpacing: 19 }));

  for (const [x, drop] of FLIGHT_HANG) {
    solids.push({ x, y: FLIGHT.roof, w: 64, h: drop });
    blocks.push(sketchBlock(x, FLIGHT.roof, 64, drop, seedCounter++,
      { shadeDepth: 22, hatchSpacing: 12 }));
  }
  for (const [x, top] of FLIGHT_RISE) {
    const h = FLIGHT.deathY + 120 - top;
    solids.push({ x, y: top, w: 64, h });
    blocks.push(sketchBlock(x, top, 64, h, seedCounter++,
      { shadeDepth: 22, hatchSpacing: 12 }));
  }
}

const pickups = PICKUPS.map(([x, y], i) => ({
  x, y, taken: false, phase: i * 0.7, seed: 900 + i,
}));

/* -------------------------------------------------------------------- boss */

const boss = {
  x: BOSS_START_X, facing: -1,
  hp: BOSS_HP, state: 'hang', t: 0, flinch: 0, dying: 0, dead: false,
};

/** The claw's reach this swing, in world x. The art swings toward `facing`. */
function clawSpan() {
  return boss.facing < 0
    ? [boss.x - CLAW_ZONE.far, boss.x + CLAW_ZONE.near]
    : [boss.x - CLAW_ZONE.near, boss.x + CLAW_ZONE.far];
}

const bullets = [];

/** Where the rifle muzzle sits, in world space. Measured up from the boots so
 *  it survives the sprite canvas growing to make room for his head. */
function muzzle() {
  return {
    x: player.x + PLAYER_W / 2 + player.facing * 78,
    y: player.y + PLAYER_H - RIFLE_Y * SPRITE_SCALE,
  };
}

function bossFrame() {
  if (boss.dying > 0 || boss.flinch > 0) return BOSS.hurt[0];
  return BOSS[boss.state][0];
}

/** Gentle sway while he hangs; the attack states hold still and mean it. */
function bossSway(t) {
  if (boss.dying > 0) return 0;
  return boss.state === 'hang' ? Math.sin(t * 1.7) * 9 : 0;
}

function updateBoss(dt, t) {
  if (boss.dead) return;
  boss.flinch = Math.max(0, boss.flinch - dt);

  if (boss.dying > 0) {
    boss.dying += dt;
    if (boss.dying > 1.6) { boss.dead = true; won = true; }
    return;
  }

  // He wakes exactly when you can hurt him, so there's no window where you get
  // to shoot a dormant target.
  const engaged = Math.abs(player.x - boss.x) < SHOT_RANGE + BOSS_HIT.w / 2 + 120;
  if (!engaged) { boss.state = 'hang'; boss.t = 0; return; }

  // While hanging he hauls himself along the pipe after you, so backing out of
  // the claw's reach only buys time - you can't just out-range him and plink.
  // Once he commits to a swing he's locked in place, which is the opening.
  if (boss.state === 'hang') {
    const to = (player.x + PLAYER_W / 2) - boss.x;
    const step = Math.min(Math.abs(to), BOSS_SLIDE * dt) * Math.sign(to);
    boss.x = Math.max(TUBE_X0 + 140, Math.min(TUBE_X1 - 140, boss.x + step));
  }

  boss.t += dt;
  if (boss.t < BOSS_TIMING[boss.state]) {
    if (boss.state === 'strike' && boss.t < STRIKE_ACTIVE && !player.hurt) {
      const [zx0, zx1] = clawSpan();
      const hits = player.x + PLAYER_W > zx0 && player.x < zx1
        && player.y + PLAYER_H > CLAW_ZONE.y0;
      if (hits) hurtPlayer();
    }
    return;
  }

  // he waits on the pipe until you're worth swinging at
  if (boss.state === 'hang' && Math.abs(player.x + PLAYER_W / 2 - boss.x) > BOSS_REACH) {
    boss.t = 0;
    return;
  }
  if (boss.state === 'hang') boss.facing = player.x + PLAYER_W / 2 < boss.x ? -1 : 1;

  boss.t = 0;
  boss.state = { hang: 'prep', prep: 'load', load: 'strike', strike: 'hang' }[boss.state];
}

function hurtPlayer(dmg) {
  player.hurt = HURT_TIME;
  player.vx = -420;
  player.vy = -420;
  player.hitsTaken++;
  player.hp = Math.max(0, player.hp - (dmg || BOSS_HIT_DMG));
}

/** Explode the player: strong visual, spawn splatter particles and knockback. */
function explodePlayer(dmg) {
  player.hp = Math.max(0, player.hp - (dmg || PLAYER_MAX_HP));
  player.hurt = HURT_TIME;
  player.hitsTaken++;
  // big knockback
  player.vx = (Math.random() - 0.5) * 800;
  player.vy = -720;

  // spawn lots of ink splatter
  for (let si = 0; si < 24; si++) {
    inkSplatters.push({
      x: player.x + PLAYER_W / 2,
      y: player.y + PLAYER_H / 2,
      vx: (Math.random() - 0.5) * (240 + Math.random() * 420),
      vy: -220 + Math.random() * 600,
      r: 6 + Math.random() * 14,
      life: 0, max: 0.8 + Math.random() * 1.2,
      seed: (Math.random() * 1e9) | 0,
    });
  }

  // screen whiteout flash
  playerFlash = 1.6;
}

let transformTriggered = false;

function damageBoss() {
  boss.hp--;
  boss.flinch = 0.2;

  // trigger transformation cutscene at half health
  if (!transformTriggered && boss.hp <= BOSS_TRANSFORM_HP && boss.hp > 0) {
    transformTriggered = true;
    scene = 'transform';
    Transform.begin(
      () => {
        // cutscene finished — resume play in muscular mode
        scene = 'play';
        player.muscular = true;
        last = 0;
      },
      (dmg) => {
        // UFO laser damage callback — make the player 'blow up'
        explodePlayer(dmg);
      },
    );
    return;
  }

  if (boss.hp <= 0) {
    boss.dying = 0.0001;
    boss.state = 'hurt';
  }
}

/* ------------------------------------------------------------------ player */

const player = {
  x: 120, y: GROUND_Y - PLAYER_H, vx: 0, vy: 0,
  facing: 1, onGround: false,
  coyote: 0, buffer: 0, squash: 0, cooldown: 0, kick: 0,
  hurt: 0, hitsTaken: 0,
  hp: PLAYER_MAX_HP,
  muscular: false,          // flips to true after the transformation cutscene
  jabAnim: 0,               // jab punch animation timer
  animTime: 0, spawnX: 120, spawnY: GROUND_Y - PLAYER_H,
  restY: GROUND_Y - PLAYER_H,   // last height he stood at; drives the camera
};

// muscular body assets
const musculeSheet = new Image();
const muscleHead = new Image();
let playerFlash = 0;

let collected = 0;
let won = false;
let elapsed = 0;

/* ------------------------------------------------------------------- input */

// 'intro' cutscene -> 'crash' landing on the field -> 'play' -> 'transform' -> 'play'
let scene = 'intro';

// ink splatter particles for melee hits
const inkSplatters = [];

const keys = new Set();
const LEFT = ['ArrowLeft', 'KeyA'];
const RIGHT = ['ArrowRight', 'KeyD'];
const JUMP = ['Space', 'ArrowUp', 'KeyW', 'KeyZ'];
const SHOOT = ['KeyF', 'KeyJ'];

addEventListener('keydown', (e) => {
  if ([...LEFT, ...RIGHT, ...JUMP, ...SHOOT].includes(e.code)) e.preventDefault();
  // the cutscene owns the keyboard until it hands over
  if (scene === 'intro') { Intro.key(e); return; }
  if (scene === 'crash') { Crash.skip(); return; }
  if (scene === 'transform') { Transform.key(e); return; }
  if (JUMP.includes(e.code) && !keys.has(e.code)) player.buffer = BUFFER;
  if (e.code === 'KeyR') reset();
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('pointerdown', (e) => {
  if (scene === 'intro') Intro.key(e);
  else if (scene === 'crash') Crash.skip();
  else if (scene === 'transform') Transform.key(e);
});
addEventListener('blur', () => keys.clear());

const held = (list) => list.some((c) => keys.has(c));

function reset() {
  player.x = 120;
  player.y = GROUND_Y - PLAYER_H;
  player.vx = player.vy = 0;
  player.facing = 1;
  player.spawnX = 120;
  player.spawnY = GROUND_Y - PLAYER_H;
  player.restY = GROUND_Y - PLAYER_H;
  player.cooldown = player.kick = player.hurt = 0;
  player.jetting = false;
  player.hitsTaken = 0;
  player.hp = PLAYER_MAX_HP;
  player.muscular = false;
  player.jabAnim = 0;
  for (const p of pickups) p.taken = false;
  bullets.length = 0;
  jetPuffs.length = 0;
  inkSplatters.length = 0;
  Flight.reset();
  Object.assign(boss, {
    x: BOSS_START_X, facing: -1,
    hp: BOSS_HP, state: 'hang', t: 0, flinch: 0, dying: 0, dead: false,
  });
  transformTriggered = false;
  if (scene !== 'intro' && scene !== 'crash') scene = 'play';
  collected = 0;
  won = false;
  elapsed = 0;
}

/* ----------------------------------------------------------------- physics */

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function update(dt, t = 0) {
  if (!won) elapsed += dt;
  player.hurt = Math.max(0, player.hurt - dt);
  player.cooldown = Math.max(0, player.cooldown - dt);
  player.kick += (0 - player.kick) * Math.min(1, dt * 14);
  playerFlash = Math.max(0, playerFlash - dt * 1.2);

  const dir = (held(RIGHT) ? 1 : 0) - (held(LEFT) ? 1 : 0);
  const accel = player.onGround ? GROUND_ACCEL : AIR_ACCEL;

  if (dir !== 0 && !won) {
    player.vx += dir * accel * dt;
    player.vx = Math.max(-MOVE_SPEED, Math.min(MOVE_SPEED, player.vx));
    player.facing = dir;
  } else {
    const drag = (player.onGround ? GROUND_FRICTION : AIR_DRAG) * dt;
    player.vx = Math.abs(player.vx) <= drag ? 0 : player.vx - Math.sign(player.vx) * drag;
  }

  player.coyote = player.onGround ? COYOTE : Math.max(0, player.coyote - dt);
  player.buffer = Math.max(0, player.buffer - dt);

  if (player.buffer > 0 && player.coyote > 0 && !won) {
    player.vy = -JUMP_V;
    player.buffer = 0;
    player.coyote = 0;
    player.onGround = false;
    player.squash = -0.16;              // stretch tall on the way up
  }
  // releasing the key mid-rise cuts the arc short
  if (player.vy < 0 && !held(JUMP) && !player.jetting) player.vy *= Math.pow(JUMP_CUT, dt * 60);

  // Jetpack: inside the corridor the jump key becomes sustained thrust. The
  // straps come on at the lip and off at the far side, so it can never be
  // carried into the platforming or the boss arena.
  const inCorridor = player.x + PLAYER_W > FLIGHT.x0 && player.x < FLIGHT.x1;
  player.jetting = inCorridor && held(JUMP) && !won;
  if (player.jetting) {
    player.vy -= JET_THRUST * dt;
    player.vy = Math.max(player.vy, -JET_MAX);
    if (Math.random() < dt * 90) {
      jetPuffs.push({ x: player.x + PLAYER_W / 2 - player.facing * 16,
                      y: player.y + PLAYER_H - 30,
                      vx: -player.vx * 0.25 + (Math.random() - 0.5) * 60,
                      vy: 120 + Math.random() * 140,
                      r: 7 + Math.random() * 9, life: 0, max: 0.45 + Math.random() * 0.3 });
    }
  }

  player.vy = Math.min(MAX_FALL, player.vy + GRAVITY * dt);

  // resolve one axis at a time so a corner can't wedge the player
  player.x += player.vx * dt;
  let box = { x: player.x, y: player.y, w: PLAYER_W, h: PLAYER_H };
  for (const s of solids) {
    if (!overlaps(box, s)) continue;
    // Push out along whichever axis is shallower. A knockback that leaves him
    // sunk into the ground overlaps it by a few units vertically but by half a
    // level horizontally - ejecting sideways would fire him off the end of the
    // map, so anything that deep is left to the vertical pass below.
    const outLeft = box.x + PLAYER_W - s.x;
    const outRight = s.x + s.w - box.x;
    const outUp = box.y + PLAYER_H - s.y;
    const outDown = s.y + s.h - box.y;
    if (Math.min(outUp, outDown) < Math.min(outLeft, outRight)) continue;

    const pushLeft = player.vx > 0 || (player.vx === 0 && outLeft < outRight);
    player.x = pushLeft ? s.x - PLAYER_W : s.x + s.w;
    player.vx = 0;
    box.x = player.x;
  }

  const fellFast = player.vy;
  player.y += player.vy * dt;
  box = { x: player.x, y: player.y, w: PLAYER_W, h: PLAYER_H };
  const wasAir = !player.onGround;
  player.onGround = false;
  for (const s of solids) {
    if (!overlaps(box, s)) continue;
    const landOnTop = player.vy > 0
      || (player.vy === 0 && (box.y + PLAYER_H - s.y) < (s.y + s.h - box.y));
    if (landOnTop) {
      player.y = s.y - PLAYER_H;
      player.onGround = true;
      if (wasAir && fellFast > 500) player.squash = Math.min(0.28, fellFast / 4200);
    } else {
      player.y = s.y + s.h;
    }
    player.vy = 0;
    box.y = player.y;
  }

  if (player.onGround) {
    player.spawnX = player.x;
    player.spawnY = player.y;
    player.restY = player.y;
  }
  // the corridor kills well above the page edge, so a miss reads as a fall
  // into the dark rather than a long silent drop
  const floorKill = inCorridor ? FLIGHT.deathY : DEATH_Y;
  if (player.y > floorKill) {
    player.x = player.spawnX;
    player.y = player.spawnY - 30;
    player.vx = player.vy = 0;
    if (inCorridor) hurtPlayer();
  }

  player.squash += (0 - player.squash) * Math.min(1, dt * 12);
  player.animTime += dt;

  for (const p of pickups) {
    if (p.taken) continue;
    const dx = (player.x + PLAYER_W / 2) - p.x;
    const dy = (player.y + PLAYER_H * 0.45) - p.y;
    if (dx * dx + dy * dy < 76 * 76) {
      p.taken = true;
      collected++;
    }
  }

  if (held(SHOOT) && player.cooldown === 0 && !won) {
    if (player.muscular) {
      // JAB ATTACK — melee punch, no bullets
      player.cooldown = JAB_COOLDOWN;
      player.kick = 0.7;
      player.jabAnim = 0.25;    // animation length
      player.vx += player.facing * 60;   // lunge forward

      // check if the jab connects with the boss
      if (!boss.dead && boss.dying === 0) {
        const jabX = player.x + PLAYER_W / 2 + player.facing * JAB_RANGE;
        const jabY = player.y + PLAYER_H * 0.4;
        const hitBoss = Math.abs(jabX - boss.x) < JAB_DMG_HITBOX.w / 2 + BOSS_HIT.w / 2
          && Math.abs(jabY - BOSS_HIT.cy) < JAB_DMG_HITBOX.h / 2 + BOSS_HIT.h / 2;
        if (hitBoss) {
          damageBoss();
          // ink splatter particles on hit
          for (let si = 0; si < 8; si++) {
            inkSplatters.push({
              x: jabX, y: jabY,
              vx: player.facing * (120 + Math.random() * 200) + (Math.random() - 0.5) * 100,
              vy: -180 + Math.random() * 360,
              r: 4 + Math.random() * 8,
              life: 0, max: 0.5 + Math.random() * 0.4,
              seed: (Math.random() * 1e9) | 0,
            });
          }
          // satisfying screen shake
          player.squash = 0.12;
        }
      }
    } else {
      // RIFLE — original shooting
      const m = muzzle();
      bullets.push({
        x: m.x, y: m.y, vx: player.facing * SHOT_SPEED, life: SHOT_RANGE / SHOT_SPEED,
      });
      player.cooldown = SHOT_COOLDOWN;
      player.kick = 0.5;
      player.vx -= player.facing * 26;      // a little shove back off the shot
    }
  }

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt;
    b.life -= dt;
    const inBoss = !boss.dead && boss.dying === 0
      && Math.abs(b.x - boss.x) < BOSS_HIT.w / 2
      && Math.abs(b.y - BOSS_HIT.cy) < BOSS_HIT.h / 2;
    if (inBoss) damageBoss();
    const hitCreature = !inBoss && Flight.hitTest(b.x, b.y);
    if (inBoss || hitCreature || b.life <= 0) bullets.splice(i, 1);
  }

  // the corridor only lives while you are in it, so its bullets cannot chase
  // you into the boss arena
  Flight.update(dt, player, inCorridor && !won, () => { if (!player.hurt) hurtPlayer(); });

  for (let i = jetPuffs.length - 1; i >= 0; i--) {
    const q = jetPuffs[i];
    q.life += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.r += dt * 26;
    if (q.life > q.max) jetPuffs.splice(i, 1);
  }

  // ink splatters from jab hits
  for (let i = inkSplatters.length - 1; i >= 0; i--) {
    const s = inkSplatters[i];
    s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt;
    s.vy += 600 * dt;  // gravity
    s.vx *= 1 - dt * 3;
    if (s.life > s.max) inkSplatters.splice(i, 1);
  }

  // jab animation decay
  player.jabAnim = Math.max(0, player.jabAnim - dt);

  updateBoss(dt, t);
}

/* ------------------------------------------------------------------ camera */

const cam = { x: 0, y: 0 };

function updateCamera(dt, viewW) {
  // during the landing the camera holds the crash site instead of tracking a
  // player who is still inside the ship
  if (scene === 'crash') {
    const kick = window.CrashShake || 0;
    if (kick > 0) window.CrashShake = Math.max(0, kick - dt * 2.2);
    const j = kick * kick;
    cam.x += ((Crash.shipX - viewW * 0.42) - cam.x) * Math.min(1, dt * 3)
      + (Math.random() - 0.5) * 46 * j;
    cam.y = GROUND_Y + 96 - VIEW_H + (Math.random() - 0.5) * 40 * j;
    return;
  }

  const targetX = Math.max(-180, Math.min(
    LEVEL_W + 200 - viewW,
    player.x + PLAYER_W / 2 - viewW * 0.42 + player.facing * 60,
  ));
  // Follow the height he last stood at, not his live height: tracking the live
  // one lifts the camera on every jump, which during the boss fight swings the
  // ground - and the hater's feet - off the bottom of the screen. A 200u jump
  // still leaves ~280u of headroom, so nothing leaves the frame.
  //
  // The corridor is the exception. It is taller than the view, so there the
  // camera tracks him live and is clamped to the roof and the drop, otherwise
  // flying high simply takes him off the top of the page.
  const corridor = player.x + PLAYER_W > FLIGHT.x0 - 120 && player.x < FLIGHT.x1 + 120;
  const targetY = corridor
    ? Math.max(FLIGHT.roof - 50,
        Math.min(FLIGHT.deathY + 40 - VIEW_H, player.y + PLAYER_H / 2 - VIEW_H / 2))
    : Math.min(player.restY + PLAYER_H - VIEW_H * 0.78, GROUND_Y + 96 - VIEW_H);
  const k = 1 - Math.pow(0.0015, dt);
  cam.x += (targetX - cam.x) * k;
  cam.y += (targetY - cam.y) * k;
}

/* ------------------------------------------------------------------ render */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const sheet = new Image();
const bossSheet = new Image();
const paper = new Image();
let paperPattern = null;
let cssW = 0, cssH = 0, dpr = 1;

function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  cssW = innerWidth;
  cssH = innerHeight;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.imageSmoothingQuality = 'high';
}
addEventListener('resize', resize);

function drawPaper() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#f7f6f2';
  ctx.fillRect(0, 0, cssW, cssH);
  if (paperPattern) {
    // drifts far slower than the level, so the page reads as the backdrop
    const ox = -(cam.x * 0.1) % 1024;
    const oy = -(cam.y * 0.1) % 1024;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.translate(ox, oy);
    ctx.fillStyle = paperPattern;
    ctx.fillRect(-ox - 1024, -oy - 1024, cssW + 2048, cssH + 2048);
    ctx.restore();
  }
  const vig = ctx.createRadialGradient(
    cssW / 2, cssH / 2, Math.min(cssW, cssH) * 0.35,
    cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.78,
  );
  vig.addColorStop(0, 'rgba(120,112,98,0)');
  vig.addColorStop(1, 'rgba(120,112,98,0.16)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, cssW, cssH);
}

function drawPickup(ctx, p, t) {
  const bob = Math.sin(t * 2.4 + p.phase) * 7;
  const rand = mulberry32(p.seed);
  ctx.save();
  ctx.translate(p.x, p.y + bob);
  ctx.rotate(Math.sin(t * 1.3 + p.phase) * 0.18);
  ctx.strokeStyle = `rgba(${INK}, 0.8)`;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';

  // a scribbled five-point star
  const pts = [];
  for (let i = 0; i < 11; i++) {
    const ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 19 : 8;
    pts.push({ x: Math.cos(ang) * r + (rand() - 0.5) * 2.5, y: Math.sin(ang) * r + (rand() - 0.5) * 2.5 });
  }
  tracePath(ctx, pts, true);
  ctx.strokeStyle = `rgba(${INK}, 0.3)`;
  ctx.lineWidth = 2;
  tracePath(ctx, jitterLine(-7, 4, 7, 4, rand, 1.2, 8), false);
  ctx.restore();
}

/* The pipe he hangs off. Baked once - it's long, and a fresh jitter every
 * frame would make the whole thing crawl. */
const tube = (() => {
  const rand = mulberry32(77);
  const top = jitterLine(TUBE_X0, TUBE_Y - 15, TUBE_X1, TUBE_Y - 15, rand, 2.2, 90);
  const bottom = jitterLine(TUBE_X0, TUBE_Y + 15, TUBE_X1, TUBE_Y + 15, rand, 2.2, 90);
  const rings = [];
  for (let x = TUBE_X0 + 130; x < TUBE_X1 - 60; x += 190) {
    rings.push(jitterLine(x, TUBE_Y - 14, x + 6, TUBE_Y + 14, rand, 1.2, 14));
  }
  const shade = [];
  for (let x = TUBE_X0 + 12; x < TUBE_X1; x += 13) {
    shade.push({
      pts: jitterLine(x, TUBE_Y + 3, x + 9, TUBE_Y + 13, rand, 1, 20),
      alpha: 0.1 + rand() * 0.14,
    });
  }
  return { top, bottom, rings, shade };
})();

function drawTube(ctx) {
  ctx.lineCap = 'round';
  for (const s of tube.shade) {
    ctx.strokeStyle = `rgba(${INK}, ${s.alpha})`;
    ctx.lineWidth = 2;
    tracePath(ctx, s.pts, false);
  }
  ctx.strokeStyle = `rgba(${INK}, 0.8)`;
  ctx.lineWidth = 3.4;
  tracePath(ctx, tube.top, false);
  tracePath(ctx, tube.bottom, false);
  ctx.strokeStyle = `rgba(${INK}, 0.4)`;
  ctx.lineWidth = 2;
  for (const r of tube.rings) tracePath(ctx, r, false);
}

function drawBoss(ctx, t) {
  if (boss.dead) return;
  const frame = bossFrame();
  const sway = bossSway(t);

  let fade = 1;
  ctx.save();
  ctx.translate(boss.x + sway, TUBE_Y);
  if (boss.dying > 0) {
    // lets go of the pipe and drops off the bottom of the page
    const k = boss.dying;
    ctx.translate(Math.sin(k * 9) * 26 * Math.max(0, 1 - k), k * k * 620);
    ctx.rotate(k * 0.9);
    fade = Math.max(0, 1 - k / 1.6);
  } else if (boss.flinch > 0) {
    ctx.translate(Math.sin(boss.flinch * 90) * 9, 0);
  }
  // the art swings its claw to the left, so mirror it when he's coming the
  // other way rather than having him strike behind himself
  ctx.scale(BOSS_SCALE * boss.facing * -1, BOSS_SCALE);
  // same double pass as the soldier: a big downscale thins the graphite out
  for (const pass of [1, 0.5]) {
    ctx.globalAlpha = fade * pass;
    ctx.drawImage(
      bossSheet, frame * BOSS.frameWidth, 0, BOSS.frameWidth, BOSS.frameHeight,
      -BOSS.centerX, -BOSS.gripY, BOSS.frameWidth, BOSS.frameHeight,
    );
  }
  ctx.restore();
}

function drawBullets(ctx) {
  ctx.lineCap = 'round';
  for (const b of bullets) {
    const len = 26 * Math.sign(b.vx);
    ctx.strokeStyle = `rgba(${INK}, 0.75)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - len, b.y);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${INK}, 0.25)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(b.x - len, b.y - 2);
    ctx.lineTo(b.x - len * 2.4, b.y - 3);
    ctx.stroke();
  }
}

function currentFrame() {
  // muscular mode uses composite drawing, not the sprite sheet
  if (player.muscular) return 0;

  // strapped into the jetpack: one drawn pose, held
  if (player.jetting || (!player.onGround && player.x + PLAYER_W > FLIGHT.x0
                         && player.x < FLIGHT.x1)) {
    return META.fly[0];
  }
  if (!player.onGround) {
    // knee tucked on the way up, legs reaching for the floor on the way down
    return player.vy < 0 ? META.run[7] : META.run[9];
  }
  const speed = Math.abs(player.vx);
  if (speed < 18) {
    const i = Math.floor(player.animTime * 5) % META.idle.length;
    return META.idle[i];
  }
  const fps = 9 + 13 * (speed / MOVE_SPEED);
  const i = Math.floor(player.animTime * fps) % META.run.length;
  return META.run[i];
}

/** Draw muscular Kelvin as a composite: body + head + legs */
function drawMuscularPlayer(ctx, cx, feet, fade) {
  const sq = player.squash;
  const scaleY = SPRITE_SCALE * (1 - sq);
  const scaleX = SPRITE_SCALE * (1 + sq * 0.6);

  ctx.save();
  ctx.translate(cx - player.facing * player.kick * 10, feet);
  ctx.scale(player.facing * scaleX, scaleY);

  const M = MUSCLE;
  const speed = Math.abs(player.vx);

  // Leg frame
  let legF = M.idleLegs[Math.floor(player.animTime * 5) % M.idleLegs.length];
  if (speed >= 18) {
    const fps = 9 + 13 * (speed / MOVE_SPEED);
    legF = M.runLegs[Math.floor(player.animTime * fps) % M.runLegs.length];
  }

  // Body frame
  let bodyF = M.idleBody[Math.floor(player.animTime * 5) % M.idleBody.length];
  if (player.jabAnim > 0) {
    const i = Math.min(2, Math.floor((1 - (player.jabAnim / 0.25)) * 3));
    bodyF = M.jabBody[i];
  }

  // Draw legs
  for (const pass of [1, 0.5]) {
    ctx.globalAlpha = fade * pass;
    ctx.drawImage(
      musculeSheet, legF * M.frameWidth, 0, M.frameWidth, M.frameHeight,
      -M.centerX, -M.groundY, M.frameWidth, M.frameHeight,
    );
  }

  // Draw body
  for (const pass of [1, 0.5]) {
    ctx.globalAlpha = fade * pass;
    ctx.drawImage(
      musculeSheet, bodyF * M.frameWidth, 0, M.frameWidth, M.frameHeight,
      -M.centerX, -M.groundY, M.frameWidth, M.frameHeight,
    );
  }

  // HEAD — from the head sheet
  if (muscleHead.complete && muscleHead.naturalWidth > 0) {
    const hw = 235;
    const hh = 298;
    const neckX = 114;
    const neckY = 291;
    
    // Position head around the top of the body
    const HEAD_SCALE = 0.87;
    const HEAD_TUCK = 28; // how deep the chin sits in the collar (matches tools/extract_sprites.py)
    const hx = -neckX * HEAD_SCALE;
    const hy = -M.bodyH - neckY * HEAD_SCALE + HEAD_TUCK; // align the head into the collar
    const headBob = Math.sin(player.animTime * (speed >= 18 ? 13 : 5)) * (speed >= 18 ? 8 : 4);

    for (const pass of [1, 0.5]) {
      ctx.globalAlpha = fade * pass;
      ctx.drawImage(
        muscleHead, 0, 0, hw, hh,
        hx, hy + headBob, hw * 0.87, hh * 0.87,
      );
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawPlayer(ctx) {
  const frame = currentFrame();
  let cx = player.x + PLAYER_W / 2;
  let feet = player.y + PLAYER_H;

  // climbing out of the wreck: hop from the hull down to the dirt
  if (scene === 'crash') {
    const k = Crash.climb();
    const from = { x: Crash.shipX + 90, y: GROUND_Y - 96 };
    const to = { x: Crash.hatchX, y: GROUND_Y };
    cx = from.x + (to.x - from.x) * k;
    feet = from.y + (to.y - from.y) * k - Math.sin(k * Math.PI) * 54;   // arc
  }

  // contact shadow: a graphite smudge that softens as he climbs
  let groundBelow = null;
  for (const s of solids) {
    if (cx > s.x - 20 && cx < s.x + s.w + 20 && s.y >= feet - 4) {
      if (!groundBelow || s.y < groundBelow) groundBelow = s.y;
    }
  }
  if (groundBelow !== null && groundBelow - feet < 320) {
    const drop = Math.max(0, groundBelow - feet);
    const f = 1 - drop / 320;
    ctx.save();
    ctx.globalAlpha = 0.22 * f * f;
    ctx.fillStyle = `rgb(${INK})`;
    ctx.beginPath();
    ctx.ellipse(cx, groundBelow + 3, 42 * (0.55 + f * 0.45), 8 * f + 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // flicker while the hater's hit is still wearing off
  const fade = player.hurt > 0 && Math.floor(player.hurt * 18) % 2 === 0 ? 0.35 : 1;

  // muscular Kelvin draws as a composite instead of the sprite sheet
  if (player.muscular) {
    drawMuscularPlayer(ctx, cx, feet, fade);
    return;
  }

  const sx = frame * META.frameWidth;
  const sq = player.squash;
  const scaleY = SPRITE_SCALE * (1 - sq);
  const scaleX = SPRITE_SCALE * (1 + sq * 0.6);

  ctx.save();
  ctx.translate(cx - player.facing * player.kick * 7, feet);   // recoil shove
  ctx.scale(player.facing * scaleX, scaleY);
  // Shrinking a 900px drawing to ~200px averages the thin graphite lines away
  // and leaves him paler than the level around him; a second pass puts the
  // weight back without touching the shape.
  for (const pass of [1, 0.55]) {
    ctx.globalAlpha = fade * pass;
    ctx.drawImage(
      sheet, sx, 0, META.frameWidth, META.frameHeight,
      -META.centerX, -META.groundY, META.frameWidth, META.frameHeight,
    );
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Sketched health bar — pencil outline with hatching that drains */
function drawHealthBar(ctx) {
  const hpFrac = player.hp / PLAYER_MAX_HP;
  const barX = 26, barY = 76, barW = 160, barH = 16;
  const fillW = barW * hpFrac;
  const rand = mulberry32(777);

  // fill — the remaining HP
  if (fillW > 0) {
    ctx.fillStyle = hpFrac > 0.3
      ? `rgba(${INK}, 0.25)`
      : `rgba(150, 50, 40, ${0.35 + Math.sin(elapsed * 6) * 0.1})`;
    ctx.fillRect(barX + 2, barY + 2, fillW - 4, barH - 4);

    // hatching inside the fill
    ctx.strokeStyle = hpFrac > 0.3 ? `rgba(${INK}, 0.15)` : 'rgba(150, 50, 40, 0.2)';
    ctx.lineWidth = 1.2;
    for (let hx = barX; hx < barX + fillW; hx += 7) {
      tracePath(ctx, jitterLine(hx, barY + 3, hx + 6, barY + barH - 3, rand, 0.8, 8), false);
    }
  }

  // outline — sketched
  ctx.strokeStyle = `rgba(${INK}, 0.6)`;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  tracePath(ctx, jitterLine(barX, barY, barX + barW, barY, rand, 1.4, 20), false);
  tracePath(ctx, jitterLine(barX + barW, barY, barX + barW, barY + barH, rand, 1, 12), false);
  tracePath(ctx, jitterLine(barX + barW, barY + barH, barX, barY + barH, rand, 1.4, 20), false);
  tracePath(ctx, jitterLine(barX, barY + barH, barX, barY, rand, 1, 12), false);
}

function drawHud() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pencil = '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';

  ctx.fillStyle = `rgba(${INK}, 0.85)`;
  ctx.font = `600 22px ${pencil}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`stars  ${collected} / ${pickups.length}`, 26, 22);

  ctx.font = `400 16px ${pencil}`;
  ctx.fillStyle = `rgba(${INK}, 0.5)`;
  ctx.fillText(`${elapsed.toFixed(1)}s`, 26, 54);

  // health bar
  drawHealthBar(ctx);

  ctx.textAlign = 'center';
  ctx.fillStyle = `rgba(${INK}, 0.42)`;
  const inFlight = player.x + PLAYER_W > FLIGHT.x0 && player.x < FLIGHT.x1;
  ctx.fillText(
    inFlight
      ? 'HOLD  SPACE  to fly      F to shoot      R to restart'
      : player.muscular
        ? 'A / D  or  ← →   to move      SPACE to jump      F to JAB      R to restart'
        : 'A / D  or  ← →   to move      SPACE to jump      F to shoot      R to restart',
    cssW / 2, cssH - 34,
  );

  // the hater's health, as tally marks struck through as he takes them
  if (!boss.dead && player.x > TUBE_X0 - 400) {
    ctx.textAlign = 'center';
    ctx.font = `600 20px ${pencil}`;
    ctx.fillStyle = `rgba(${INK}, 0.7)`;
    ctx.fillText('the hater', cssW / 2, 22);
    // grouped in fives so a dozen marks still reads at a glance
    const rand = mulberry32(31);
    const top = 52;
    const span = (BOSS_HP - 1) * 13 + Math.floor((BOSS_HP - 1) / 5) * 12;
    ctx.lineCap = 'round';
    for (let i = 0; i < BOSS_HP; i++) {
      const x = cssW / 2 - span / 2 + i * 13 + Math.floor(i / 5) * 12;
      const alive = i < boss.hp;
      ctx.strokeStyle = `rgba(${INK}, ${alive ? 0.8 : 0.18})`;
      ctx.lineWidth = alive ? 3.4 : 1.6;
      tracePath(ctx, jitterLine(x, top, x + 2, top + 22, rand, 1.4, 12), false);
    }
  }

  // when he connects, the page bruises at the edges - a full-screen wash would
  // read as a video-game hit flash rather than pencil
  if (player.hurt > 0) {
    const k = player.hurt / HURT_TIME;
    const g = ctx.createRadialGradient(
      cssW / 2, cssH / 2, Math.min(cssW, cssH) * 0.22,
      cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.72,
    );
    g.addColorStop(0, 'rgba(150, 60, 45, 0)');
    g.addColorStop(1, `rgba(150, 60, 45, ${0.30 * k})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cssW, cssH);
  }

  if (playerFlash > 0) {
    ctx.fillStyle = `rgba(255, 248, 236, ${Math.min(1, playerFlash)})`;
    ctx.fillRect(0, 0, cssW, cssH);
  }

  if (won) {
    ctx.fillStyle = 'rgba(247, 246, 242, 0.82)';
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.fillStyle = `rgba(${INK}, 0.9)`;
    ctx.font = `600 54px ${pencil}`;
    ctx.textBaseline = 'middle';
    ctx.fillText('mission complete', cssW / 2, cssH / 2 - 40);
    ctx.font = `400 24px ${pencil}`;
    ctx.fillText(
      `${collected} of ${pickups.length} stars  ·  ${elapsed.toFixed(1)}s  ·  `
      + `${player.hitsTaken === 0 ? 'untouched' : `${player.hitsTaken} hits taken`}`,
      cssW / 2, cssH / 2 + 18,
    );
    ctx.font = `400 18px ${pencil}`;
    ctx.fillStyle = `rgba(${INK}, 0.55)`;
    ctx.fillText('press R to run it again', cssW / 2, cssH / 2 + 62);
  }
}

function render(t) {
  drawPaper();

  const scale = cssH / VIEW_H;
  const viewW = cssW / scale;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, -cam.x * dpr * scale, -cam.y * dpr * scale);

  for (const b of blocks) {
    if (b.x + b.w < cam.x - 60 || b.x > cam.x + viewW + 60) continue;
    drawBlock(ctx, b);
  }
  if (cam.x + viewW > TUBE_X0 - 60) {
    drawTube(ctx);
    drawBoss(ctx, t);
  }
  for (const p of pickups) {
    if (p.taken || p.x < cam.x - 60 || p.x > cam.x + viewW + 60) continue;
    drawPickup(ctx, p, t);
  }

  // the wreck sits in level coordinates, so it stays put once play begins
  if (scene === 'crash') Crash.render(ctx, GROUND_Y, t);
  else if (cam.x < 700) Crash.renderWreck(ctx, GROUND_Y);

  // thruster exhaust goes under him, creatures and their shot over
  for (const q of jetPuffs) {
    const a = (1 - q.life / q.max) * 0.42;
    if (a <= 0) continue;
    const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, q.r);
    g.addColorStop(0, `rgba(120, 112, 100, ${a})`);
    g.addColorStop(1, 'rgba(120, 112, 100, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill();
  }

  if (scene !== 'crash' || Crash.climb() > 0) drawPlayer(ctx);
  if (cam.x + viewW > FLIGHT.x0 - 200 && cam.x < FLIGHT.x1 + 200) Flight.render(ctx, t);
  drawBullets(ctx);

  // ink splatters from jab hits
  for (const sp of inkSplatters) {
    const k = sp.life / sp.max;
    const a = (1 - k) * 0.7;
    if (a <= 0) continue;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = `rgba(${INK}, ${a})`;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sp.r * (0.6 + k * 0.4), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawHud();
  return viewW;
}

/* -------------------------------------------------------------------- loop */

let last = 0;
function frame(now) {
  const t = now / 1000;
  let dt = Math.min(0.05, t - last || 0);
  last = t;

  if (scene === 'intro') {
    Intro.update(dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Intro.render(ctx, cssW, cssH, t);
  } else if (scene === 'transform') {
    Transform.update(dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Transform.render(ctx, cssW, cssH, t);
  } else {
    const scale = cssH / VIEW_H;
    if (scene === 'crash') {
      // the world is drawn, but nothing is simulated until Kelvin is out
      Crash.update(dt, GROUND_Y);
      updateCamera(dt, cssW / scale);
    } else {
      update(dt, t);
      updateCamera(dt, cssW / scale);
      Crash.idle(dt, GROUND_Y);
    }
    render(t);
  }
  requestAnimationFrame(frame);
}

function loadImage(img, src) {
  return new Promise((res, rej) => {
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`could not load ${src}`));
    img.src = src;
  });
}

Promise.all([
  loadImage(sheet, 'assets/soldier_sheet.png'),
  loadImage(bossSheet, 'assets/hater_sheet.png'),
  loadImage(paper, 'assets/paper.png'),
  loadImage(musculeSheet, 'assets/muscule_sheet.png'),
  loadImage(muscleHead, 'assets/head_sheet.png'),
  Intro.load(),
  Crash.load(),
  Flight.load(),
  Transform.load(),
]).then(() => {
  paperPattern = ctx.createPattern(paper, 'repeat');
  window.paperPattern = paperPattern;    // the cutscene draws on the same page
  Intro.begin(() => {
    scene = 'crash';
    last = 0;
    cam.x = -220;                        // framed on the landing site
    Crash.begin(() => { scene = 'play'; last = 0; });
  });
  resize();
  // start the camera already framed on the player instead of panning in
  cam.x = player.x - (cssW / (cssH / VIEW_H)) * 0.42;
  cam.y = GROUND_Y + 96 - VIEW_H;
  const splash = document.getElementById('loading');
  splash.classList.add('gone');
  // drop it rather than trusting the fade to finish - a stuck overlay would
  // sit on top of the whole game
  splash.addEventListener('transitionend', () => splash.remove(), { once: true });
  setTimeout(() => splash.remove(), 800);
  requestAnimationFrame(frame);
}).catch((err) => {
  document.getElementById('loading').textContent = err.message;
});
