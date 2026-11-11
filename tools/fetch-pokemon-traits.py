"""Add individual-trait data from the games (via PokeAPI) to the Pokédex.

Usage:  python -I tools/fetch-pokemon-traits.py <project-root>

  gender rate  pokemon-species/{id}.gender_rate: -1 genderless, else the chance
               of female in eighths (0 = always male, 8 = always female)
  natures      the 25 natures: Korean name, the stat raised and the stat lowered
               (the five "neutral" natures raise and lower nothing)

Writes genderRate into src/pokemon/pokedex.json and server/pokemon-data.json,
and the natures to server/natures.json (the app imports it from there too).
"""
import json
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
UA = {"User-Agent": "Mozilla/5.0 (spawn data fetch)"}
STAT_KO = {"attack": "공격", "defense": "방어", "special-attack": "특수공격", "special-defense": "특수방어", "speed": "스피드"}


def get(url: str, tries: int = 5):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.loads(r.read())
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))


def gender_rate(dex_id):
    return dex_id, get(f"https://pokeapi.co/api/v2/pokemon-species/{dex_id}/")["gender_rate"]


def nature(entry):
    n = get(entry["url"])
    names = {x["language"]["name"]: x["name"] for x in n["names"]}
    up = n["increased_stat"]["name"] if n["increased_stat"] else None
    down = n["decreased_stat"]["name"] if n["decreased_stat"] else None
    return {"id": n["id"], "en": names.get("en", n["name"]), "ko": names.get("ko", n["name"]),
            "up": STAT_KO.get(up), "down": STAT_KO.get(down)}


def main():
    with ThreadPoolExecutor(max_workers=8) as ex:
        rates = dict(ex.map(gender_rate, range(1, 1026)))
        natures = sorted(ex.map(nature, get("https://pokeapi.co/api/v2/nature?limit=100")["results"]), key=lambda n: n["id"])
    for rel in ("src/pokemon/pokedex.json", "server/pokemon-data.json"):
        p = ROOT / rel
        rows = json.loads(p.read_text(encoding="utf-8"))
        for r in rows:
            r["genderRate"] = rates[r["id"]]
        p.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for rel in ("server/natures.json",):
        (ROOT / rel).write_text(json.dumps(natures, ensure_ascii=False, indent=1), encoding="utf-8")
    genderless = sum(1 for v in rates.values() if v == -1)
    print(f"ok: {len(rates)} gender rates ({genderless} genderless), {len(natures)} natures")


if __name__ == "__main__":
    main()
