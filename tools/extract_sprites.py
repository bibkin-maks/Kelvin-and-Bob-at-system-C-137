"""
Turn the source animations into transparent sprite frames + a paper texture.

Both videos are pencil drawings on white paper (~luma 250) carrying a FlipaClip
watermark and the odd stray mark outside the figure.

Pipeline per frame:
  1. white -> alpha keying:  the pencil is treated as ink of a fixed dark colour
     laid over paper, so alpha = (paper - luma) / (paper - ink). Compositing the
     result back over any light background reproduces the original stroke value.
  2. noise gate + density filter to drop paper grain and isolated specks.
  3. crop to a shared bounding box so every frame of a subject stays anchored to
     the same origin and the watermark is left behind.

Run it with no arguments to rebuild everything into assets/.
"""

import json
import subprocess
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets"

INK = np.array([46, 42, 38], dtype=np.float32)  # warm graphite
NOISE_FLOOR = 0.13   # alpha below this is paper grain
INK_GAIN = 0.86      # alpha at/above this becomes fully opaque
DENSITY_R = 4        # radius of the neighbourhood used to kill specks
DENSITY_MIN = 0.16   # fraction of neighbours that must also be ink

SUBJECTS = {
    # The soldier: 4 full-body idle drawings then a legs-only run cycle.
    "soldier": {
        "video": "soldier2.mp4",
        "raw": "frames_raw",
        "prefix": "f",
        # soldier2 was drawn at 1280x720 where the first pass was 1920x1080.
        # Everything downstream - the ROI, the belt landmarks, the head
        # placement - is tuned in the larger space, so the frames are scaled up
        # on extraction rather than retuning a dozen constants.
        "scale": "1920:1080",
        # The jetpack pose lives in its own take, as frame 4. Pulling it into
        # the soldier's own frame list means it shares the shared crop box and
        # the head graft, so it lines up with every other pose for free.
        "extra": [{"video": "jet pack 4 frame.mp4", "frame": 4, "as": "f14"}],
        "skip": (),
        # keep the middle of the page; drops the watermark (far left, bottom)
        "roi": (620, 40, 1520, 1070),
        # the run frames are legs-only, so anything high on the page and left of
        # the torso is a stray mark rather than the figure (f07 has one)
        "erase": {"*": [(0, 0, 755, 430)]},
        "graft": True,
        "states": {"idle": [0, 1, 2], "fly": [13], "run": "rest"},
        "anchor": "feet",
    },
    # The soldier's head, drawn on its own sheet. The body is inked headless -
    # there's a collar arc at the top and nothing above it - so this gets
    # composited on before anything else uses the torso.
    "head": {
        "video": "head.mp4",
        "raw": "frames_head",
        "prefix": "d",
        "skip": ("d01",),          # photo of the page, not a drawn frame
        "roi": (300, 0, 1010, 610),  # clear of the watermark, bottom left
        "erase": {},
        # The hair is drawn far lighter than the face - most of it sits under
        # the default gate and vanishes. A lower floor keeps it; the tight ROI
        # and the component filter handle the extra grain that lets through.
        "floor": 0.045,
        "gain": 0.62,
        "graft": False,
        "states": {"idle": "rest"},
        "anchor": "neck",
    },
    # The hater: a gremlin hanging from a tube. h01 is a photo of the paper
    # rather than a drawn frame, so it never reaches the game.
    "hater": {
        "video": "hater.mp4",
        "raw": "frames_hater",
        "prefix": "h",
        "skip": ("h01",),
        "roi": (240, 0, 1280, 720),
        # the tube is only inked in the idle frame; leaving it in would make it
        # flash on and off, so it comes out here and the game draws it instead
        "erase": {"h03": [(545, 100, 900, 195)]},
        "graft": False,
        "states": {"hurt": [0], "hang": [1], "prep": [2], "load": [3], "strike": [4]},
        "anchor": "grip",
        # The line his hands close around, in sprite space. Measured off the
        # drawn tube in h03 before it was erased (it slopes, so this is its
        # height at the sprite's centre x) - it can't be found from the ink
        # afterwards, and the topmost claw tip sits well above it.
        "gripY": 47,
    },
    "muscule": {
        "video": "muscule.mp4",
        "raw": "frames_muscule",
        "prefix": "m",
        "scale": "1920:1080",
        "skip": (),
        "roi": (400, 0, 1600, 1080),
        "erase": {},
        "graft": False,
        "states": {"idleBody": [0, 1, 2], "jabBody": [3, 4, 5], "idleLegs": [6, 7, 8], "runLegs": "rest"},
        "anchor": "feet",
    },
}

