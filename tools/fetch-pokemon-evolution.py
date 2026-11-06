"""Add the games' evolution levels (via PokeAPI evolution chains) to the server's Pokédex data.

Usage:  python -I tools/fetch-pokemon-evolution.py <project-root>

For every species that evolves from another, writes into server/pokemon-data.json:
  evolveLevel  the level it evolves at. A level-up evolution with a minimum level
               uses that level (Charmander -> Charmeleon 16). Evolutions by stone,
               trade, friendship, move, place or time have no level in the games;
               they get one from the evolution's stage: 30 for a first evolution,
               40 for a second (a level-up with a level wins when there are both).
  evolveHow    'level' or what the games use instead ('use-item', 'trade', ...)
"""
import json
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
UA = {"User-Agent": "Mozilla/5.0 (claudex data fetch)"}
FALLBACK = {1: 30, 2: 40}


def get(url, tries=5):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.loads(r.read())
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))


def chain_url(dex_id):
    return get(f"https://pokeapi.co/api/v2/pokemon-species/{dex_id}/")["evolution_chain"]["url"]


def species_id(url):
    return int(url.rstrip("/").split("/")[-1])


def walk(node, stage, out):
    for nxt in node["evolves_to"]:
        sid = species_id(nxt["species"]["url"])
        details = nxt["evolution_details"] or []
        levels = [d["min_level"] for d in details if d.get("trigger", {}).get("name") == "level-up" and d.get("min_level")]
        if levels:
            out[sid] = (min(levels), "level")
        else:
            how = details[0]["trigger"]["name"] if details else "other"
            out[sid] = (FALLBACK.get(stage + 1, 40), how)
        walk(nxt, stage + 1, out)


def main():
    with ThreadPoolExecutor(max_workers=8) as ex:
        urls = sorted(set(ex.map(chain_url, range(1, 1026))))
        chains = list(ex.map(get, urls))
    found = {}
    for c in chains:
        walk(c["chain"], 0, found)
    p = ROOT / "server" / "pokemon-data.json"
    data = json.loads(p.read_text(encoding="utf-8"))
    n = 0
    for r in data:
        if r["id"] in found:
            r["evolveLevel"], r["evolveHow"] = found[r["id"]]
            n += 1
        else:
            r.pop("evolveLevel", None)
            r.pop("evolveHow", None)
    p.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    by_level = sum(1 for v in found.values() if v[1] == "level")
    print(f"ok: {len(chains)} chains, {n} evolutions ({by_level} by level, {n - by_level} by other means)")


if __name__ == "__main__":
    main()
