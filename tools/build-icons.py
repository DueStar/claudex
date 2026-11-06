"""Draw Claudex's Poke Ball (an original drawing, smooth and shaded) at every
size the app uses: the app/installer icon, the tray, and the in-app ball
(public/sprites/claudex-ball.png, used by New session and the header).

Usage:  python -I tools/build-icons.py <project-root>

Drawn at 4x and scaled down, so the edges are smooth at every size.
"""
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(sys.argv[1]).resolve()

INK = (28, 26, 34, 255)
TOP = (238, 92, 56, 255)       # warm red-orange
TOP_DARK = (196, 58, 40, 255)
BOTTOM = (236, 232, 246, 255)  # cool white
BOTTOM_DARK = (196, 190, 218, 255)
WHITE = (255, 255, 255, 255)


def shaded_disc(size, light, dark, center):
    """A disc whose colour runs from `light` (at `center`) to `dark` at the far rim."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    px = img.load()
    cx, cy = center
    r = size / 2
    far = math.hypot(size, size)
    for y in range(size):
        for x in range(size):
            if (x - r + 0.5) ** 2 + (y - r + 0.5) ** 2 <= r * r:
                t = min(1.0, math.hypot(x - cx, y - cy) / (far * 0.62))
                t = t ** 1.6
                px[x, y] = tuple(round(light[i] + (dark[i] - light[i]) * t) for i in range(3)) + (255,)
    return img


def draw_ball(n):
    s = n * 4                 # supersample
    pad = s * 0.04
    d = s - 2 * pad           # ball diameter
    ink = d * 0.055           # outline width
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))

    # Halves, shaded from the upper left
    body = int(d - 2 * ink)
    off = int(pad + ink)
    top = shaded_disc(body, TOP, TOP_DARK, (body * 0.3, body * 0.25))
    bottom = shaded_disc(body, BOTTOM, BOTTOM_DARK, (body * 0.3, body * 0.4))
    half = Image.new('L', (body, body), 0)
    ImageDraw.Draw(half).rectangle([0, 0, body, body / 2], fill=255)
    ball = Image.composite(top, bottom, half)
    img.alpha_composite(ball, (off, off))

    dr = ImageDraw.Draw(img)
    c = s / 2
    # Outline
    dr.ellipse([pad, pad, s - pad, s - pad], outline=INK, width=int(ink))
    # Band
    band = d * 0.085
    dr.rectangle([pad + ink * 0.5, c - band / 2, s - pad - ink * 0.5, c + band / 2], fill=INK)
    # Button: ink ring, white ring, ink ring, white face
    for rad, col in ((d * 0.19, INK), (d * 0.145, WHITE), (d * 0.105, INK), (d * 0.08, WHITE)):
        dr.ellipse([c - rad, c - rad, c + rad, c + rad], fill=col)
    # Highlight on the top half
    hl = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hx, hy, hr = pad + d * 0.3, pad + d * 0.24, d * 0.09
    hd.ellipse([hx - hr * 1.15, hy - hr, hx + hr * 1.15, hy + hr], fill=(255, 255, 255, 235))
    hl = hl.filter(ImageFilter.GaussianBlur(s * 0.004))
    img.alpha_composite(hl)
    # Re-trace the outline over everything for a crisp rim
    dr = ImageDraw.Draw(img)
    dr.ellipse([pad, pad, s - pad, s - pad], outline=INK, width=int(ink))
    return img.resize((n, n), Image.LANCZOS)


big = draw_ball(512)
big.save(ROOT / 'build' / 'icon.png')
big.save(ROOT / 'electron' / 'assets' / 'icon.png')
draw_ball(16).save(ROOT / 'electron' / 'assets' / 'tray-16.png')
draw_ball(32).save(ROOT / 'electron' / 'assets' / 'tray-32.png')
draw_ball(48).save(ROOT / 'electron' / 'assets' / 'tray-48.png')
draw_ball(128).save(ROOT / 'public' / 'sprites' / 'claudex-ball.png')
print('ok')