# Sprite-space landmarks used to reattach the soldier's idle torso to his run
# frames, which the artist only inked from the belt down.
BELT_TOP = 300
TORSO_CUT = 338
BELT_H = 38
# soldier2 splits cleanly: 1-3 are full-body idle, 4 onward are legs-only, so
# the run cycle starts at 4 and every one of those frames needs a torso.
RUN_FRAMES = [f"f{i:02d}" for i in range(4, 14)]
# f14 is the jetpack pose: a full body, so it wants the head but not a torso
IDLE_FRAMES = [f"f{i:02d}" for i in range(1, 4)] + ["f14"]

# Head placement. The body is inked headless, so the canvas grows upward to
# make room and the head is dropped into the collar.
HEAD_PAD = 215        # rows added above the body
HEAD_SCALE = 0.87     # head drawing -> body drawing (different source sheets)
HEAD_TUCK = 28        # how far the chin sits below the collar's top edge
COLLAR_X = (300, 460)  # where to look for the collar arc, in body sprite space


def box_mean(mask: np.ndarray, r: int) -> np.ndarray:
    """Mean of `mask` over a (2r+1)^2 window, via summed-area table."""
    pad = np.pad(mask, r + 1, mode="constant")
    sat = pad.cumsum(0).cumsum(1)
    h, w = mask.shape
    k = 2 * r + 1
    total = sat[k:k + h, k:k + w] - sat[0:h, k:k + w] - sat[k:k + h, 0:w] + sat[0:h, 0:w]
    return total / (k * k)


def figure_mask(a: np.ndarray, min_ink: int = 250) -> np.ndarray:
    """Drop ink blobs too small to be part of the drawing.

    The sketches are loose, so parts of a figure are genuinely detached from
    each other; components are found on a dilated mask to bridge those gaps, but
    each is then scored on its *undilated* ink area, so a lone smudge is judged
    on its own size rather than on how far it sits from the figure.
    """
    ink = a > 0.22
    bridged = cv2.dilate(ink.astype(np.uint8), np.ones((15, 15), np.uint8))
    count, labels = cv2.connectedComponents(bridged, connectivity=8)
    if count <= 1:
        return np.zeros_like(a)
    ink_area = np.bincount(labels[ink], minlength=count)
    keep = ink_area >= min_ink
    keep[0] = False
    return keep[labels].astype(np.float32)


def frame_alpha(path: Path, cfg: dict) -> np.ndarray:
    luma = np.asarray(Image.open(path).convert("L")).astype(np.float32)
    paper = float(np.median(luma))
    floor = cfg.get("floor", NOISE_FLOOR)
    gain = cfg.get("gain", INK_GAIN)
    a = np.clip((paper - luma) / (paper - INK.mean()), 0.0, 1.0)
    a = np.clip((a - floor) / (gain - floor), 0.0, 1.0)

    keep = box_mean((a > 0.22).astype(np.float32), DENSITY_R) > DENSITY_MIN
    a *= keep

    roi = cfg["roi"]
    outside = np.ones_like(a, dtype=bool)
    outside[roi[1]:roi[3], roi[0]:roi[2]] = False
    a[outside] = 0.0

    for who, boxes in cfg["erase"].items():
        if who not in ("*", path.stem):
            continue
        for x0, y0, x1, y1 in boxes:
            a[y0:y1, x0:x1] = 0.0

    return a * figure_mask(a)


def bbox(a: np.ndarray, thresh: float = 0.25):
    rows = np.where(a.max(axis=1) > thresh)[0]
    cols = np.where(a.max(axis=0) > thresh)[0]
    if not len(rows) or not len(cols):
        return None
    return cols[0], rows[0], cols[-1] + 1, rows[-1] + 1


def ink_center_x(alpha: np.ndarray) -> int:
    cols = alpha.astype(np.float32).sum(axis=0)
    if cols.sum() == 0:
        return alpha.shape[1] // 2
    return int(round(float((cols * np.arange(len(cols))).sum() / cols.sum())))


def ink_bottom(img: Image.Image) -> int:
    a = np.asarray(img)[..., 3]
    return int(np.where(a.max(axis=1) > 60)[0][-1])


def ink_top(img: Image.Image) -> int:
    a = np.asarray(img)[..., 3]
    return int(np.where(a.max(axis=1) > 60)[0][0])


def stance_x(img: Image.Image) -> float:
    """Horizontal centroid of the boots, i.e. where the figure's weight sits."""
    a = np.asarray(img)[..., 3].astype(np.float32)
    feet = a[ink_bottom(img) - 90:, :]
    cols = feet.sum(axis=0)
    return float((cols * np.arange(len(cols))).sum() / cols.sum())


