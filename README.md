# Paper Soldier

A small 2D platformer built from pencil animations and Figma panels. The
characters are cut out of the page and the level is sketched around them in the
same graphite.

Kelvin was never coming to System C-137. He hired Bob. Bob is a squirrel.

## Play

Open `index.html` in a browser. No server or build step needed.

| | |
|---|---|
| move | `A` / `D` or `←` / `→` |
| jump | `Space` / `W` / `↑` (hold for height) |
| shoot | `F` or `J` |
| restart | `R` |
| cutscene | `Space` advance / `Esc` skip |
| crash | any key to skip |
| jetpack | hold `Space` to fly (in the corridor) |

Collect the 18 stars, fly the corridor, then kill the hater at the end.

## Opening cutscene

`intro.js` plays six Figma panels as a comic before the game starts. Each panel
slams onto the page with a decaying shake, settles into an idle drift keyed to
what it depicts, then types its captions one **beat** at a time — a panel can
hold several lines of dialogue, and a beat can fire effects.

Effects, in the order the story uses them:

| fx | what it does |
|---|---|
| `dim` | shadow down — the cockpit lights drop |
| `bobGone` | swaps to `s4_empty.png`, the same cockpit drawn without Bob |
| `siren` | two-tone alarm on a repeating timer + a pulsing red wash |
| `explode` | whiteout, hard shake, noise burst |

**Bob vanishing** is an asset swap, not a runtime cutout. `s4_empty.png` is
built offline by `tools/` steps: Bob's head and gloves come off by taking his
area from the base layer (which has the wheel drawn but no Bob), then the empty
hoodie left behind is inpainted away and the wheel composited back on top. The
result is an empty seat with the wheel still turning — which is the joke.

**Sound is synthesised in WebAudio** — no audio files, so the game stays a
single self-contained folder. A short filtered square blip fires on every second
character (a per-character blip machine-guns; every second one reads as
printing), pitch-jittered ±6% so it never sounds mechanical, and punctuation
drops a fifth and rings longer to give each line a cadence. The siren, the
explosion, the impact and the steam all come from the same kit — filtered noise
and a couple of oscillators.

Browsers won't start audio without a gesture, so the first panel holds on
`PRESS ANY KEY` — that keypress unlocks the context and starts the scene.

Caption text is rendered small and upscaled with smoothing off, so it stays
blocky against the pixel-art plate instead of going soft.

## The crash

`crash.js` runs on the game field between the cutscene and play. The ship comes
down trailing exhaust, hits hard, skids to a stop throwing dust, and settles
venting steam; Kelvin climbs out and the moment he lands the player has control.

It draws inside the game's own world transform, so the wreck is in level
coordinates and simply stays there afterwards as scenery, still steaming. It is
also **solid** — `WRECK` in `game.js` — so you can climb the hull. The collision
box is deliberately narrower and lower than the drawing, because the nose and
tail taper to nothing and standing on empty air reads as a bug.

Any key skips it.

### Re-exporting the panels

The panel PNGs in `assets/scenes/` are exported **with their caption boxes
empty** — the words live in `intro.js` so they can be typed. The Figma file
itself holds the same script as real text (so the file reads properly), which
means a straight re-export would bake the captions into the image. Blank the
four text nodes first, export, then put the script back.

Panels 4, 5 and 6 had no caption box; one was cloned in from panel 1 at (60, 74)
for each. There are six text nodes to blank now, not four.

## The jetpack corridor

The middle of the map has no floor. `FLIGHT` in `game.js` marks a 1620-unit
chasm with a roof you cannot climb over and a drop that kills; the only way
across is to hold `Space` and fly it.

Hangers drop from the roof and pillars rise out of the dark, alternating, and
their bands **do not overlap** — a hanger forces you low, the next pillar forces
you high. Crossing is a weave, not a straight line, which is the whole point.

`flight.js` holds the station-keeping saucers. Every one telegraphs before it
fires: it **banks toward you** and its **underside lamp charges**, then snaps
dark on release. A saucer is one drawing, so unlike the hater it cannot tell you
anything through its pose — the wind-up has to be motion and light instead. That
is what makes the patterns dodgeable rather than reactive, and the placement is
fixed, never random, so the corridor can be learned.

| type | pattern |
|---|---|
| `volley` | one fast aimed shot |
| `fan` | five-shot spread |
| `swoop` | charges your height, then a two-shot burst |

They have 2 HP and can be shot down, or simply flown past. Their hulls hurt too,
so a swooper stays dangerous after it has fired. The box that hurts you is
tighter than the box you can shoot: being clipped by a hull you thought you
cleared feels cheap, and missing a shot that looked on target feels worse.

`assets/ufo.png` is keyed off the page by `tools/key_asset.py`. If it is absent
the hater's frames stand in, so the corridor degrades instead of emptying.

Two failure modes the checks guard against, both of which bit during
development: a platform reaching into the corridor mouth wedges you against the
first hanger with no room to duck under, and a hanger dropping below standing
height makes the corridor impossible to enter at ground level.

## The fight

The hater hangs off a pipe over the last stretch. His cycle is
**hang → prep → load → strike**, straight from the drawn frames: the prep and
load poses are a 0.8s telegraph, and only the impact frame actually hurts.

