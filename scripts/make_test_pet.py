#!/usr/bin/env python3
"""Generate a license-safe minimal Codex-compatible pet package for tests/dev.

Creates <out>/<pet-id>/pet.json + spritesheet.webp (1536x1872, 8x9 grid of
192x208 cells). Each row is a distinct flat color with a simple per-frame
shift so animation is visible. No real Codex artwork is used.
"""
import json
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("Pillow required: pip install pillow")

COLS, ROWS = 8, 9
CELL_W, CELL_H = 192, 208
# Per-row base colors (idle, runR, runL, wave, jump, failed, waiting, running, review)
COLORS = [
    (90, 160, 255), (80, 200, 120), (80, 200, 120), (255, 200, 80),
    (255, 160, 80), (255, 90, 90), (160, 140, 255), (120, 200, 255),
    (200, 160, 255),
]
FRAME_HINTS = [6, 8, 8, 4, 5, 8, 6, 6, 6]


def make_sheet(path: Path) -> None:
    img = Image.new("RGBA", (COLS * CELL_W, ROWS * CELL_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for row in range(ROWS):
        for col in range(FRAME_HINTS[row]):
            x0, y0 = col * CELL_W, row * CELL_H
            # bounce: shift the body up/down per frame so animation reads
            dy = int(10 * ((col % 3) - 1))
            pad = 30
            color = COLORS[row]
            d.ellipse(
                [x0 + pad, y0 + pad + dy, x0 + CELL_W - pad, y0 + CELL_H - pad + dy],
                fill=color + (255,),
            )
            # eyes
            ex = x0 + CELL_W // 2
            ey = y0 + CELL_H // 2 - 20 + dy
            for dx in (-25, 25):
                d.ellipse([ex + dx - 10, ey - 10, ex + dx + 10, ey + 10], fill=(20, 20, 30, 255))
    img.save(path, "WEBP")


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "test-pet")
    pet_id = sys.argv[2] if len(sys.argv) > 2 else "test-pet"
    pkg = out / pet_id
    pkg.mkdir(parents=True, exist_ok=True)
    make_sheet(pkg / "spritesheet.webp")
    (pkg / "pet.json").write_text(
        json.dumps(
            {
                "id": pet_id,
                "displayName": "Test Pet",
                "description": "License-safe generated fixture for pi-web pet runtime tests.",
                "spritesheetPath": "spritesheet.webp",
            },
            indent=2,
        )
        + "\n"
    )
    print(f"wrote {pkg}")


if __name__ == "__main__":
    main()