def collar_anchor(body: Image.Image) -> tuple[int, int]:
    """Top and centre of the collar arc - the opening the head drops into."""
    a = np.asarray(body)[..., 3]
    band = a[:, COLLAR_X[0]:COLLAR_X[1]]
    top = int(np.where((band > 70).sum(axis=1) > 3)[0][0])
    cols = band[top:top + 45].astype(np.float32).sum(axis=0)
    cx = COLLAR_X[0] + float((cols * np.arange(len(cols))).sum() / cols.sum())
    return int(round(cx)), top


def attach_heads(frames: dict[str, Image.Image], heads: dict[str, Image.Image],
                 head_meta: dict) -> int:
    """Composite the drawn head onto the headless body.

    The body sheet stops at a collar arc with nothing above it, so every frame
    grows upward first. The head goes on *behind* the body so the collar laps
    over the chin instead of the head sitting on top like a sticker. Only the
    idle frames are touched - the run frames inherit it with the torso graft.

    Returns the number of rows added, which shifts every other landmark down.
    """
    w, h = next(iter(frames.values())).size
    for name, img in frames.items():
        grown = Image.new("RGBA", (w, h + HEAD_PAD), (0, 0, 0, 0))
        grown.paste(img, (0, HEAD_PAD))
        frames[name] = grown

    head_imgs = list(heads.values())
    neck_x = head_meta["centerX"] * HEAD_SCALE
    neck_y = head_meta["neckY"] * HEAD_SCALE

    for i, name in enumerate(IDLE_FRAMES):
        body = frames[name]
        # alternate the two drawn heads so the idle loop breathes
        src = head_imgs[i % len(head_imgs)]
        head = src.resize(
            (round(src.width * HEAD_SCALE), round(src.height * HEAD_SCALE)),
            Image.LANCZOS,
        )
        cx, top = collar_anchor(body)
        out = Image.new("RGBA", body.size, (0, 0, 0, 0))
        out.paste(head, (round(cx - neck_x), round(top + HEAD_TUCK - neck_y)))
        out.alpha_composite(body)
        frames[name] = out
    return HEAD_PAD


def build_run_torsos(frames: dict[str, Image.Image], pad: int = 0) -> None:
    """Give the soldier's legs-only run frames a torso.

    The artist only inked legs for the run cycle, so a runner drawn straight
    from the source loses his upper half the moment he starts moving. The idle
    pose is cut just under the belt and re-attached to each run frame, matched
    on the belt: both halves come from the same drawing, so the linework and
    proportions already agree.
    """
    belt_top_y, torso_cut = BELT_TOP + pad, TORSO_CUT + pad
    torso = np.asarray(frames["f01"]).copy()
    torso[torso_cut:] = 0
    torso_img = Image.fromarray(torso, "RGBA")
    anchor_x = ink_center_x(np.asarray(frames["f01"])[belt_top_y:torso_cut, :, 3])

    for name in RUN_FRAMES:
        legs = np.asarray(frames[name])
        rows = np.where(legs[..., 3].max(axis=1) > 60)[0]
        belt_top = int(rows[0])
        dx = ink_center_x(legs[belt_top:belt_top + BELT_H, :, 3]) - anchor_x
        dy = (belt_top + BELT_H) - torso_cut

        out = Image.new("RGBA", torso_img.size, (0, 0, 0, 0))
        out.paste(torso_img, (dx, dy))
        out.alpha_composite(frames[name])
        frames[name] = out


def extract_frames(cfg: dict) -> list[Path]:
    """Pull the drawn frames out of a video (cached in its raw/ directory)."""
    raw = ROOT / cfg["raw"]
    if not sorted(raw.glob("*.png")):
        raw.mkdir(exist_ok=True)
        cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(ROOT / cfg["video"])]
        if cfg.get("scale"):
            cmd += ["-vf", f"scale={cfg['scale']}:flags=lanczos"]
        cmd += ["-vsync", "0", str(raw / f"{cfg['prefix']}%02d.png")]
        subprocess.run(cmd, check=True)

        # single frames lifted out of other takes, appended to this subject
        for x in cfg.get("extra", []):
            sub = ["ffmpeg", "-y", "-v", "error", "-i", str(ROOT / x["video"]),
                   "-vf", f"select=eq(n\\,{x['frame'] - 1})"
                          + (f",scale={cfg['scale']}:flags=lanczos" if cfg.get("scale") else ""),
                   "-frames:v", "1", str(raw / f"{x['as']}.png")]
            subprocess.run(sub, check=True)
    return [p for p in sorted(raw.glob("*.png")) if p.stem not in cfg["skip"]]


