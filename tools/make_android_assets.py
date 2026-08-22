"""Render the Android launcher icons and splash from resources/mark.svg.

    python3 tools/make_android_assets.py

Run this locally and COMMIT the output in resources/android/. It is deliberately
not part of the CI build: cairosvg needs a native cairo library, and adding that
to the workflow is a dependency that can break a release build for a reason
that has nothing to do with the release. Pre-rendered PNGs cannot break.

`scripts/patch-android-icons.py` copies these into the generated Android project
during the build, replacing Capacitor's default icon.

Adaptive icons (Android 8+) are 108dp of canvas with only the middle 72dp
guaranteed visible — the launcher masks the rest into whatever shape the phone
uses, and animates it during press. So the foreground layer keeps the mark
inside roughly the middle 60%, or the cross arm gets shaved off on a circular
mask.
"""
import pathlib
import cairosvg
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
SVG = ROOT / "resources/mark.svg"
OUT = ROOT / "resources/android"

PANEL = (27, 28, 33, 255)          # --panel / theme-color / status bar

# density: (legacy launcher px, adaptive foreground px)
DENSITIES = {
    "mdpi":    (48, 108),
    "hdpi":    (72, 162),
    "xhdpi":   (96, 216),
    "xxhdpi":  (144, 324),
    "xxxhdpi": (192, 432),
}


def mark(px: int) -> Image.Image:
    """The mark alone, transparent, at the given size."""
    tmp = OUT / f"_tmp-{px}.png"
    cairosvg.svg2png(url=str(SVG), write_to=str(tmp),
                     output_width=px, output_height=px, background_color=None)
    img = Image.open(tmp).convert("RGBA")
    tmp.unlink()
    return img


def legacy(size: int) -> Image.Image:
    """Pre-Android-8 icon: the mark on a solid tile, slightly rounded."""
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    radius = max(2, int(size * 0.18))

    shape = Image.new("L", (size, size), 0)
    ImageDraw.Draw(shape).rounded_rectangle((0, 0, size - 1, size - 1),
                                            radius=radius, fill=255)

    bg = Image.new("RGBA", (size, size), PANEL)
    tile.paste(bg, (0, 0), shape)

    m = mark(int(size * 0.66))
    tile.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2))
    return tile


def legacy_round(size: int) -> Image.Image:
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shape = Image.new("L", (size, size), 0)
    ImageDraw.Draw(shape).ellipse((0, 0, size - 1, size - 1), fill=255)

    bg = Image.new("RGBA", (size, size), PANEL)
    tile.paste(bg, (0, 0), shape)

    m = mark(int(size * 0.58))
    tile.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2))
    return tile


def foreground(size: int) -> Image.Image:
    """Adaptive foreground: transparent, mark inside the 72/108 safe zone."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    m = mark(int(size * 0.46))
    layer.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2))
    return layer


def splash(w: int, h: int) -> Image.Image:
    img = Image.new("RGBA", (w, h), PANEL)
    m = mark(int(min(w, h) * 0.26))
    img.alpha_composite(m, ((w - m.width) // 2, (h - m.height) // 2))
    return img.convert("RGB")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)

    for name, (sq, fg) in DENSITIES.items():
        legacy(sq).save(OUT / f"ic_launcher-{name}.png")
        legacy_round(sq).save(OUT / f"ic_launcher_round-{name}.png")
        foreground(fg).save(OUT / f"ic_launcher_foreground-{name}.png")
        print(f"{name}: launcher {sq}px, foreground {fg}px")

    # Capacitor's launch theme uses @drawable/splash, stretched to fill.
    # A square keeps the mark from distorting in either orientation.
    splash(1920, 1920).save(OUT / "splash.png")
    print("splash: 1920x1920")
    print("\nwritten to", OUT)
