"""Compose the 2D top-down Pokémon map (day + night) and its layout data.

Usage:  python -I tools/build-map.py <project-root>

Inputs
  tools/assets/tilemap.png   CC0 tileset by RedVoxel (opengameart.org/content/pokemon-inspired-16x16-tiles)
Outputs
  public/rooms/pokemon-day.png, public/rooms/pokemon-night.png   640x480 map
  public/sprites/map/desk.png, desk-night.png                       desk overlay (drawn over feet)
  src/pokemon/map.generated.json                                    spots, waypoints, anchors (in %)

Everything is in map pixels (640x480); the JSON converts to % of the map.
"""
import json
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(sys.argv[1]).resolve()
TILES = Image.open(ROOT / "tools" / "assets" / "tilemap.png").convert("RGBA")
W, H, T = 640, 480, 16
rng = random.Random(151)

INK = (34, 32, 52, 255)
WOOD_D, WOOD, WOOD_L = (102, 57, 49, 255), (143, 86, 59, 255), (217, 160, 102, 255)
STONE_D, STONE, STONE_L = (89, 86, 82, 255), (132, 126, 135, 255), (155, 173, 183, 255)
WHITE = (255, 255, 255, 255)
RED, RED_D = (217, 87, 99, 255), (172, 50, 50, 255)
BLUE_D, BLUE, BLUE_L = (48, 96, 130, 255), (91, 110, 225, 255), (99, 155, 255, 255)
WATER_D, WATER, WATER_L = (48, 96, 130, 255), (95, 205, 228, 255), (203, 219, 252, 255)
GREEN_D, GREEN = (75, 105, 47, 255), (106, 190, 48, 255)
YELLOW = (251, 242, 54, 255)
PAPER = (238, 232, 213, 255)


def tile(tx, ty, w=1, h=1):
    return TILES.crop((tx * T, ty * T, (tx + w) * T, (ty + h) * T))


def crop(x0, y0, x1, y1):
    return TILES.crop((x0, y0, x1, y1))


