"""Add base Speed and weight (from the games, via PokeAPI) to the server's Pokédex data.

Usage:  python -I tools/fetch-pokemon-stats.py <project-root>

  speed     pokemon/{id}.stats[speed].base_stat   (Fast Ball: 100 or more)
  weightKg  pokemon/{id}.weight / 10               (Heavy Ball: 100 / 200 / 300 kg)

Writes speed and weightKg into server/pokemon-data.json.
"""
import json
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
UA = {"User-Agent": "Mozilla/5.0 (spawn data fetch)"}


def get(url, tries=5):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.loads(r.read())
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))


def stats(dex_id):
    p = get(f"https://pokeapi.co/api/v2/pokemon/{dex_id}/")
    speed = next(s["base_stat"] for s in p["stats"] if s["stat"]["name"] == "speed")
    return dex_id, speed, p["weight"] / 10


def main():
    with ThreadPoolExecutor(max_workers=8) as ex:
        rows = {i: (s, w) for i, s, w in ex.map(stats, range(1, 1026))}
    p = ROOT / "server" / "pokemon-data.json"
    data = json.loads(p.read_text(encoding="utf-8"))
    for r in data:
        r["speed"], r["weightKg"] = rows[r["id"]]
    p.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    fast = sum(1 for s, _ in rows.values() if s >= 100)
    heavy = sum(1 for _, w in rows.values() if w >= 200)
    print(f"ok: {len(rows)} species, speed>=100: {fast}, weight>=200kg: {heavy}")


if __name__ == "__main__":
    main()
