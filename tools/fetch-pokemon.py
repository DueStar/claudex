"""Download Gen 1-5 (#1-649) Black/White sprites + Pokédex data once, into the project.

Usage:  python -I tools/fetch-pokemon.py <project-root> [last-id]

Writes
  public/sprites/pokemon/anim/{id}.gif    animated front (BW)
  public/sprites/pokemon/shiny/{id}.gif   animated front, shiny
  public/sprites/pokemon/static/{id}.png  still front (avatars, the Pokédex grid)
  src/pokemon/pokedex.json                everything the pages show (names, genus, flavor, types, size, tier)
  server/pokemon-data.json                what the server's encounter rolls need (id, name, types, tier, capture rate, evolution)

Black/White sprites exist up to #649 (Genesect); Gen 6+ has no sprite in this style.
Re-running skips sprite files that already exist.
"""
import io
import json
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageSequence

ROOT = Path(sys.argv[1]).resolve()
LAST = int(sys.argv[2]) if len(sys.argv) > 2 else 649
OUT = ROOT / "public" / "sprites" / "pokemon"
DEX = ROOT / "src" / "pokemon" / "pokedex.json"
SERVER_DEX = ROOT / "server" / "pokemon-data.json"
UA = {"User-Agent": "pokemon-office-asset-fetch/1.0"}
BW = "https://img.pokemondb.net/sprites/black-white"

# Box-art legendaries; every other is_legendary species is a sub-legendary (준전설)
BOX_LEGENDS = {150, 249, 250, 382, 383, 384, 483, 484, 487, 643, 644, 646}


def get(url: str, tries: int = 5) -> bytes:
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return r.read()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(url)


def fetch_to(url: str, path: Path) -> bytes:
    if path.exists() and path.stat().st_size > 0:
        return path.read_bytes()
    data = get(url)
    path.write_bytes(data)
    return data


def gif_size(data: bytes):
    im = Image.open(io.BytesIO(data))
    w, h = im.size
    return w, h


def latest_ko(entries, key):
    ko = [e for e in entries if e["language"]["name"] == "ko"]
    return ko[-1][key] if ko else None


def tier_of(dex_id, sp):
    if sp["is_mythical"]:
        return "mythical"
    if sp["is_legendary"]:
        return "legendary" if dex_id in BOX_LEGENDS else "sub"
    return "rare" if (sp.get("capture_rate") or 255) <= 45 else "common"


def one(dex_id: int) -> dict:
    sp = json.loads(get(f"https://pokeapi.co/api/v2/pokemon-species/{dex_id}/"))
    pk = json.loads(get(f"https://pokeapi.co/api/v2/pokemon/{dex_id}/"))
    slug = sp["name"]
    names = {n["language"]["name"]: n["name"] for n in sp["names"]}
    anim = fetch_to(f"{BW}/anim/normal/{slug}.gif", OUT / "anim" / f"{dex_id}.gif")
    fetch_to(f"{BW}/anim/shiny/{slug}.gif", OUT / "shiny" / f"{dex_id}.gif")
    fetch_to(f"{BW}/normal/{slug}.png", OUT / "static" / f"{dex_id}.png")
    w, h = gif_size(anim)
    evo_from = sp.get("evolves_from_species")
    flavor = latest_ko(sp.get("flavor_text_entries", []), "flavor_text")
    return {
        "id": dex_id,
        "slug": slug,
        "ko": names.get("ko", slug),
        "en": names.get("en", slug),
        "genus": latest_ko(sp.get("genera", []), "genus") or "",
        "flavor": " ".join((flavor or "").split()),
        "types": [t["type"]["name"] for t in pk["types"]],
        "heightDm": pk.get("height"),
        "weightHg": pk.get("weight"),
        "gen": int(sp["generation"]["url"].rstrip("/").split("/")[-1]),
        "tier": tier_of(dex_id, sp),
        "captureRate": sp.get("capture_rate"),
        "evolvesFrom": int(evo_from["url"].rstrip("/").split("/")[-1]) if evo_from else None,
        # Animated GIF canvas in source pixels (the map is 640 px wide)
        "w": w, "h": h, "bbox": [0, 0, w, h],
    }


def main():
    for d in ("anim", "shiny", "static"):
        (OUT / d).mkdir(parents=True, exist_ok=True)
    DEX.parent.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=8) as ex:
        rows = list(ex.map(one, range(1, LAST + 1)))
    DEX.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    server_rows = [{k: r[k] for k in ("id", "ko", "types", "tier", "captureRate", "evolvesFrom", "gen")} for r in rows]
    SERVER_DEX.write_text(json.dumps(server_rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tiers = {}
    for r in rows:
        tiers[r["tier"]] = tiers.get(r["tier"], 0) + 1
    print(f"ok: {len(rows)} pokemon; tiers {tiers}")


if __name__ == "__main__":
    main()