# ---------------------------------------------------------------- ground ----
img = Image.new("RGBA", (W, H))
GRASS = [tile(8, 0), tile(9, 0)]
for ty in range(H // T):
    for tx in range(W // T):
        img.alpha_composite(GRASS[rng.random() < 0.35], (tx * T, ty * T))

# Dual-grid dirt path: corners are cells; each drawn tile picks its art from the
# 4 corners it touches (bit TL=8 TR=4 BL=2 BR=1).
CW, CH = W // T + 1, H // T + 1
corner = [[False] * CW for _ in range(CH)]


def dirt(cx0, cy0, cx1, cy1):
    for cy in range(cy0, cy1 + 1):
        for cx in range(cx0, cx1 + 1):
            corner[cy][cx] = True


PATH_SRC = {
    1: (8, 1), 2: (10, 1), 3: (9, 1), 4: (8, 3), 5: (8, 2), 8: (10, 3), 10: (10, 2),
    12: (9, 3), 15: (9, 2), 7: (11, 0), 11: (12, 0), 13: (11, 1), 14: (12, 1),
    6: (9, 2), 9: (9, 2),
}

# plaza + path from the lab door
dirt(6, 12, 34, 24)
dirt(20, 7, 21, 12)
# front yard strip under the lab
dirt(15, 7, 26, 8)

for ty in range(H // T):
    for tx in range(W // T):
        m = (corner[ty][tx] << 3) | (corner[ty][tx + 1] << 2) | (corner[ty + 1][tx] << 1) | corner[ty + 1][tx + 1]
        if m:
            img.alpha_composite(tile(*PATH_SRC[m]), (tx * T, ty * T))

# ------------------------------------------------------------ obstacles ----
blocked = []  # rects in map px, for the sanity check


def put(sprite, x, y, block=None):
    img.alpha_composite(sprite, (x, y))
    if block:
        blocked.append(block)


HOUSE = crop(0, 0, 80, 96)
TREE = crop(80, 48, 128, 96)
MAILBOX = crop(128, 64, 144, 96)
HEDGE = crop(0, 96, 48, 144)


def hedge(x, y, wt, ht):
    """9-slice the 3x3 hedge to wt x ht tiles."""
    for j in range(ht):
        for i in range(wt):
            sx = 0 if i == 0 else 2 if i == wt - 1 else 1
            sy = 0 if j == 0 else 2 if j == ht - 1 else 1
            img.alpha_composite(HEDGE.crop((sx * T, sy * T, sx * T + T, sy * T + T)), (x + i * T, y + j * T))


def tall_grass(x, y, wt, ht):
    """Pokémon tall grass: dark tufts on grass."""
    d = ImageDraw.Draw(img)
    for j in range(ht * 2):
        for i in range(wt * 2):
            bx, by = x + i * 8, y + j * 8
            d.polygon([(bx, by + 7), (bx + 2, by + 1), (bx + 3, by + 7)], fill=GREEN_D)
            d.polygon([(bx + 3, by + 7), (bx + 5, by), (bx + 7, by + 7)], fill=(55, 148, 110, 255))
            d.line([(bx, by + 7), (bx + 7, by + 7)], fill=GREEN_D)


# border trees (back row first so lower ones overlap)
for x in range(-16, W, 40):
    put(TREE, x, -22)
for y in range(18, 200, 38):
    put(TREE, -18, y)
    put(TREE, W - 30, y)
hedge(0, 432, 9, 3)
hedge(W - 9 * T, 432, 9, 3)
tall_grass(9 * T + 8, 440, 8, 2)
tall_grass(W - 17 * T - 8, 440, 8, 2)

# the lab (Claude's house) — door centre at x=336
LAB_X, LAB_Y = 296, 14
put(HOUSE, LAB_X, LAB_Y, (LAB_X, LAB_Y, LAB_X + 80, LAB_Y + 94))
DOOR = (LAB_X + 56, LAB_Y + 94)

# mailbox = filing cabinet stand-in
put(MAILBOX, 236, 92, (236, 100, 252, 124))


def draw_sprite(fn, w, h):
    s = Image.new("RGBA", (w, h))
    fn(ImageDraw.Draw(s))
    return s


def berry_tree():
    s = TREE.copy()
    d = ImageDraw.Draw(s)
    for (bx, by) in [(14, 12), (28, 9), (20, 22), (33, 20), (11, 27), (26, 31), (37, 30)]:
        d.rectangle([bx, by, bx + 2, by + 2], fill=BLUE)
        d.point((bx, by), fill=BLUE_L)
        d.point((bx + 2, by + 2), fill=BLUE_D)
    return s


put(berry_tree(), 30, 178, (40, 200, 70, 226))
put(berry_tree(), 44, 300, (54, 322, 84, 348))


def pond(d):
    d.ellipse([0, 0, 83, 55], fill=INK)
    d.ellipse([2, 2, 81, 53], fill=STONE)
    d.ellipse([5, 5, 78, 50], fill=STONE_D)
    d.ellipse([7, 7, 76, 48], fill=WATER_D)
    d.ellipse([9, 10, 74, 48], fill=WATER)
    for (x, y, l) in [(20, 18, 8), (46, 28, 10), (30, 36, 6), (58, 18, 5)]:
        d.line([(x, y), (x + l, y)], fill=WATER_L)
    d.ellipse([52, 32, 62, 38], fill=GREEN)  # lily pad
    d.point((57, 32), fill=(215, 123, 186, 255))


put(draw_sprite(pond, 84, 56), 548, 214, (548, 214, 632, 270))


def board(d):
    # posts
    d.rectangle([6, 34, 9, 56], fill=INK)
    d.rectangle([7, 34, 8, 55], fill=WOOD_D)
    d.rectangle([74, 34, 77, 56], fill=INK)
    d.rectangle([75, 34, 76, 55], fill=WOOD_D)
    # frame + paper
    d.rectangle([0, 0, 83, 46], fill=INK)
    d.rectangle([1, 1, 82, 45], fill=WOOD)
    d.line([(1, 1), (82, 1)], fill=WOOD_L)
    d.rectangle([4, 6, 79, 42], fill=INK)
    d.rectangle([5, 7, 78, 41], fill=PAPER)
    # column rules for To do / Doing / Done
    for x in (30, 54):
        d.line([(x, 8), (x, 40)], fill=(194, 186, 166, 255))
    d.rectangle([34, 2, 49, 4], fill=WOOD_L)


BOARD_X, BOARD_Y = 452, 40
put(draw_sprite(board, 84, 57), BOARD_X, BOARD_Y, (BOARD_X, BOARD_Y + 40, BOARD_X + 84, BOARD_Y + 57))
BOARD_PAPER = (BOARD_X + 5, BOARD_Y + 7, BOARD_X + 79, BOARD_Y + 42)


def pc(d):
    d.rectangle([0, 0, 25, 33], fill=INK)
    d.rectangle([1, 1, 24, 32], fill=STONE_L)
    d.rectangle([1, 24, 24, 32], fill=STONE)
    d.rectangle([4, 4, 21, 18], fill=INK)
    d.rectangle([5, 5, 20, 17], fill=BLUE)
    d.line([(6, 7), (12, 7)], fill=BLUE_L)
    d.line([(6, 10), (16, 10)], fill=BLUE_L)
    d.rectangle([5, 26, 9, 28], fill=RED)
    d.rectangle([16, 26, 20, 28], fill=INK)


PC_X, PC_Y = 392, 80
put(draw_sprite(pc, 26, 34), PC_X, PC_Y, (PC_X, PC_Y + 20, PC_X + 26, PC_Y + 34))


def pokeball_statue(d):
    d.rectangle([2, 16, 17, 25], fill=INK)
    d.rectangle([3, 17, 16, 24], fill=STONE)
    d.line([(3, 17), (16, 17)], fill=STONE_L)
    d.ellipse([2, 0, 17, 15], fill=INK)
    d.pieslice([3, 1, 16, 14], 180, 360, fill=RED)
    d.pieslice([3, 1, 16, 14], 0, 180, fill=WHITE)
    d.line([(3, 7), (16, 7)], fill=INK)
    d.ellipse([7, 5, 12, 10], fill=INK)
    d.ellipse([8, 6, 11, 9], fill=WHITE)


put(draw_sprite(pokeball_statue, 20, 26), 268, 92, (268, 108, 288, 118))


def sign(d):
    d.rectangle([10, 14, 13, 24], fill=INK)
    d.rectangle([11, 14, 12, 23], fill=WOOD_D)
    d.rectangle([0, 0, 23, 15], fill=INK)
    d.rectangle([1, 1, 22, 14], fill=WOOD)
    d.line([(1, 1), (22, 1)], fill=WOOD_L)


SIGN_X, SIGN_Y = 188, 92
put(draw_sprite(sign, 24, 25), SIGN_X, SIGN_Y)


def flowers(n, box):
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = box
    for _ in range(n):
        x, y = rng.randint(x0, x1), rng.randint(y0, y1)
        if any(bx0 - 4 <= x <= bx1 + 4 and by0 - 4 <= y <= by1 + 4 for bx0, by0, bx1, by1 in blocked):
            continue
        c = rng.choice([RED, YELLOW, WHITE, (215, 123, 186, 255)])
        d.point([(x, y - 1), (x - 1, y), (x + 1, y), (x, y + 1)], fill=c)
        d.point((x, y), fill=YELLOW if c != YELLOW else WOOD)


flowers(18, (40, 130, 84, 170))
flowers(18, (556, 130, 600, 200))
flowers(14, (100, 410, 140, 428))
flowers(14, (500, 410, 540, 428))
flowers(10, (150, 130, 230, 170))


# ---------------------------------------------------------------- desk ----
def desk(d, night=False):
    top, top_l, side = (WOOD, WOOD_L, WOOD_D)
    d.rectangle([0, 6, 35, 15], fill=INK)
    d.rectangle([1, 7, 34, 11], fill=top)
    d.line([(1, 7), (34, 7)], fill=top_l)
    d.rectangle([1, 12, 34, 14], fill=side)
    for x in (2, 31):
        d.rectangle([x, 15, x + 2, 21], fill=INK)
        d.rectangle([x + 1, 15, x + 1, 20], fill=side)
    # laptop lid seen from behind, a little poké ball logo
    d.rectangle([10, 0, 25, 8], fill=INK)
    d.rectangle([11, 1, 24, 7], fill=STONE_L if not night else STONE)
    d.point((17, 3), fill=RED)
    d.point((18, 3), fill=RED)
    d.point((17, 4), fill=WHITE)
    d.point((18, 4), fill=WHITE)


DESK = draw_sprite(desk, 36, 22)

# ------------------------------------------------------------- layout ----
ROW_A, ROW_B = 248, 338           # pokémon feet y at the desks
DESK_X = [144, 232, 320, 408, 496]
DESK_DY = 12                      # desk bottom sits this far below the feet
AISLE = {"top": 206, "mid": 292, "low": 388}
COLS = [100, 188, 276, 364, 452, 540]


def pct(x, y):
    return {"x": round(x / W * 100, 2), "y": round(y / H * 100, 2)}


spots, furniture, wps = [], [], {}


def wp(id_, x, y):
    wps[id_] = {"id": id_, **pct(x, y), "connections": set()}


def link(a, b):
    wps[a]["connections"].add(b)
    wps[b]["connections"].add(a)


# Desk order matters: spot-1 is the boss, spot-2 is Claude (front and centre)
desk_slots = [(320, ROW_B), (408, ROW_B), (232, ROW_B), (496, ROW_B), (144, ROW_B),
              (320, ROW_A), (232, ROW_A), (408, ROW_A), (144, ROW_A), (496, ROW_A)]
for i, (x, y) in enumerate(desk_slots, start=1):
    facing = "front-left" if x <= 320 else "front-right"
    spots.append({"id": f"spot-{i}", "type": "desk", **pct(x, y), "facing": "down", "spriteFacing": facing})
    furniture.append({"id": f"desk-{i}", "type": "desk", "sprite": "map-desk", **pct(x, y + DESK_DY)})

# aisle lattice
xs = sorted(set(COLS + DESK_X))
for name, y in AISLE.items():
    prev = None
    for x in xs:
        id_ = f"W-{name}-{x}"
        wp(id_, x, y)
        if prev:
            link(prev, id_)
        prev = id_
for x in COLS:
    link(f"W-top-{x}", f"W-mid-{x}")
    link(f"W-mid-{x}", f"W-low-{x}")
# desks are entered from behind (the aisle above)
for i, (x, y) in enumerate(desk_slots, start=1):
    wp(f"W-spot-{i}", x, y)
    link(f"W-spot-{i}", f"W-{'top' if y == ROW_A else 'mid'}-{x}")

# lab door, front yard, mailbox (filing), PC (printer)
wp("W-door", DOOR[0], DOOR[1] + 10)
wp("W-yard", DOOR[0], 150)
link("W-door", "W-yard")
link("W-yard", "W-top-320")
link("W-yard", "W-top-364")
wp("W-door-2", DOOR[0] - 22, DOOR[1] + 22)
wp("W-door-3", DOOR[0] + 22, DOOR[1] + 22)
link("W-door-2", "W-door"); link("W-door-3", "W-door")
link("W-door-2", "W-yard"); link("W-door-3", "W-yard")
wp("W-filing", 250, 136)
link("W-filing", "W-yard"); link("W-filing", "W-top-232")
wp("W-printer", PC_X + 13, 130)
link("W-printer", "W-yard"); link("W-printer", "W-top-408")

# berry trees (coffee) on the left, pond (water) on the right
wp("W-coffee-1", 92, 246); link("W-coffee-1", "W-top-100"); link("W-coffee-1", "W-mid-100")
wp("W-coffee-2", 104, 360); link("W-coffee-2", "W-mid-100"); link("W-coffee-2", "W-low-100")
wp("W-water-1", 566, 292); link("W-water-1", "W-mid-540")
wp("W-water-2", 606, 296); link("W-water-2", "W-water-1")

spots += [
    {"id": "spot-coffee-1", "type": "coffee", **pct(92, 246), "facing": "down", "spriteFacing": "front-left"},
    {"id": "spot-coffee-2", "type": "coffee", **pct(104, 360), "facing": "down", "spriteFacing": "front-left"},
    {"id": "spot-water-1", "type": "water", **pct(566, 292), "facing": "down", "spriteFacing": "front-right"},
    {"id": "spot-water-2", "type": "water", **pct(606, 296), "facing": "down", "spriteFacing": "front-right"},
    {"id": "spot-filing", "type": "filing", **pct(250, 136), "facing": "down", "spriteFacing": "front-left"},
    {"id": "spot-printer", "type": "printer", **pct(PC_X + 13, 130), "facing": "down", "spriteFacing": "front-right"},
    {"id": "spot-door-2", "type": "door", **pct(DOOR[0] - 22, DOOR[1] + 22), "facing": "down", "spriteFacing": "front-left"},
    {"id": "spot-door-3", "type": "door", **pct(DOOR[0] + 22, DOOR[1] + 22), "facing": "down", "spriteFacing": "front-right"},
]


def hotspot(id_, x, y, label):
    furniture.append({"id": id_, "type": "hotspot", "sprite": "hotspot", **pct(x, y), "interactive": True, "label": label})


hotspot("water-cooler", 590, 242, "연못")
hotspot("bell", 278, 104, "몬스터볼 동상")
hotspot("kanban-board", BOARD_X + 42, BOARD_Y + 50, "게시판")
hotspot("tv-monitor", PC_X + 13, PC_Y + 14, "PC")
hotspot("coffee", 54, 204, "나무열매 나무")
hotspot("printer-1", PC_X + 13, PC_Y + 28, "PC")
hotspot("filing-1", 244, 108, "우체통")

layout = {
    "size": {"w": W, "h": H},
    "entryPoint": pct(DOOR[0], DOOR[1] + 10),
    "spots": spots,
    "furniture": furniture,
    "waypoints": [{**v, "connections": sorted(v["connections"])} for v in wps.values()],
    "anchors": {
        "door": pct(*DOOR),
        "doorBeacon": pct(DOOR[0], LAB_Y + 52),
        "tv": pct(PC_X + 13, PC_Y + 11),
        "daysSign": pct(SIGN_X + 12, SIGN_Y + 8),
        "kanban": pct(BOARD_X + 42, BOARD_Y + 24),
        "counter": pct(70, 230),
        "boardRect": {
            "left": round(BOARD_PAPER[0] / W * 100, 2), "top": round(BOARD_PAPER[1] / H * 100, 2),
            "width": round((BOARD_PAPER[2] - BOARD_PAPER[0]) / W * 100, 2),
            "height": round((BOARD_PAPER[3] - BOARD_PAPER[1]) / H * 100, 2),
        },
    },
}


# ------------------------------------------------------------- night ----
def to_night(im, windows):
    px = im.copy().convert("RGBA")
    r, g, b, a = px.split()
    r = r.point(lambda v: int(v * 0.38))
    g = g.point(lambda v: int(v * 0.45))
    b = b.point(lambda v: int(min(255, v * 0.62 + 30)))
    out = Image.merge("RGBA", (r, g, b, a))
    for (x0, y0, x1, y1) in windows:
        out.alpha_composite(im.crop((x0, y0, x1, y1)).point(lambda v: v), (x0, y0))
        glow = Image.new("RGBA", (x1 - x0, y1 - y0), (255, 214, 120, 150))
        out.alpha_composite(glow, (x0, y0))
    return out


# lab windows (from the tileset house art) + PC screen
windows = [
    (LAB_X + 34, LAB_Y + 58, LAB_X + 46, LAB_Y + 68),
    (LAB_X + 21, LAB_Y + 81, LAB_X + 41, LAB_Y + 88),
    (PC_X + 5, PC_Y + 5, PC_X + 21, PC_Y + 18),
]

out_rooms = ROOT / "public" / "rooms"
out_map = ROOT / "public" / "sprites" / "map"
out_map.mkdir(parents=True, exist_ok=True)
img.save(out_rooms / "pokemon-day.png")
to_night(img, windows).save(out_rooms / "pokemon-night.png")
DESK.save(out_map / "desk.png")
(ROOT / "src" / "pokemon" / "map.generated.json").write_text(json.dumps(layout, ensure_ascii=False, indent=1), encoding="utf-8")
print("ok", len(spots), "spots", len(wps), "waypoints")
