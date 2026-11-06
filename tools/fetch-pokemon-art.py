"""Download the Pokémon HOME artwork for #1-1025 (normal + shiny), one consistent modern style.

Usage:  python -I tools/fetch-pokemon-art.py <project-root>

Source: img.pokemondb.net/sprites/home/{normal,shiny}/<slug>.png, with each
species' slug read from pokemondb.net/pokedex/all (its first, default form).
Each image is trimmed to its opaque pixels and scaled to fit 128x128:
  public/sprites/pokemon/art/{id}.png
  public/sprites/pokemon/art-shiny/{id}.png
Re-running skips files that already exist.
"""
import io
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(sys.argv[1]).resolve()
OUT = ROOT / "public" / "sprites" / "pokemon"
UA = {"User-Agent": "Mozilla/5.0 (pokemon-office asset fetch)"}
SIZE = 128


def get(url: str, tries: int = 5) -> bytes:
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            time.sleep(1.5 * (i + 1))
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(url)


def slugs() -> dict:
    html = get("https://pokemondb.net/pokedex/all").decode("utf-8", "replace")
    out = {}
    # each row: <span class="infocard-cell-data">0001</span> ... <a class="ent-name" href="/pokedex/bulbasaur">
    for m in re.finditer(r'infocard-cell-data">(\d{4})</span>.*?href="/pokedex/([a-z0-9-]+)"', html, re.S):
        n = int(m.group(1))
        out.setdefault(n, m.group(2))
    return out


def fit(data: bytes) -> Image.Image:
    im = Image.open(io.BytesIO(data)).convert("RGBA")
    box = im.getchannel("A").getbbox() or (0, 0, im.width, im.height)
    im = im.crop(box)
    scale = SIZE / max(im.width, im.height)
    if scale < 1:
        im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    return im


def one(item):
    n, slug = item
    for kind, folder in (("normal", "art"), ("shiny", "art-shiny")):
        dest = OUT / folder / f"{n}.png"
        if dest.exists() and dest.stat().st_size > 0:
            continue
        fit(get(f"https://img.pokemondb.net/sprites/home/{kind}/{slug}.png")).save(dest, optimize=True)
    return n


def main():
    for d in ("art", "art-shiny"):
        (OUT / d).mkdir(parents=True, exist_ok=True)
    table = slugs()
    missing = [n for n in range(1, 1026) if n not in table]
    if missing:
        print("no slug for", missing[:20])
    failed = []

    def safe(item):
        try:
            return one(item)
        except Exception as e:
            failed.append((item, str(e)))
            return None

    with ThreadPoolExecutor(max_workers=8) as ex:
        done = [x for x in ex.map(safe, sorted((n, s) for n, s in table.items() if n <= 1025)) if x]
    print(f"ok: {len(done)} species; failed {len(failed)}", failed[:10])


if __name__ == "__main__":
    main()
