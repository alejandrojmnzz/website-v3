#!/usr/bin/env python3
"""Regenerate the Inter latin subset used by the site.

The full Inter variable font (client/public/fonts/inter-variable.woff2, ~344KB)
is kept in the repo only as the source. The site loads the subset produced by
this script (~37KB): latin glyphs, weight axis trimmed to 400-900, optical size
pinned. Re-run this script if you upgrade Inter or need more glyphs/weights,
then update the unicode-range in client/src/index.css if the ranges change.

Usage:
    python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install fonttools brotli
    /tmp/fontenv/bin/python3 scripts/subset-inter-font.py
"""

import os

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "client/public/fonts/inter-variable.woff2")
OUT = os.path.join(ROOT, "client/public/fonts/inter-variable-latin.woff2")

# Google Fonts "latin" range. Must stay in sync with the unicode-range of the
# 'Inter Variable' @font-face in client/src/index.css.
LATIN = (
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,"
    "U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
)


def main() -> None:
    font = TTFont(SRC)

    unicodes: list[int] = []
    for r in LATIN.split(","):
        parts = r[2:].split("-")
        unicodes.extend(range(int(parts[0], 16), int(parts[-1], 16) + 1))

    opts = Options()
    # tnum (tabular numbers) is kept because Inter is used for stats/countdowns.
    opts.layout_features += ["tnum", "ss01", "cv11"]
    sub = Subsetter(options=opts)
    sub.populate(unicodes=unicodes)
    sub.subset(font)

    # Site only uses regular (400) through black (900); pin optical size.
    instantiateVariableFont(font, {"wght": (400, 900), "opsz": 14.0}, inplace=True)

    font.flavor = "woff2"
    font.save(OUT)

    print("source:", os.path.getsize(SRC), "bytes")
    print("subset:", os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
