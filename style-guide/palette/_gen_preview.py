"""Generate colors-preview.png from the canonical palette."""
from PIL import Image, ImageDraw, ImageFont
import os

# ── Palette (mirrors palette/colors.json v0.2.0) ─────────────────────────────

BRAND = [
    ("#101F5B", "navy"),
    ("#0072B2", "blue"),
    ("#63AAFF", "sky"),
]

CATEGORICAL = [
    ("#0072B2", "Blue"),
    ("#E69F00", "Amber"),
    ("#8856BF", "Violet"),
    ("#2A8B3A", "Green"),
    ("#B8302C", "Red"),
    ("#CC79A7", "Rose"),
    ("#7A5230", "Russet"),
]

# 8 tiers per hue, lightest (L*=85) → darkest (L*=15)
TIER_LSTARS = [85, 75, 65, 55, 45, 35, 25, 15]
TIER_NAMES = ["50", "100", "200", "300", "400", "500", "600", "700"]

SCALES = [
    ("blue",   ["#95DAFF", "#77BEFF", "#58A3E7", "#3689CB", "#0070AF", "#005794", "#00407A", "#002B61"]),
    ("amber",  ["#FFC63D", "#F4AB1A", "#D59000", "#B67700", "#985E00", "#7B4600", "#612F00", "#4B1900"]),
    ("violet", ["#F6BCFF", "#D8A0FF", "#BC85F4", "#9F6BD7", "#8452BB", "#693A9F", "#4E2185", "#33076B"]),
    ("green",  ["#8CE990", "#70CD76", "#54B15C", "#379644", "#127B2C", "#006213", "#004900", "#003100"]),
    ("red",    ["#FFA895", "#FF8C7B", "#FF7062", "#E1554A", "#C13933", "#A2191D", "#840006", "#670000"]),
    ("rose",   ["#FFBAE9", "#F49ECD", "#D783B2", "#BB6997", "#9F507D", "#843764", "#691D4C", "#4F0035"]),
    ("russet", ["#FDCAA3", "#E0AF89", "#C3946F", "#A77A56", "#8B623F", "#714A28", "#563313", "#3E1E00"]),
]

STRUCTURAL = [
    ("#1A1A2E", "text_heading"),
    ("#4A4A4A", "text_body"),
    ("#6D6D6D", "text_muted"),
    ("#666666", "text_axis"),
    ("#BBBBBB", "annotation_dim"),
    ("#999999", "axis_stroke"),
    ("#E5E5E5", "border"),
    ("#F0F0F0", "gridline"),
    ("#F6F7F9", "bg_subtle"),
    ("#D9EAFF", "bg_highlight"),
]

# ── Layout constants ──────────────────────────────────────────────────────────

W = 1280
PAD = 40
COL_GAP = 10
ROW_GAP = 8
SECTION_GAP = 36
LABEL_H = 32

BRAND_W, BRAND_H = 160, 72
CAT_W, CAT_H     = 130, 60
SCALE_W, SCALE_H = 120, 44
STRUCT_W, STRUCT_H = 86, 40

SECTION_TITLE_H = 28

BG = "#ffffff"
TEXT_DARK  = "#1a1a2e"
TEXT_MID   = "#4a4a4a"
TEXT_LIGHT = "#999999"

# ── Fonts ─────────────────────────────────────────────────────────────────────

def load_font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()

FONT_PATHS = ["C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf"]
FONT_BOLD_PATHS = ["C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf"]

def best_font(paths, size):
    for p in paths:
        if os.path.exists(p):
            return load_font(p, size)
    return ImageFont.load_default()

f_title    = best_font(FONT_BOLD_PATHS, 18)
f_section  = best_font(FONT_BOLD_PATHS, 13)
f_label    = best_font(FONT_PATHS, 11)
f_hex      = best_font(FONT_PATHS, 10)
f_tier     = best_font(FONT_PATHS, 9)

# ── Helpers ───────────────────────────────────────────────────────────────────

def h(hex_str):
    hex_str = hex_str.lstrip("#")
    return tuple(int(hex_str[i:i+2], 16) for i in (0, 2, 4))

def text_color_for(hex_str):
    r, g, b = h(hex_str)
    luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return "#ffffff" if luminance < 0.55 else TEXT_DARK

def draw_swatch(draw, x, y, w, ht, hex_color, label, sub="", font_label=None, font_sub=None):
    font_label = font_label or f_label
    font_sub   = font_sub   or f_hex
    draw.rectangle([x, y, x + w - 1, y + ht - 1], fill=hex_color)
    if label:
        draw.text((x, y + ht + 3), label, font=font_label, fill=TEXT_DARK)
    if sub:
        draw.text((x, y + ht + 3 + 14), sub, font=font_sub, fill=TEXT_LIGHT)