Two things make it a fight rather than a shooting gallery, and both are pinned
by checks in `tools/check_game.js`:

- **He slides along the pipe after you.** Backing off buys time, not safety.
- **Shots die at 520 units.** Anywhere you can hurt him from, he can reach you
  back — no standing at the edge of the arena plinking him down.

Two dodges work: get out of the claw's span, or jump so you're above it at the
moment it lands. Standing still and shooting costs you hits.

The arena is deliberately bare. The claw sweeps the floor, so any ledge inside
rifle range would be a free win — `check_game.js` asserts no platform can reach
him.

## How the sprites were made

`tools/extract_sprites.py` turns both videos into game-ready frames:

1. **Frames** — ffmpeg pulls the drawn frames out of each video into
   `frames_raw/` and `frames_hater/` (caches; delete to re-extract).
2. **White removal** — the pencil is treated as dark ink laid over paper, so
   `alpha = (paper - luma) / (paper - ink)`. Compositing the result back over a
   light background reproduces the original stroke weight, and the paper grain
   drops out instead of leaving a white box.
3. **Only the centre** — a noise gate, a density filter and a connected-component
   pass throw away paper specks, the FlipaClip watermark, and the stray stroke in
   the corner of soldier frame 7. Each subject's frames are then cropped to one
   shared box, so the figure stays anchored across its animation.
4. **Per-subject fixes** — see below.

Outputs land in `assets/`: individual frames, a `soldier_sheet.png` and
`hater_sheet.png`, a seamless `paper.png` lifted from an empty corner of the
artwork, and `sprite.js` with the frame sizes and anchor points.

Rebuild with:

```
python tools/extract_sprites.py
```

Needs `ffmpeg` on PATH plus `pillow`, `numpy` and `opencv-python`.

### The soldier

Built from `soldier2.mp4`: frames 1-3 are full-body idle, 4-13 are the
legs-only walk cycle, and frame 4 of `jet pack 4 frame.mp4` is pulled in as a
14th frame — the `fly` pose. Lifting it into the soldier's own frame list means
it shares the shared crop box and the head graft, so it lines up with every
other pose for free (`extra` in the subject config). That split is clean, so every run frame gets a torso
grafted and none of them is a stray standing pose. Airborne poses reuse run
frames: knee tucked going up, leg reaching coming down.

`soldier2.mp4` is 1280x720 where the first pass was 1920x1080, so it is scaled
up on extraction (`scale` in the subject config) rather than retuning every
landmark constant into a second coordinate space.

**Torso graft** — the source run cycle is *legs only*; the artist never inked
the upper half. The idle pose is cut just below the belt and reattached to each
run frame, matched on the belt line. To use the untouched legs-only art, comment
out `build_run_torsos(frames, pad)` and rebuild.

**Head graft** — the body is inked *headless*: there's a collar arc at the top
of the sheet and nothing above it. `head.mp4` supplies the head (frame 1 is a
photo of the page and is dropped; the other two are drawn). Every soldier frame
grows `HEAD_PAD` rows upward to make room, then the head is dropped into the
collar — placed *behind* the body, so the collar laps over the chin instead of
the head sitting on top like a sticker. Only the idle frames are touched; the
run frames inherit it through the torso graft.

The two drawn heads alternate across the idle frames so the loop breathes. The
hair is drawn far lighter than the face, so this subject uses a lower noise gate
(`floor`/`gain`) — at the default most of the hair vanishes.

Knobs: `HEAD_SCALE` (the two sheets were drawn at different sizes),
`HEAD_TUCK` (how deep the chin sits in the collar), `COLLAR_X` (where to look
for the collar arc).

The game scales the sprite against `bodyH` (collar-to-boots) rather than the
padded canvas, so the body still fills the hitbox and the head rides above it.

### The hater

Six frames come out of `hater.mp4` (a seventh packet exists but is a
discardable duplicate and decodes to nothing). They map to:

| frame | use |
|---|---|
| h01 | photo of the paper — dropped, it isn't a drawn frame |
| h02 | `hurt` — flailing, not gripping |
| h03 | `hang` — both hands on the tube |
| h04 | `prep` |
| h05 | `load` |
| h06 | `strike` |

**On the hurt frame:** you described the *last* frame as the hit/death one, but
h06 is unmistakably the swing landing — it matches the prep/load/execution
sequence you described for 4-5-6. h02 is the one that reads as hurt: hands open,
not gripping, no tube. That's the assignment used. If you meant otherwise, it's
the `states` map in `tools/extract_sprites.py`.

**The tube** is only inked in h03, so keeping it would flash it on and off. It's
erased there and drawn by the game instead. `gripY: 47` in the subject config is
the line his hands close around, measured off the drawn tube before erasing —
it can't be recovered from the ink afterwards, and the topmost claw tip sits
well above it.

## Checks

```
node tools/check_game.js
```

Runs `game.js` headlessly against a stub canvas: physics, collision, pickups,
the render path, the boss state machine and its two dodges, plus a reachability
pass over the level (every platform jumpable, gap crossable, star collectable,
and no platform usable as a safe firing perch).