def process(name: str, cfg: dict, head: tuple | None = None) -> tuple[dict, dict]:
    paths = extract_frames(cfg)
    alphas = [frame_alpha(p, cfg) for p in paths]

    boxes = [b for b in (bbox(a) for a in alphas) if b]
    x0 = min(b[0] for b in boxes) - 6
    y0 = min(b[1] for b in boxes) - 6
    x1 = max(b[2] for b in boxes) + 6
    y1 = max(b[3] for b in boxes) + 6
    x0, y0 = max(x0, 0), max(y0, 0)
    x1, y1 = min(x1, alphas[0].shape[1]), min(y1, alphas[0].shape[0])
    w, h = x1 - x0, y1 - y0
    print(f"[{name}] shared crop x{x0}..{x1} y{y0}..{y1} ({w}x{h})")

    frames: dict[str, Image.Image] = {}
    for path, a in zip(paths, alphas):
        sub = a[y0:y1, x0:x1]
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[..., :3] = INK.astype(np.uint8)
        rgba[..., 3] = (sub * 255).round().astype(np.uint8)
        frames[path.stem] = Image.fromarray(rgba, "RGBA")
        print(f"  {path.stem}: coverage {(sub > 0.05).mean() * 100:.1f}%")

    body_top = min(ink_top(f) for f in frames.values())
    pad = attach_heads(frames, head[0], head[1]) if head else 0
    if cfg["graft"]:
        build_run_torsos(frames, pad)
    h += pad

    sheet = Image.new("RGBA", (w * len(frames), h), (0, 0, 0, 0))
    for i, (frame_name, img) in enumerate(frames.items()):
        img.save(OUT / f"{frame_name}.png")
        sheet.paste(img, (i * w, 0))
    sheet.save(OUT / f"{name}_sheet.png")

    imgs = list(frames.values())
    meta = {
        "frameWidth": int(w),
        "frameHeight": int(h),
        "frames": list(frames),
    }
    if cfg["anchor"] == "neck":
        # the chin, and the x the face is centred on: where it meets the collar
        meta["neckY"] = max(ink_bottom(f) for f in imgs)
        meta["centerX"] = int(round(float(np.median(
            [ink_center_x(np.asarray(f)[..., 3]) for f in imgs]))))
    elif cfg["anchor"] == "feet":
        # where the boots meet the page, and the x the stance balances around
        meta["groundY"] = max(ink_bottom(f) for f in imgs)
        meta["centerX"] = int(round(float(np.median([stance_x(f) for f in imgs]))))
        # collar-to-boots, i.e. the body without the grafted head. The game
        # scales against this so adding the head grows him upward out of the
        # hitbox instead of shrinking the body inside it.
        meta["bodyH"] = meta["groundY"] - (body_top + pad)
    else:
        # where the hands close around the tube, so the game can hang him off it
        idle = imgs[1]
        meta["gripY"] = cfg["gripY"]
        meta["centerX"] = ink_center_x(np.asarray(idle)[..., 3])
        meta["reachY"] = max(ink_bottom(f) for f in imgs)

    rest = [i for i, _ in enumerate(frames)]
    for state, idx in cfg["states"].items():
        if idx != "rest":
            meta[state] = idx
            rest = [i for i in rest if i not in idx]
    for state, idx in cfg["states"].items():
        if idx == "rest":
            meta[state] = rest
    summary = {k: v for k, v in meta.items() if k != "frames"}
    print(f"  sheet {sheet.size[0]}x{sheet.size[1]}, {summary}")
    return frames, meta


def paper_tile(size: int = 512) -> Image.Image:
    """A seamless paper texture lifted from an empty corner of the artwork."""
    src = Image.open(ROOT / "frames_raw" / "f01.png").convert("RGB")
    # right of the gun (max ink x is ~1352) and inside the 1920x1080 frame
    patch = src.crop((1390, 200, 1390 + size, 200 + size))
    q = np.asarray(patch).astype(np.float32)
    # 4-way mirror so the tile repeats without a visible seam
    top = np.concatenate([q, q[:, ::-1]], axis=1)
    tile = np.concatenate([top, top[::-1, :]], axis=0)
    return Image.fromarray(tile.astype(np.uint8))


def main() -> None:
    OUT.mkdir(exist_ok=True)
    # the head has to exist before the body that wears it
    head = process("head", SUBJECTS["head"])
    meta = {}
    for name in ("soldier", "hater", "muscule"):
        meta[name] = process(name, SUBJECTS[name], head if name == "soldier" else None)[1]
    paper_tile().save(OUT / "paper.png")

    # A script rather than JSON so the game still runs when opened straight off
    # disk - Chrome refuses fetch() on file:// URLs, but <script> is fine.
    (OUT / "sprite.js").write_text(
        "// generated by tools/extract_sprites.py - do not edit\n"
        f"window.SPRITE_META = {json.dumps(meta, indent=2)};\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
