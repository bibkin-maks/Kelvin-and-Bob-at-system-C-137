/* Headless smoke test for game.js.
 *
 * Runs the real game file against a stubbed canvas so the physics, the render
 * path and the level layout can be exercised without a browser. Reports pass /
 * fail per check and exits non-zero if anything breaks.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* ------------------------------------------------------------ canvas stub */

const CTX_METHODS = [
  'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo',
  'quadraticCurveTo', 'stroke', 'fill', 'fillRect', 'drawImage', 'translate',
  'rotate', 'scale', 'setTransform', 'ellipse', 'fillText', 'arc', 'clip',
  'clearRect',
];

function makeCtx() {
  const ctx = { calls: { drawImage: 0, stroke: 0, fillText: 0 } };
  for (const m of CTX_METHODS) {
    ctx[m] = () => { if (m in ctx.calls) ctx.calls[m]++; };
  }
  ctx.createPattern = () => ({});
  ctx.createRadialGradient = () => ({ addColorStop() {} });
  ctx.measureText = () => ({ width: 10 });
  return ctx;
}

/* ------------------------------------------------------------- dom stubs */

const listeners = {};
const ctxStub = makeCtx();
const sandbox = {
  console,
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 1,
  requestAnimationFrame: () => 0,
  addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
  document: {
    getElementById: () => ({
      getContext: () => ctxStub,
      classList: { add() {}, remove() {} },
      addEventListener() {},
      remove() {},
      set textContent(v) { throw new Error(`asset load failed: ${v}`); },
    }),
    // the cutscene renders its pixel text through an offscreen canvas
    createElement: () => ({ width: 0, height: 0, getContext: () => makeCtx() }),
  },
  AudioContext: class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    createOscillator() {
      return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
               connect() { return this; }, start() {}, stop() {} };
    }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
               connect() { return this; } };
    }
    createBiquadFilter() {
      return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
               connect() { return this; } };
    }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
    createBufferSource() {
      return { buffer: null, loop: false, connect() { return this; }, start() {}, stop() {} };
    }
    get sampleRate() { return 44100; }
  },
  setTimeout,
  setImmediate,
  setInterval,
  clearInterval,
  Image: class {
    set src(v) { this._src = v; queueMicrotask(() => this.onload && this.onload()); }
    get src() { return this._src; }
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const context = vm.createContext(sandbox);
const run = (file) =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });

run('assets/sprite.js');
run('intro.js');      // must precede game.js: it defines window.Intro
run('crash.js');
run('flight.js');
run('transform.js');
run('game.js');

// Both sheets must exist on disk - the game loads them by name.
for (const f of ['assets/soldier_sheet.png', 'assets/hater_sheet.png', 'assets/paper.png']) {
  if (!fs.existsSync(path.join(ROOT, f))) {
    console.log(`FAIL  missing asset ${f}`);
    process.exit(1);
  }
}

/* -------------------------------------------------------------- test rig */

const peek = (expr) => vm.runInContext(expr, context);
const keysHas = (c) => peek('keys').has(c);
const key = (code, down) => {
  const type = down ? 'keydown' : 'keyup';
  for (const fn of listeners[type] || []) fn({ code, preventDefault() {} });
};

