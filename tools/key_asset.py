"""
Cut a drawing off its page, the same way the sprite pipeline does.

    python tools/key_asset.py <in> <out.png> [--floor F] [--gain G] [--pad P]

The pencil is treated as dark ink laid over paper, so
`alpha = (paper - luma) / (paper - ink)`; compositing the result back over a
light background reproduces the original stroke weight instead of leaving a
white box. Anything already carrying an alpha channel keeps it - the key is
multiplied in, which is what a Figma export with a white backing plate needs.

--floor lifts the gate: raise it when a light backing plate survives, lower it
when faint pencil (hair, thin linework) disappears.
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

INK = 42.0


def key(path: Path, floor: float, gain: float, pad: int) -> Image.Image:
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).astype(np.float32)
    rgb, oa = a[..., :3], a[..., 3] / 255.0
    lum = rgb.mean(2)

    # A background remover that failed leaves a flat semi-transparent haze
    # rather than a cut-out. An alpha channel with almost nothing fully clear
    # carries no shape information, so multiplying it in would just dim the
    # whole sprite - drop it and key from the pixels instead.
    if (oa < 0.02).mean() < 0.01:
        print(f"alpha channel carries no cut-out ({(oa < 0.02).mean() * 100:.1f}%"
              f" clear) - keying from the page instead")
        oa = np.ones_like(oa)

    # measure the page from the part that is actually opaque, so a transparent
    # export does not drag the estimate to black
    inside = oa > 0.5
    if not inside.any():
        inside = np.ones_like(oa, dtype=bool)
    paper = float(np.percentile(lum[inside], 92))

    ink = np.clip((paper - lum) / (paper - INK), 0.0, 1.0)
    ink = np.clip((ink - floor) / (gain - floor), 0.0, 1.0)
    alpha = ink * oa

    rows = np.where(alpha.max(1) > 0.12)[0]
    cols = np.where(alpha.max(0) > 0.12)[0]
    if not len(rows) or not len(cols):
        raise SystemExit("nothing survived the key - try a lower --floor")
    y0, y1 = max(0, rows[0] - pad), min(alpha.shape[0], rows[-1] + 1 + pad)
    x0, x1 = max(0, cols[0] - pad), min(alpha.shape[1], cols[-1] + 1 + pad)

    out = np.zeros((y1 - y0, x1 - x0, 4), np.uint8)
    out[..., :3] = np.clip(rgb[y0:y1, x0:x1], 0, 255).astype(np.uint8)
    out[..., 3] = (alpha[y0:y1, x0:x1] * 255).astype(np.uint8)
    print(f"paper={paper:.0f}  {x1 - x0}x{y1 - y0}  mean alpha {out[..., 3].mean():.1f}")
    return Image.fromarray(out, "RGBA")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("src")
    p.add_argument("dst")
    p.add_argument("--floor", type=float, default=0.14)
    p.add_argument("--gain", type=float, default=0.72)
    p.add_argument("--pad", type=int, default=2)
    args = p.parse_args()
    key(Path(args.src), args.floor, args.gain, args.pad).save(args.dst)
    print(f"wrote {args.dst}")


if __name__ == "__main__":
    main()
