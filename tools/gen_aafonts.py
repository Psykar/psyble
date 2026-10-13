"""Pre-render antialiased glyphs for src/c/aafont.c.

Pebble's font compiler only emits 1-bit glyphs, so colour platforms draw text from these 2-bit
coverage bitmaps instead. Re-run after changing a font, size or character set:

    uv run --no-project --with freetype-py python tools/gen_aafonts.py

Format (little-endian), read by aafont.c:
    header  u8 version=1, u8 size_px, u16 glyph_count
    glyph   11 bytes: u16 codepoint, u8 advance, u8 width, u8 height, i8 left, i8 top, u32 data_offset
            (`top` = rows above the baseline; glyphs sorted by codepoint)
    data    per glyph, width*height 2-bit coverage values, 4 per byte, MSB first, rows contiguous
"""
import os
import struct

import freetype

ROOT = os.path.join(os.path.dirname(__file__), "..")
SEMI = os.path.join(ROOT, "resources/fonts/BarlowCondensed-SemiBold.ttf")
BOLD = os.path.join(ROOT, "resources/fonts/BarlowCondensed-Bold.ttf")
# Labels use the slightly wider Semi Condensed cut, which stays legible at 12-13 px.
LABEL_SMALL = os.path.join(ROOT, "resources/fonts/BarlowSemiCondensed-Bold.ttf")
LABEL_LARGE = os.path.join(ROOT, "resources/fonts/BarlowSemiCondensed-SemiBold.ttf")

PRINTABLE = [chr(c) for c in range(0x20, 0x7F)] + [chr(c) for c in range(0xA1, 0x100)] + ["…"]
DIGITS = list("0123456789")

FONTS = {
    "LABEL_12": (LABEL_SMALL, 12, PRINTABLE),
    "LABEL_13": (LABEL_LARGE, 13, PRINTABLE),
    "NUM_12": (BOLD, 12, DIGITS + list("hm%")),
    "WEEKDAY_14": (SEMI, 14, [chr(c) for c in range(ord("A"), ord("Z") + 1)]),
    "NUM_14": (BOLD, 14, DIGITS + list("hm")),
    "TIME_17": (BOLD, 17, DIGITS + [":"]),
    "TIME_22": (BOLD, 22, DIGITS + [":"]),
    "DAY_21": (BOLD, 21, DIGITS),
    "DAY_28": (BOLD, 28, DIGITS),
}


def coverage_levels(bitmap):
    # 0..255 coverage -> 0..3, matching the display's 2 bits per colour channel.
    rows = []
    for y in range(bitmap.rows):
        row = bitmap.buffer[y * bitmap.pitch : y * bitmap.pitch + bitmap.width]
        rows.append([(v * 3 + 127) // 255 for v in row])
    return rows


def pack(levels):
    flat = [v for row in levels for v in row]
    flat += [0] * (-len(flat) % 4)
    return bytes(
        (flat[i] << 6) | (flat[i + 1] << 4) | (flat[i + 2] << 2) | flat[i + 3] for i in range(0, len(flat), 4)
    )


def build(path, size, chars):
    face = freetype.Face(path)
    face.set_pixel_sizes(0, size)
    glyphs, data = [], b""
    for ch in sorted(set(chars), key=ord):
        face.load_char(ch, freetype.FT_LOAD_RENDER | freetype.FT_LOAD_TARGET_LIGHT)
        g = face.glyph
        levels = coverage_levels(g.bitmap)
        glyphs.append((ord(ch), (g.advance.x + 32) >> 6, g.bitmap.width, g.bitmap.rows, g.bitmap_left,
                       g.bitmap_top, len(data)))
        data += pack(levels)
    out = struct.pack("<BBH", 1, size, len(glyphs))
    for cp, adv, w, h, left, top, off in glyphs:
        out += struct.pack("<HBBBbbI", cp, adv, w, h, left, top, off)
    return out + data


def main():
    out_dir = os.path.join(ROOT, "resources/aafonts")
    os.makedirs(out_dir, exist_ok=True)
    for name, (path, size, chars) in FONTS.items():
        blob = build(path, size, chars)
        with open(os.path.join(out_dir, name + ".bin"), "wb") as f:
            f.write(blob)
        print(f"{name}: {len(blob)} bytes")


if __name__ == "__main__":
    main()
