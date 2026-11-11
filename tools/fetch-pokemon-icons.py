"""Write server/pokemon-icons.json: which Scarlet/Violet box icon each species uses.

Usage:  python -I tools/fetch-pokemon-icons.py <project-root>

The small left-facing icons on pokemondb.net/pokedex/all are the games' box
icons, at img.pokemondb.net/sprites/scarlet-violet/icon/<slug>.png. The app
draws a session (the panel beside the terminal and the tabs above it) with
them; the Pokédex and the Box keep the Pokémon HOME artwork.

Only the slug of each species' first row (its default form) is kept, never a
picture: server/sprites.js fetches the icon on first use and keeps it on the
user's PC, like the HOME artwork.
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
PAGE = "https://pokemondb.net/pokedex/all"
UA = {"User-Agent": "Mozilla/5.0 (spawn icon list)"}

html = urllib.request.urlopen(urllib.request.Request(PAGE, headers=UA), timeout=60).read().decode("utf-8")
slugs: dict[int, str] = {}
for row in html.split("<tr")[1:]:
    num = re.search(r'cell-num[^>]*data-sort-value="(\d+)"', row)
    icon = re.search(r"sprites/scarlet-violet/icon/([a-z0-9-]+)\.png", row)
    if num and icon:
        slugs.setdefault(int(num.group(1)), icon.group(1))

dex = json.loads((ROOT / "src" / "pokemon" / "pokedex.json").read_text(encoding="utf-8"))
missing = [p["id"] for p in dex if p["id"] not in slugs]
if missing:
    sys.exit(f"no icon on the page for: {missing}")

out = {
    "_about": "Scarlet/Violet box icon slug per species (img.pokemondb.net/sprites/scarlet-violet/icon/<slug>.png), "
              "from pokemondb.net/pokedex/all; written by tools/fetch-pokemon-icons.py. server/sprites.js fetches the icon on first use.",
    "slugs": {str(p["id"]): slugs[p["id"]] for p in dex},
}
path = ROOT / "server" / "pokemon-icons.json"
path.write_text(json.dumps(out, ensure_ascii=False, indent=0) + "\n", encoding="utf-8", newline="\n")
print(f"{len(out['slugs'])} icons -> {path}")