let failures = 0;
function check(name, cond, detail = '') {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const DT = 1 / 60;
function step(n = 1) {
  for (let i = 0; i < n; i++) {
    if (peek('scene') === 'transform') {
      peek('Transform').update(DT);
      if (peek('Transform').phase === 'panels') peek('Transform').key({ code: 'Space' });
    } else {
      peek('update')(DT);
      peek('updateCamera')(DT, 1280 / (720 / peek('VIEW_H')));
    }
  }
}

// game.js installs its scene handover inside the asset-load promise, so the
// checks run on a later tick - otherwise the wiring under test has not been
// attached yet and every scene transition looks broken.
async function main() {
  await new Promise(setImmediate);

/* ------------------------------------------------------------- cutscene */

// The intro owns input until it hands over, so it is exercised first and then
// the harness drops into the play scene for everything below.
const GROUND_Y0 = peek('GROUND_Y');
const intro = peek('Intro');
check('cutscene loaded', typeof intro === 'object' && typeof intro.update === 'function');
check('game starts in the cutscene', peek('scene') === 'intro');

let introErr = null;
try {
  peek('resize')();
  intro.update(1 / 60);
  intro.render(ctxStub, 1280, 720, 0.5);        // before any keypress
  intro.key({ code: 'Space' });                 // start panel 1
  for (let i = 0; i < 400; i++) intro.update(1 / 60);
  intro.render(ctxStub, 1280, 720, 3.0);        // mid-cutscene, text typed
} catch (e) { introErr = e; }
check('cutscene renders clean', !introErr, introErr && introErr.message);

// Space walks forward through every beat of every panel. The game installed
// its own handover callback at load, so this watches `scene` rather than
// replacing it - overriding the callback would test the harness, not the game.
let beats = 0;
for (let guard = 0; guard < 80 && peek('scene') === 'intro'; guard++) {
  intro.key({ code: 'Space' });
  for (let i = 0; i < 200; i++) intro.update(1 / 60);
  beats++;
}
check('cutscene plays every beat and hands over', peek('scene') !== 'intro',
  `${beats} beats`);
check('hands over to the crash, not straight to play',
  peek('scene') === 'crash', `scene=${peek('scene')}`);

/* ---------------------------------------------------------------- the crash */

const crash = peek('Crash');
let crashErr = null;
let landed = false;
crash.begin(() => { landed = true; });
try {
  for (let i = 0; i < 400 && !landed; i++) {
    crash.update(1 / 60, GROUND_Y0);
    peek('render')(i / 60);
  }
} catch (e) { crashErr = e; }
check('crash scene runs clean', !crashErr, crashErr && crashErr.message);
check('crash finishes and hands over', landed);
check('Kelvin climbs all the way out', crash.climb() >= 1);

// The wreck must be standable, or it reads as scenery you fall through.
const wreck = peek('solids').find((s) => s.x === -130);
check('wreck is solid', !!wreck, wreck && `at ${wreck.x},${wreck.y} ${wreck.w}x${wreck.h}`);
check('wreck sits on the ground', wreck && Math.abs(wreck.y + wreck.h - GROUND_Y0) < 2);
check('wreck is reachable from spawn',
  wreck && wreck.x + wreck.w > 120 - 220 && wreck.y < GROUND_Y0 - 20);

peek('reset')();
vm.runInContext('scene = "play"', context);
check('scene switched to play', peek('scene') === 'play');

/* ---------------------------------------------------------------- checks */

// Assets have to be in place before anything else means much.
check('sprite metadata loaded', peek('META').frames.length === 14,
  `${peek('META').frames.length} frames`);
check('idle + run + fly cover every frame',
  peek('META').idle.length + peek('META').run.length + peek('META').fly.length
    === peek('META').frames.length,
  `${peek('META').idle.length} idle + ${peek('META').run.length} run + ${peek('META').fly.length} fly`);

// The head is grafted on above the collar, so every frame must carry ink well
// above the body - if the graft silently no-ops he goes back to being headless.
check('sprite canvas has room above the body',
  peek('META').frameHeight > peek('META').bodyH + 150,
  `${peek('META').frameHeight}px canvas, ${peek('META').bodyH}px body`);
check('rifle sits inside the body, not the head padding',
  peek('RIFLE_Y') > 0 && peek('RIFLE_Y') < peek('META').bodyH,
  `rifle ${peek('RIFLE_Y')} of ${peek('META').bodyH}`);

// Rendering: a stub ctx will surface any bad call or undefined access.
let renderErr = null;
try {
  peek('resize')();
  peek('render')(1.0);
} catch (e) { renderErr = e; }
check('render() runs clean', !renderErr, renderErr && renderErr.message);
check('render drew the player', ctxStub.calls.drawImage > 0);
check('render stroked the level', ctxStub.calls.stroke > 50,
  `${ctxStub.calls.stroke} strokes`);

// Resting on the ground.
step(120);
const player = peek('player');
const GROUND_Y = peek('GROUND_Y');
const PLAYER_H = peek('PLAYER_H');
check('settles on the ground', Math.abs(player.y - (GROUND_Y - PLAYER_H)) < 0.5,
  `y=${player.y.toFixed(1)}`);
check('is grounded', player.onGround === true);

// Jump arc.
const floorY = player.y;
key('Space', true);
let apex = floorY;
for (let i = 0; i < 200; i++) {
  step(1);
  apex = Math.min(apex, player.y);
  if (i === 60) key('Space', false);
}
check('jump clears its own height', floorY - apex > PLAYER_H,
  `rise ${(floorY - apex).toFixed(0)} vs height ${PLAYER_H}`);
check('lands again', player.onGround === true);

// Short hop must be meaningfully shorter than a full jump.
key('Space', true);
step(1);
key('Space', false);
let hop = player.y;
for (let i = 0; i < 200; i++) { step(1); hop = Math.min(hop, player.y); }
check('tapping jump gives a shorter hop', floorY - hop < (floorY - apex) * 0.75,
  `hop ${(floorY - hop).toFixed(0)} vs full ${(floorY - apex).toFixed(0)}`);

// Running.
key('KeyD', true);
step(60);
check('runs right', player.vx > 300, `vx=${player.vx.toFixed(0)}`);
check('faces right', player.facing === 1);
const runFrames = peek('META').run;
check('uses a run frame while running', runFrames.includes(peek('currentFrame')()));
key('KeyD', false);
key('KeyA', true);
step(60);
check('runs left', player.vx < -300, `vx=${player.vx.toFixed(0)}`);
check('faces left', player.facing === -1);
key('KeyA', false);
step(60);
check('uses an idle frame at rest', peek('META').idle.includes(peek('currentFrame')()));
check('airborne frame differs from idle', (() => {
  player.onGround = false;
  player.vy = -300;
  const air = peek('currentFrame')();
  player.onGround = true;
  player.vy = 0;
  return !peek('META').idle.includes(air);
})());

// Solid collision: walking into a wall should stop, not tunnel.
peek('reset')();
step(30);
player.x = peek('GROUND_SPANS')[0][1] - 400;   // run at the ledge before gap 1
player.y = GROUND_Y - PLAYER_H;
key('KeyD', true);
step(300);
key('KeyD', false);
check('stays out of solids', peek('solids').every((s) =>
  !(player.x < s.x + s.w && player.x + peek('PLAYER_W') > s.x &&
    player.y < s.y + s.h && player.y + PLAYER_H > s.y)),
  `at x=${player.x.toFixed(0)} y=${player.y.toFixed(0)}`);

// A body that ends up sunk into a solid must be lifted out, not fired sideways
// along its whole width - the hater's knockback used to launch the player off
// the end of the map this way.
peek('reset')();
player.x = 4200;
player.y = GROUND_Y - PLAYER_H + 40;    // 40u into the ground
player.vx = player.vy = 0;
step(20);
check('a body sunk into the ground is pushed up, not sideways',
  Math.abs(player.x - 4200) < 5 && Math.abs(player.y - (GROUND_Y - PLAYER_H)) < 1,
  `ended at x=${player.x.toFixed(0)} y=${player.y.toFixed(0)}`);

peek('reset')();
player.x = 4200;
player.y = GROUND_Y - PLAYER_H;
step(5);
peek('hurtPlayer')();
step(40);
check('knockback moves him back, not across the level',
  player.x < 4200 && player.x > 4000, `x=${player.x.toFixed(0)}`);

// The level is fenced at both ends.
for (const [name, code, dir] of [['right', 'KeyD', 1], ['left', 'KeyA', -1]]) {
  peek('reset')();
  step(10);
  player.x = dir > 0 ? peek('LEVEL_W') - 200 : peek('GROUND_SPANS')[0][0] + 200;
  player.y = GROUND_Y - PLAYER_H;
  key(code, true);
  step(600);
  key(code, false);
  check(`can't run off the ${name} edge`,
    player.x > peek('GROUND_SPANS')[0][0] - 60 && player.x < peek('LEVEL_W') + 200,
    `stopped at x=${player.x.toFixed(0)}`);
}

// Falling into a pit respawns rather than dropping forever.
peek('reset')();
step(30);
player.x = 1000;                        // the first gap
player.y = GROUND_Y - PLAYER_H;
step(240);
check('pit respawns the player', player.y < peek('DEATH_Y'),
  `y=${player.y.toFixed(0)}`);

// Pickups.
peek('reset')();
const pickups = peek('pickups');
player.x = pickups[0].x - peek('PLAYER_W') / 2;
player.y = pickups[0].y - PLAYER_H * 0.45;
step(2);
check('pickup collects on contact', pickups[0].taken === true);

/* ------------------------------------------------------ the jetpack corridor */

const FLIGHT = peek('FLIGHT');
const flight = peek('Flight');

// The corridor must have no floor at all, or it is just a walk with a roof.
const corridorFloor = peek('solids').some((s) =>
  s.y >= GROUND_Y0 - 4 && s.x < FLIGHT.x1 - 100 && s.x + s.w > FLIGHT.x0 + 100);
check('corridor has no floor', !corridorFloor);
check('corridor has a roof', peek('solids').some((s) =>
  s.y + s.h > FLIGHT.roof - 4 && s.y + s.h < FLIGHT.roof + 4
  && s.x <= FLIGHT.x0 && s.x + s.w >= FLIGHT.x1));

// A ledge poking into the corridor mouth wedges you against the first hanger
// with no room to duck under it - a genuine dead end, and an easy one to
// reintroduce by nudging a platform right.
check('no platform reaches into the corridor',
  peek('PLATFORM_RECTS').every(([x, , w]) => x + w <= FLIGHT.x0 || x >= FLIGHT.x1),
  peek('PLATFORM_RECTS').filter(([x, , w]) => x + w > FLIGHT.x0 && x < FLIGHT.x1)
    .map(([x, y, w]) => `${x}..${x + w}@${y}`).join(' ') || 'all clear');

// Every hanger must leave standing room beneath it for someone entering at
// ground level, or the corridor cannot be entered at all.
check('hangers clear the entry height',
  peek('FLIGHT_HANG').every(([, drop]) => drop < GROUND_Y0 - PLAYER_H - 20),
  peek('FLIGHT_HANG').map(([x, d]) => `${x}:${d}`).join(' '));

// Thrust has to beat gravity, or the corridor is uncrossable by design.
peek('reset')();
player.x = FLIGHT.x0 + 60;
player.y = 400;
player.vx = player.vy = 0;
key('Space', true);
step(30);
check('jetpack lifts him', player.y < 400, `y 400 -> ${player.y.toFixed(0)}`);
check('using the jetpack shows the jetpack pose',
  peek('currentFrame')() === peek('META').fly[0]);
key('Space', false);

// Fly it end to end: hold thrust and right, and see him reach the far side.
peek('reset')();
player.x = FLIGHT.x0 - 40;
player.y = GROUND_Y0 - PLAYER_H;
key('KeyD', true);
// The pilot has to look ahead: hangers force you low, pillars force you high,
// and the two bands do not overlap. That is the whole design of the corridor,
// so a test that hovers at one height proves nothing.
const PW = peek('PLAYER_W');
function targetY(x) {
  const nose = x + PW + 90;
  for (const [hx, drop] of peek('FLIGHT_HANG')) {
    if (nose > hx - 40 && x < hx + 64 + 30) return drop + 70;        // duck under
  }
  for (const [px, top] of peek('FLIGHT_RISE')) {
    if (nose > px - 40 && x < px + 64 + 30) return top - PLAYER_H - 70;  // climb over
  }
  return 300;
}

let crossed = false, sank = false;
for (let i = 0; i < 1400 && !crossed; i++) {
  const wantUp = player.y > targetY(player.x);
  if (wantUp && !keysHas('Space')) key('Space', true);
  if (!wantUp && keysHas('Space')) key('Space', false);
  step(1);
  if (player.y > FLIGHT.deathY) sank = true;
  if (player.x > FLIGHT.x1 + 20) crossed = true;
}
key('Space', false); key('KeyD', false);
check('the corridor can be flown end to end', crossed,
  `reached x=${player.x.toFixed(0)}${sank ? ' (after a fall)' : ''}`);

// Creatures: fixed roster, telegraphed, and they actually shoot.
check('corridor is populated', flight.alive > 0, `${flight.alive} creatures`);
peek('reset')();
player.x = FLIGHT.x0 + 300;
player.y = 300;
let fired = 0;
for (let i = 0; i < 600; i++) {
  peek('update')(DT);
  fired = Math.max(fired, flight.bullets.length);
}
check('creatures open fire', fired > 0, `${fired} shots in flight at once`);

// Their shots have to be able to hurt, and the player's have to kill.
peek('reset')();
player.x = FLIGHT.x0 + 300;
player.y = 300;
for (let i = 0; i < 900 && player.hitsTaken === 0; i++) peek('update')(DT);
check('creature fire hurts', player.hitsTaken > 0);

peek('reset')();
const target = flight.creatures[0];
const before = flight.alive;
for (let i = 0; i < 40 && flight.alive === before; i++) flight.hitTest(target.x, target.cy);
check('creatures can be shot down', flight.alive < before,
  `${before} -> ${flight.alive}`);

peek('reset')();

/* ------------------------------------------------------------ the hater */

const BOSS = peek('BOSS');
check('boss metadata loaded', BOSS.frames.length === 5, `${BOSS.frames.length} frames`);
check('boss states cover every frame',
  new Set(['hurt', 'hang', 'prep', 'load', 'strike']
    .flatMap((s) => BOSS[s])).size === BOSS.frames.length);
check('h01 (the photo) was dropped', !BOSS.frames.includes('h01'));

// He sleeps until you walk in, then cycles hang -> prep -> load -> strike.
peek('reset')();
player.x = 1000;
step(120);
check('boss idles until you arrive', peek('boss').state === 'hang');

peek('reset')();
const boss = peek('boss');
player.x = boss.x - 260;
player.y = GROUND_Y - PLAYER_H;
const seen = new Set();
for (let i = 0; i < 600; i++) { step(1); seen.add(boss.state); }
check('boss runs the full attack cycle',
  ['hang', 'prep', 'load', 'strike'].every((s) => seen.has(s)),
  [...seen].join(' -> '));

// Standing under the claw hurts; the telegraph is long enough to leave.
peek('reset')();
player.x = boss.x - 160;
player.y = GROUND_Y - PLAYER_H;
for (let i = 0; i < 600 && player.hitsTaken === 0; i++) step(1);
check('the claw connects when you stand in it', player.hitsTaken > 0);

// He slides along the pipe, so a stand-off doesn't work.
peek('reset')();
player.x = peek('TUBE_X0') + 40;
player.y = GROUND_Y - PLAYER_H;
const startGap = Math.abs(boss.x - player.x);
for (let i = 0; i < 240; i++) step(1);
check('boss closes the distance along the pipe',
  Math.abs(boss.x - player.x) < startGap - 100,
  `gap ${startGap.toFixed(0)} -> ${Math.abs(boss.x - player.x).toFixed(0)}`);

check('boss stays on the pipe', boss.x > peek('TUBE_X0') && boss.x < peek('TUBE_X1'),
  `x=${boss.x.toFixed(0)}`);

// No ledge may double as a sniper's nest. The claw sweeps the floor, so anyone
// standing above it is untouchable; if such a spot is also within rifle range
// the whole fight can be skipped from safety.
peek('reset')();
const bossFloor = peek('TUBE_X0') + 140 - peek('BOSS_HIT').w / 2;   // his furthest left edge
const clawFloor = peek('CLAW_ZONE').y0;
for (const [px, py, pw] of peek('PLATFORM_RECTS')) {
  const feet = py;                                   // where he stands on it
  if (feet > clawFloor) continue;                    // the claw can still reach him there
  player.x = px + pw;                                // furthest right you can stand on it
  player.y = py - PLAYER_H;
  player.facing = 1;
  const reach = peek('muzzle')().x + peek('SHOT_RANGE');
  check(`platform @${px},${py} is not a safe firing perch`, reach < bossFloor,
    `reach ${reach.toFixed(0)} vs his nearest edge ${bossFloor.toFixed(0)}`);
}

// The whole point of the range limit: park at the furthest spot from which a
// shot still lands, never move, and he should still get to you before he dies.
peek('reset')();
const maxRange = peek('SHOT_RANGE') + peek('BOSS_HIT').w / 2 - 30;
player.x = boss.x - maxRange;
player.y = GROUND_Y - PLAYER_H;
player.facing = 1;
key('KeyF', true);
let landedShot = false;
for (let i = 0; i < 2400 && !(player.hitsTaken > 0) && boss.hp > 0; i++) {
  step(1);
  if (boss.hp < peek('BOSS_HP')) landedShot = true;
  player.vx = 0;                       // pin him: no drifting out of the fight
}
key('KeyF', false);
check('shots reach him from the stand-off spot', landedShot, `hp=${boss.hp}`);
check('you cannot out-range him and plink him down', player.hitsTaken > 0,
  `hits=${player.hitsTaken}, boss hp ${boss.hp}`);

// He mirrors so he never swings away from you.
const spanAt = (facing, x) => { boss.facing = facing; boss.x = x; return peek('clawSpan')(); };
const left = spanAt(-1, 1000);
const right = spanAt(1, 1000);
check('claw span mirrors with facing',
  left[0] === 2000 - right[1] && left[1] === 2000 - right[0],
  `${left} vs ${right}`);

peek('reset')();
player.x = boss.x + 200;          // stand on his right, inside his reach
player.y = GROUND_Y - PLAYER_H;
for (let i = 0; i < 900 && player.hitsTaken === 0; i++) step(1);
check('boss turns to swing at you from the other side',
  player.hitsTaken > 0 && boss.facing === 1, `facing=${boss.facing}`);

// The two dodges the fight is built on, each tested at the mechanism rather
// than through a fuzzy bot: get high enough, or get out of the way.
function survivesStrike(setup) {
  peek('reset')();
  player.x = boss.x - 120;                 // squarely inside the claw's span
  player.y = GROUND_Y - PLAYER_H;
  step(2);
  setup();
  boss.state = 'strike';
  boss.t = 0;
  for (let i = 0; i < Math.ceil(peek('STRIKE_ACTIVE') * 60) + 4; i++) step(1);
  return player.hitsTaken === 0;
}

check('standing in the claw gets you hit', !survivesStrike(() => {}));
check('a jump near its apex clears the claw', survivesStrike(() => {
  player.onGround = false;
  player.y = GROUND_Y - PLAYER_H - 195;   // roughly jump apex
  player.vy = 0;
}), `claw floor y=${peek('CLAW_ZONE').y0}, active ${peek('STRIKE_ACTIVE')}s`);
check('backing out of the span clears the claw', survivesStrike(() => {
  // his trailing edge has to clear the span, not just his left edge
  player.x = boss.x - peek('CLAW_ZONE').far - peek('PLAYER_W') - 40;
}));

const TIMING = peek('BOSS_TIMING');
const telegraph = TIMING.prep + TIMING.load;
const zone = peek('CLAW_ZONE');
const escapeNeeded = (zone.near + zone.far) / peek('MOVE_SPEED');
check('telegraph is long enough to run out of the zone', telegraph >= escapeNeeded * 0.7,
  `${telegraph.toFixed(2)}s warning vs ${escapeNeeded.toFixed(2)}s to cross`);

// Shooting.
peek('reset')();
player.x = boss.x - 420;
player.y = GROUND_Y - PLAYER_H;
player.facing = 1;
step(2);
const hpBefore = boss.hp;
key('KeyF', true);
step(2);
check('firing spawns a shot', peek('bullets').length > 0);
for (let i = 0; i < 60 && boss.hp === hpBefore; i++) step(1);
key('KeyF', false);
check('shots damage the boss', boss.hp < hpBefore, `hp ${hpBefore} -> ${boss.hp}`);

// The muzzle has to line up with the boss hitbox or the fight is unwinnable.
peek('reset')();
player.x = boss.x - 420;
player.y = GROUND_Y - PLAYER_H;
step(2);
const HIT = peek('BOSS_HIT');
const my = peek('muzzle')().y;
check('muzzle line crosses the boss hitbox',
  Math.abs(my - HIT.cy) < HIT.h / 2,
  `muzzle y=${my.toFixed(0)}, hitbox ${(HIT.cy - HIT.h / 2).toFixed(0)}..${(HIT.cy + HIT.h / 2).toFixed(0)}`);

// Killing him ends the run.
peek('reset')();
player.x = boss.x - 420;
player.y = GROUND_Y - PLAYER_H;
key('KeyF', true);
for (let i = 0; i < 2000 && !peek('won'); i++) step(1);
key('KeyF', false);
check('killing the hater wins', peek('won') === true,
  `hp=${boss.hp} dead=${boss.dead}`);
check('boss played its death fall', boss.dying > 1.5 || boss.dead);

/* --------------------------------------------- transformation & jab mode */

peek('reset')();
const pInit = peek('player');
check('player starts with full HP (100)', pInit.hp === 100);
check('player starts non-muscular', pInit.muscular === false);

// Damage player
peek('hurtPlayer')(20);
check('hurtPlayer reduces HP', pInit.hp === 80, `hp=${pInit.hp}`);

// Reduce boss HP to half (6) to trigger transformation
peek('reset')();
player.x = boss.x - 420;
player.y = GROUND_Y - PLAYER_H;
player.facing = 1;
const hpStart = boss.hp;
for (let i = 0; i < 6; i++) {
  key('KeyF', true);
  for (let s = 0; s < 40; s++) step(1);
  key('KeyF', false);
}
// Allow cutscene (UFO fly-by + comic panels) to complete
step(400);

check('boss reached half health', boss.hp <= 6, `boss hp=${boss.hp}`);
check('transformation triggered', peek('transformTriggered') === true);
check('player transformed into muscular mode', player.muscular === true, `muscular=${player.muscular}`);
check('UFO laser hit reduced player HP moderately', player.hp < 100 && player.hp > 0, `hp=${player.hp}`);

// Allow cooldowns to settle after transformation cutscene
step(30);

// Test Jab Attack in muscular mode
key('KeyF', true);
const bulletsBefore = peek('bullets').length;
step(2);
key('KeyF', false);
check('muscular mode jabs instead of spawning bullets', peek('bullets').length === 0 && bulletsBefore === 0);
check('jab animation triggered', player.jabAnim > 0, `jabAnim=${player.jabAnim.toFixed(2)}`);

// Move closer for jab hit
player.x = boss.x - 80;
// Allow cooldown to clear before jab
step(30);
const hpBeforeJab = boss.hp;
key('KeyF', true);
step(5);
key('KeyF', false);
check('jab connects and damages boss at close range', boss.hp < hpBeforeJab, `boss hp=${boss.hp}`);
check('jab hit spawns ink splatters', peek('inkSplatters').length > 0, `splatters=${peek('inkSplatters').length}`);

/* --------------------------------------------- level reachability review */

const JUMP_V = peek('JUMP_V'), GRAVITY = peek('GRAVITY'), SPEED = peek('MOVE_SPEED');
const maxRise = (JUMP_V * JUMP_V) / (2 * GRAVITY);
const maxRun = SPEED * ((2 * JUMP_V) / GRAVITY);
console.log(`\nreach envelope: rise ${maxRise.toFixed(0)}u, level flight ${maxRun.toFixed(0)}u`);

const spans = peek('GROUND_SPANS');
const FL = peek('FLIGHT');
const inCorridor = (x) => x > FL.x0 - 40 && x < FL.x1 + 40;

for (let i = 0; i < spans.length - 1; i++) {
  const gap = spans[i + 1][0] - spans[i][1];
  if (Math.abs(spans[i][1] - FL.x0) < 40 && Math.abs(spans[i + 1][0] - FL.x1) < 40) {
    // this one is the jetpack corridor; it is crossed under thrust
    check(`gap ${i + 1} is the flight corridor`, gap > 400, `${gap}u, flown`);
    continue;
  }
  // a platform sitting inside the gap turns it into two shorter hops
  const bridged = peek('PLATFORM_RECTS').some(([x, , w]) =>
    x > spans[i][1] - 20 && x + w < spans[i + 1][0] + 20);
  check(`gap ${i + 1} is crossable`, gap < maxRun * 0.92 || bridged,
    `${gap}u${bridged ? ', bridged' : ''}`);
}

const surfaces = [
  ...spans.map(([x0, x1]) => ({ x: x0, w: x1 - x0, y: GROUND_Y })),
  ...peek('PLATFORM_RECTS').map(([x, y, w]) => ({ x, y, w })),
];
for (const [x, y, w] of peek('PLATFORM_RECTS')) {
  const inRange = (s) => s.x < x + w + maxRun * 0.5 && s.x + s.w > x - maxRun * 0.5;
  // jumped up to from a lower ledge...
  const rise = surfaces
    .filter((s) => s.y > y && inRange(s))
    .reduce((best, s) => Math.min(best, s.y - y), Infinity);
  // ...or simply dropped onto from a higher one
  const dropFrom = surfaces.some((s) => s.y < y && inRange(s));
  check(`platform @${x},${y} is reachable`, rise <= maxRise * 0.95 || dropFrom,
    rise <= maxRise * 0.95
      ? `rise ${rise.toFixed(0)}u of ${(maxRise * 0.95).toFixed(0)}u`
      : 'drop-only');
}

for (const p of peek('pickups')) {
  if (inCorridor(p.x)) {
    // corridor stars are collected in flight, so the test is whether they sit
    // inside the band the jetpack can actually reach
    check(`star @${p.x},${p.y} is inside the flyable band`,
      p.y > FL.roof + 40 && p.y < FL.deathY - 60,
      `roof ${FL.roof}, death ${FL.deathY}`);
    continue;
  }
  const standable = surfaces.some((s) =>
    p.x > s.x - 30 && p.x < s.x + s.w + 30 &&
    Math.abs((s.y - PLAYER_H + PLAYER_H * 0.45) - p.y) < 76);
  const jumpable = surfaces.some((s) =>
    p.x > s.x - maxRun * 0.5 && p.x < s.x + s.w + maxRun * 0.5 &&
    (s.y - PLAYER_H + PLAYER_H * 0.45) - p.y < maxRise + 60 &&
    (s.y - PLAYER_H + PLAYER_H * 0.45) - p.y > -76);
  check(`star @${p.x},${p.y} is collectable`, standable || jumpable);
}

console.log(`\n${failures ? `${failures} FAILED` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
}

main();
