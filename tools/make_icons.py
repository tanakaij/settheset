"""SetTheSet icons, rendered from the vector master.

    python3 tools/make_icons.py

Source of truth is resources/mark.svg — a redraw of the supplied artwork as
real paths. The earlier version alpha-cut the logo out of a JPEG, which carried
a soft glow and compression fringing and went to mush below about 192px. Vector
stays crisp at every size and can be recoloured without re-exporting.

Requires: pip install cairosvg
"""
import pathlib
import cairosvg

OUT = pathlib.Path("resources")
SVG = OUT / "mark.svg"
PANEL = "#1B1C21"          # --panel, matches the app chrome and theme-color


def render(size: int, path: pathlib.Path, bg: str | None, pad: float = 0.0):
    """pad = fraction of the tile left empty around the mark."""
    inner = int(size * (1 - pad * 2))
    cairosvg.svg2png(
        url=str(SVG),
        write_to=str(path),
        output_width=inner,
        output_height=inner,
        background_color=bg,
    )
    if not pad:
        return

    # re-centre the smaller render on a full-size tile
    from PIL import Image
    tile = Image.new("RGBA", (size, size), (27, 28, 33, 255) if bg else (0, 0, 0, 0))
    m = Image.open(path).convert("RGBA")
    tile.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2))
    tile.convert("RGB" if bg else "RGBA").save(path)


if __name__ == "__main__":
    render(192, OUT / "icon-192x192-any.png", PANEL)
    render(512, OUT / "icon-512x512-any.png", PANEL)
    render(180, OUT / "apple-touch-icon-180.png", PANEL)
    render(128, OUT / "favicon-128.png", PANEL)

    # maskable: pulled well inside so Android's adaptive shapes cannot clip it
    render(512, OUT / "icon-512x512-maskable.png", PANEL, pad=0.14)

    # transparent mark for the top bar
    render(256, OUT / "mark.png", None)

    print("icons rendered from", SVG)
