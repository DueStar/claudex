"""Draw the app's Poké Ball icon (pixel art) at every size the app and installer use.

Usage:  python -I tools/build-icons.py <project-root>
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(sys.argv[1]).resolve()

INK = (34, 32, 52, 255)
RED = (230, 57, 70, 255)
RED_L = (255, 120, 120, 255)
WHITE = (250, 250, 250, 255)
GREY = (200, 204, 214, 255)
CLEAR = (0, 0, 0, 0)


def ball(n=32):
    """An n x n pixel Poké Ball (n even)."""
    img = Image.new('RGBA', (n, n), CLEAR)
    px = img.load()
    c = (n - 1) / 2
    r = n / 2 - 0.5
    band = max(1, n // 16)
    btn_r = n * 0.17
    for y in range(n):
        for x in range(n):
            dx, dy = x - c, y - c
            d = (dx * dx + dy * dy) ** 0.5
            if d > r:
                continue
            if d > r - max(1, n / 16):
                px[x, y] = INK
            elif abs(dy) <= band / 2 + 0.5 and d > btn_r:
                px[x, y] = INK
            elif d <= btn_r:
                px[x, y] = INK if d > btn_r - max(1, n / 16) else (WHITE if d < btn_r * 0.55 else GREY)
            elif dy < 0:
                # highlight on the red half
                px[x, y] = RED_L if (dx < -r * 0.3 and dy < -r * 0.35 and d < r * 0.8) else RED
            else:
                px[x, y] = WHITE if dy < r * 0.55 else GREY
    return img


def scaled(base, size):
    return base.resize((size, size), Image.NEAREST)


base32 = ball(32)
base16 = ball(16)
icon = scaled(base32, 512)
icon.save(ROOT / 'build' / 'icon.png')
icon.save(ROOT / 'electron' / 'assets' / 'icon.png')
base16.save(ROOT / 'electron' / 'assets' / 'tray-16.png')
base32.save(ROOT / 'electron' / 'assets' / 'tray-32.png')
scaled(ball(48), 48).save(ROOT / 'electron' / 'assets' / 'tray-48.png')
print('icons written')
