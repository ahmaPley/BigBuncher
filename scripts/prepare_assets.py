"""Builds UI-ready images from the concept assets in /assets.

Run once (or after changing assets):  py -3 scripts/prepare_assets.py
Outputs:
  src/renderer/src/assets/img/*   -> backgrounds, banner, block icons
  build/icon.png, build/icon.ico  -> application icon (drawn procedurally, crisp at any size)
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets"
OUT = ROOT / "src" / "renderer" / "src" / "assets" / "img"
BUILD = ROOT / "build"

BLOCKS = {
    # name: bounding box inside 04_icons/icon_collection.png (row 3)
    "grass": (6, 116, 38, 151),
    "stone": (58, 115, 91, 150),
    "log": (111, 116, 143, 150),
    "crafting": (163, 115, 195, 150),
    "furnace": (215, 116, 247, 150),
    "chest": (268, 117, 299, 150),
}

BACKGROUNDS = {
    "bg_sunset.png": "02_backgrounds/background_sunset_landscape.png",
    "bg_night.png": "02_backgrounds/background_night_landscape.png",
    "bg_snow.png": "02_backgrounds/background_snow_mountains.png",
    "bg_valley.png": "02_backgrounds/background_green_valley.png",
    "banner.png": "02_backgrounds/background_brand_banner.png",
}


def key_out_background(img: Image.Image, bg: tuple, tolerance: int = 38) -> Image.Image:
    """Turns pixels close to the sheet background colour transparent (soft edge)."""
    img = img.convert("RGBA")
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, _ = px[x, y]
            dist = abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])
            if dist < tolerance:
                px[x, y] = (r, g, b, 0)
            elif dist < tolerance * 2:
                px[x, y] = (r, g, b, int(255 * (dist - tolerance) / tolerance))
    return img


def export_blocks() -> None:
    sheet = Image.open(SRC / "04_icons" / "icon_collection.png").convert("RGB")
    bg = sheet.getpixel((2, 190))
    (OUT / "blocks").mkdir(parents=True, exist_ok=True)
    for name, (x0, y0, x1, y1) in BLOCKS.items():
        crop = sheet.crop((x0 - 1, y0 - 1, x1 + 2, y1 + 2))
        key_out_background(crop, bg).save(OUT / "blocks" / f"{name}.png")


def export_backgrounds() -> None:
    for out_name, rel in BACKGROUNDS.items():
        Image.open(SRC / rel).convert("RGB").save(OUT / out_name)
    # Wider hero crop: the clean right part of the main-screen concept (no text there).
    hero = Image.open(SRC / "01_launcher" / "launcher_main_screen.png").convert("RGB")
    hero.crop((480, 48, 912, 368)).save(OUT / "bg_lake.png")


def draw_logo(size: int) -> Image.Image:
    """Isometric hollow cube — the BigBuncher mark from the concept board."""
    s = size / 100
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def poly(points, color):
        d.polygon([(x * s, y * s) for x, y in points], fill=color)

    top, left, right = (122, 222, 92), (76, 175, 60), (46, 125, 40)
    # outer hexagon faces
    poly([(50, 4), (92, 27), (50, 50), (8, 27)], top)
    poly([(8, 27), (50, 50), (50, 96), (8, 73)], left)
    poly([(92, 27), (50, 50), (50, 96), (92, 73)], right)
    # inner dark cube cut-out
    dark_top, dark_left, dark_right = (18, 40, 24), (12, 28, 18), (24, 52, 30)
    poly([(50, 30), (70, 41), (50, 52), (30, 41)], dark_top)
    poly([(30, 41), (50, 52), (50, 74), (30, 63)], dark_left)
    poly([(70, 41), (50, 52), (50, 74), (70, 63)], dark_right)
    # inner bright cube
    poly([(50, 44), (62, 51), (50, 58), (38, 51)], (150, 235, 110))
    poly([(38, 51), (50, 58), (50, 72), (38, 65)], (90, 190, 70))
    poly([(62, 51), (50, 58), (50, 72), (62, 65)], (60, 150, 50))
    return img


def export_icon() -> None:
    BUILD.mkdir(exist_ok=True)
    big = draw_logo(1024).resize((512, 512), Image.LANCZOS)
    big.save(BUILD / "icon.png")
    big.save(BUILD / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    big.resize((128, 128), Image.LANCZOS).save(OUT / "logo.png")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    export_blocks()
    export_backgrounds()
    export_icon()
    print("assets ready ->", OUT)
