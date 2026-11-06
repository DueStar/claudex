"""Add #650-1025 (Gen 6-9) to the Pokédex, in Black/White style.

Usage:  python -I tools/fetch-pokemon-gen6plus.py <project-root>

There is no official Black/White sprite past #649, so these come from the
Pokémon Showdown / Smogon sprite project's fan-made Gen 5-style sprites
(play.pokemonshowdown.com/sprites/gen5, gen5-shiny). They are still images:
  public/sprites/pokemon/anim/{id}.png    trimmed to the opaque pixels (map, widget)
  public/sprites/pokemon/shiny/{id}.png   trimmed, shiny
  public/sprites/pokemon/static/{id}.png  96x96 as published (avatars, Pokédex grid)
and appends the species to src/pokemon/pokedex.json and server/pokemon-data.json
(run tools/fetch-pokemon.py first for #1-649).
"""
import io
import json
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(sys.argv[1]).resolve()
FIRST, LAST = 650, 1025
OUT = ROOT / "public" / "sprites" / "pokemon"
DEX = ROOT / "src" / "pokemon" / "pokedex.json"
SERVER_DEX = ROOT / "server" / "pokemon-data.json"
UA = {"User-Agent": "Mozilla/5.0 (pokemon-office asset fetch)"}
SD = "https://play.pokemonshowdown.com/sprites"
BOX_LEGENDS = {716, 717, 718, 791, 792, 800, 888, 889, 890, 898, 1007, 1008, 1024}


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


def sd_id(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def sprite(kind: str, names) -> bytes:
    last = None
    for n in names:
        try:
            return get(f"{SD}/{kind}/{sd_id(n)}.png")
        except Exception as e:
            last = e
    raise RuntimeError(f"no {kind} sprite for {names}: {last}")


def trim(data: bytes) -> Image.Image:
    im = Image.open(io.BytesIO(data)).convert("RGBA")
    box = im.getchannel("A").getbbox() or (0, 0, im.width, im.height)
    return im.crop(box)


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
    default = next((v["pokemon"]["name"] for v in sp["varieties"] if v["is_default"]), sp["name"])
    pk = json.loads(get(f"https://pokeapi.co/api/v2/pokemon/{default}/"))
    names = {n["language"]["name"]: n["name"] for n in sp["names"]}
    tries = [sp["name"], default, names.get("en", sp["name"])]
    normal = sprite("gen5", tries)
    shiny = sprite("gen5-shiny", tries)
    (OUT / "static" / f"{dex_id}.png").write_bytes(normal)
    t = trim(normal)
    t.save(OUT / "anim" / f"{dex_id}.png")
    trim(shiny).save(OUT / "shiny" / f"{dex_id}.png")
    evo_from = sp.get("evolves_from_species")
    flavor = latest_ko(sp.get("flavor_text_entries", []), "flavor_text")
    return {
        "id": dex_id,
        "slug": sp["name"],
        "ko": names.get("ko", sp["name"]),
        "en": names.get("en", sp["name"]),
        "genus": latest_ko(sp.get("genera", []), "genus") or "",
        "flavor": " ".join((flavor or "").split()),
        "types": [x["type"]["name"] for x in pk["types"]],
        "heightDm": pk.get("height"),
        "weightHg": pk.get("weight"),
        "gen": int(sp["generation"]["url"].rstrip("/").split("/")[-1]),
        "tier": tier_of(dex_id, sp),
        "captureRate": sp.get("capture_rate"),
        "evolvesFrom": int(evo_from["url"].rstrip("/").split("/")[-1]) if evo_from else None,
        # A still sprite (fan-made Gen 5 style): w/h of the trimmed image
        "w": t.width, "h": t.height, "bbox": [0, 0, t.width, t.height], "still": True,
    }


def main():
    rows = json.loads(DEX.read_text(encoding="utf-8"))
    rows = [r for r in rows if r["id"] < FIRST]
    with ThreadPoolExecutor(max_workers=8) as ex:
        new = list(ex.map(one, range(FIRST, LAST + 1)))
    rows += new
    DEX.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    server_rows = [{k: r[k] for k in ("id", "ko", "types", "tier", "captureRate", "evolvesFrom", "gen")} for r in rows]
    SERVER_DEX.write_text(json.dumps(server_rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tiers = {}
    for r in new:
        tiers[r["tier"]] = tiers.get(r["tier"], 0) + 1
    print(f"ok: +{len(new)} (#{FIRST}-{LAST}), total {len(rows)}; new tiers {tiers}")


if __name__ == "__main__":
    main()
