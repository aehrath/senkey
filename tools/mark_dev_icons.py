#!/usr/bin/env python3
"""Add a small DEV badge to generated extension icons.

This intentionally uses only the Python standard library so local extension
builds do not depend on Pillow, ImageMagick, or platform-specific image tools.
"""

from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

FONT = {
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "V": ["10001", "10001", "10001", "10001", "01010", "01010", "00100"],
}


def read_chunks(data: bytes):
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError("not a PNG file")
    offset = len(PNG_SIGNATURE)
    while offset < len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        chunk_type = data[offset + 4 : offset + 8]
        chunk_data = data[offset + 8 : offset + 8 + length]
        yield chunk_type, chunk_data
        offset += 12 + length


def paeth(left: int, up: int, upper_left: int) -> int:
    p = left + up - upper_left
    pa = abs(p - left)
    pb = abs(p - up)
    pc = abs(p - upper_left)
    if pa <= pb and pa <= pc:
        return left
    if pb <= pc:
        return up
    return upper_left


def unfilter_scanlines(raw: bytes, width: int, height: int, channels: int) -> list[bytearray]:
    stride = width * channels
    rows: list[bytearray] = []
    offset = 0
    for _ in range(height):
        filter_type = raw[offset]
        offset += 1
        row = bytearray(raw[offset : offset + stride])
        offset += stride
        previous = rows[-1] if rows else bytearray(stride)
        for i, value in enumerate(row):
            left = row[i - channels] if i >= channels else 0
            up = previous[i]
            upper_left = previous[i - channels] if i >= channels else 0
            if filter_type == 1:
                row[i] = (value + left) & 0xFF
            elif filter_type == 2:
                row[i] = (value + up) & 0xFF
            elif filter_type == 3:
                row[i] = (value + ((left + up) // 2)) & 0xFF
            elif filter_type == 4:
                row[i] = (value + paeth(left, up, upper_left)) & 0xFF
            elif filter_type != 0:
                raise ValueError(f"unsupported PNG filter {filter_type}")
        rows.append(row)
    return rows


def load_png(path: Path) -> tuple[int, int, bytearray]:
    data = path.read_bytes()
    width = height = bit_depth = color_type = interlace = None
    idat = bytearray()
    for chunk_type, chunk_data in read_chunks(data):
        if chunk_type == b"IHDR":
            width, height, bit_depth, color_type, _compression, _filter, interlace = struct.unpack(
                ">IIBBBBB", chunk_data
            )
        elif chunk_type == b"IDAT":
            idat.extend(chunk_data)

    if width is None or height is None:
        raise ValueError("missing PNG header")
    if bit_depth != 8 or interlace != 0 or color_type not in (2, 6):
        raise ValueError("only non-interlaced 8-bit RGB/RGBA PNG icons are supported")

    channels = 4 if color_type == 6 else 3
    rows = unfilter_scanlines(zlib.decompress(bytes(idat)), width, height, channels)
    rgba = bytearray(width * height * 4)
    for y, row in enumerate(rows):
        for x in range(width):
            src = x * channels
            dst = (y * width + x) * 4
            rgba[dst : dst + 3] = row[src : src + 3]
            rgba[dst + 3] = row[src + 3] if channels == 4 else 255
    return width, height, rgba


def chunk(chunk_type: bytes, chunk_data: bytes) -> bytes:
    crc = zlib.crc32(chunk_type)
    crc = zlib.crc32(chunk_data, crc)
    return struct.pack(">I", len(chunk_data)) + chunk_type + chunk_data + struct.pack(">I", crc & 0xFFFFFFFF)


def save_png(path: Path, width: int, height: int, rgba: bytearray) -> None:
    scanlines = bytearray()
    stride = width * 4
    for y in range(height):
        scanlines.append(0)
        start = y * stride
        scanlines.extend(rgba[start : start + stride])

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    data = PNG_SIGNATURE + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(scanlines), 9)) + chunk(b"IEND", b"")
    path.write_bytes(data)


def blend_pixel(rgba: bytearray, width: int, height: int, x: int, y: int, color: tuple[int, int, int, int]) -> None:
    if x < 0 or y < 0 or x >= width or y >= height:
        return
    r, g, b, alpha = color
    i = (y * width + x) * 4
    if alpha >= 255:
        rgba[i : i + 4] = bytes((r, g, b, 255))
        return
    inv = 255 - alpha
    rgba[i] = (r * alpha + rgba[i] * inv) // 255
    rgba[i + 1] = (g * alpha + rgba[i + 1] * inv) // 255
    rgba[i + 2] = (b * alpha + rgba[i + 2] * inv) // 255
    rgba[i + 3] = 255


def fill_rect(
    rgba: bytearray,
    width: int,
    height: int,
    x0: int,
    y0: int,
    rect_width: int,
    rect_height: int,
    color: tuple[int, int, int, int],
) -> None:
    for y in range(y0, y0 + rect_height):
        for x in range(x0, x0 + rect_width):
            blend_pixel(rgba, width, height, x, y, color)


def draw_text(rgba: bytearray, width: int, height: int, text: str, x0: int, y0: int, scale: int) -> None:
    cursor = x0
    for char in text:
        glyph = FONT[char]
        for row_index, row in enumerate(glyph):
            for col_index, value in enumerate(row):
                if value == "1":
                    fill_rect(
                        rgba,
                        width,
                        height,
                        cursor + col_index * scale,
                        y0 + row_index * scale,
                        scale,
                        scale,
                        (255, 255, 255, 255),
                    )
        cursor += (len(glyph[0]) + 1) * scale


def add_badge(path: Path) -> None:
    width, height, rgba = load_png(path)
    badge_width = max(10, round(width * 0.58))
    badge_height = max(8, round(height * 0.36))
    x0 = width - badge_width
    y0 = height - badge_height

    fill_rect(rgba, width, height, x0, y0, badge_width, badge_height, (136, 19, 55, 225))
    fill_rect(rgba, width, height, x0, y0, badge_width, max(1, height // 48), (255, 255, 255, 90))

    text = "D" if width < 32 else "DEV"
    text_width = (5 * len(text)) + max(0, len(text) - 1)
    scale = max(1, min((badge_width - 4) // text_width, (badge_height - 2) // 7))
    text_pixel_width = text_width * scale
    text_pixel_height = 7 * scale
    text_x = x0 + (badge_width - text_pixel_width) // 2
    text_y = y0 + (badge_height - text_pixel_height) // 2
    draw_text(rgba, width, height, text, text_x, text_y, scale)
    save_png(path, width, height, rgba)


def main() -> int:
    for arg in sys.argv[1:]:
        add_badge(Path(arg))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