def section_header(draw, x, y, text, font=None):
    font = font or f_section
    draw.text((x, y), text, font=font, fill=TEXT_DARK)
    return y + SECTION_TITLE_H

# ── Compute total height ──────────────────────────────────────────────────────

brand_block_h    = BRAND_H + LABEL_H
cat_block_h      = CAT_H  + LABEL_H
TIER_HDR_H       = 18
scale_row_h      = SCALE_H + LABEL_H + ROW_GAP
scales_block_h   = TIER_HDR_H + ROW_GAP + len(SCALES) * scale_row_h - ROW_GAP
struct_block_h   = STRUCT_H + LABEL_H

total_h = (
    PAD
    + 30 + 12
    + SECTION_TITLE_H + brand_block_h
    + SECTION_GAP
    + SECTION_TITLE_H + cat_block_h
    + SECTION_GAP
    + SECTION_TITLE_H + scales_block_h
    + SECTION_GAP
    + SECTION_TITLE_H + struct_block_h
    + PAD
)

# ── Draw ──────────────────────────────────────────────────────────────────────

img  = Image.new("RGB", (W, total_h), BG)
draw = ImageDraw.Draw(img)

cy = PAD

# Title
draw.text((PAD, cy), "Budget Lab — Canonical Palette  v0.2.0", font=f_title, fill=TEXT_DARK)
cy += 30 + 12

# ── Brand ─────────────────────────────────────────────────────────────────────
cy = section_header(draw, PAD, cy, "BRAND")
x = PAD
for hex_color, name in BRAND:
    draw_swatch(draw, x, cy, BRAND_W, BRAND_H, hex_color, name, hex_color)
    x += BRAND_W + COL_GAP * 2
cy += brand_block_h + SECTION_GAP

# ── Categorical ───────────────────────────────────────────────────────────────
cy = section_header(draw, PAD, cy, "CATEGORICAL PALETTE  —  apply in order  (aliases: yellow→amber, purple→violet, pink→rose, brown→russet)")
x = PAD
for hex_color, name in CATEGORICAL:
    draw_swatch(draw, x, cy, CAT_W, CAT_H, hex_color, name, hex_color)
    x += CAT_W + COL_GAP
cy += cat_block_h + SECTION_GAP

# ── Tonal scales ──────────────────────────────────────────────────────────────
cy = section_header(draw, PAD, cy, "TONAL SCALES  —  8 tiers per hue at fixed L* (lightest 50 → darkest 700)")
LABEL_COL_W = 70

# Tier header row
hx = PAD + LABEL_COL_W
for tname, lstar in zip(TIER_NAMES, TIER_LSTARS):
    txt = f"{tname}  L*{lstar}"
    draw.text((hx + 4, cy), txt, font=f_tier, fill=TEXT_LIGHT)
    hx += SCALE_W + COL_GAP
cy += TIER_HDR_H + ROW_GAP

for scale_name, shades in SCALES:
    draw.text((PAD, cy + SCALE_H // 2 - 6), scale_name, font=f_label, fill=TEXT_MID)
    x = PAD + LABEL_COL_W
    for shade in shades:
        draw.rectangle([x, cy, x + SCALE_W - 1, cy + SCALE_H - 1], fill=shade)
        draw.text((x, cy + SCALE_H + 2), shade, font=f_hex, fill=TEXT_LIGHT)
        x += SCALE_W + COL_GAP
    cy += SCALE_H + LABEL_H + ROW_GAP
cy += -ROW_GAP + SECTION_GAP

# ── Structural ────────────────────────────────────────────────────────────────
cy = section_header(draw, PAD, cy, "STRUCTURAL  —  non-data UI colors")
x = PAD
for hex_color, name in STRUCTURAL:
    draw.rectangle([x, cy, x + STRUCT_W - 1, cy + STRUCT_H - 1], fill=hex_color, outline="#cccccc")
    draw.text((x, cy + STRUCT_H + 3), name, font=f_hex, fill=TEXT_MID)
    draw.text((x, cy + STRUCT_H + 3 + 13), hex_color, font=f_hex, fill=TEXT_LIGHT)
    x += STRUCT_W + COL_GAP

cy += struct_block_h

# ── Save ──────────────────────────────────────────────────────────────────────
out = os.path.join(os.path.dirname(__file__), "colors-preview.png")
img.save(out, "PNG")
print(f"Saved: {out}  ({W}x{total_h})")
