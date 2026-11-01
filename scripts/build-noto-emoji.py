#!/usr/bin/env python3
"""Builds client/vendor/noto-emoji/ from a checkout of Google's Noto Emoji.

    git clone --depth 1 https://github.com/googlefonts/noto-emoji.git /tmp/noto-emoji
    python3 scripts/build-noto-emoji.py /tmp/noto-emoji

Needs Pillow (pip install pillow). Every emoji becomes one small WebP named by its code points
without U+FE0F, joined by "-" (😂 is 1f602.webp, ❤️‍🔥 is 2764-200d-1f525.webp), the names
client/js/chat-extras.js asks for. Noto's emoji are drawn at 72px from its 2D/png/72 folder.
Noto has no flag pictures of its own (its font draws them from region-flags), so flags are made
here from third_party/region-flags/png: the flag on a clear square with rounded corners.
"""
import os
import re
import shutil
import sys

from PIL import Image, ImageDraw

SIZE = 72
QUALITY = 85


def save(im, path):
    im.save(path, 'WEBP', quality=QUALITY, alpha_quality=90, method=6)


def flag(src):
    im = Image.open(src).convert('RGBA')
    w = SIZE - 6
    h = max(1, round(im.height * w / im.width))
    if h > SIZE - 18:  # square or tall flags (Switzerland, Nepal) keep inside the box
        h = SIZE - 18
        w = max(1, round(im.width * h / im.height))
    im = im.resize((w, h), Image.LANCZOS)
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=6, fill=255)
    out = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    # A faint edge so white flags (Japan, England) still show on light cards.
    edge = Image.new('RGBA', (w + 2, h + 2), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle((0, 0, w + 1, h + 1), radius=7, fill=(0, 0, 0, 40))
    out.alpha_composite(edge, ((SIZE - w) // 2 - 1, (SIZE - h) // 2 - 1))
    out.paste(im, ((SIZE - w) // 2, (SIZE - h) // 2), mask)
    return out


def main(noto, dest):
    pngs = os.path.join(noto, '2D', 'png', '72')
    flags = os.path.join(noto, 'third_party', 'region-flags', 'png')
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    os.makedirs(dest)
    count = 0
    for name in sorted(os.listdir(pngs)):
        m = re.fullmatch(r'emoji_u([0-9a-f_]+)\.png', name)
        if not m:
            continue
        cps = [c for c in m.group(1).split('_') if c != 'fe0f']
        im = Image.open(os.path.join(pngs, name)).convert('RGBA')
        if im.size != (SIZE, SIZE):
            im = im.resize((SIZE, SIZE), Image.LANCZOS)
        save(im, os.path.join(dest, '-'.join(cps) + '.webp'))
        count += 1
    for name in sorted(os.listdir(flags)):
        code = name[:-4]
        if not name.endswith('.png'):
            continue
        if re.fullmatch(r'[A-Z]{2}', code):  # 🇳🇴: two regional indicator letters
            cps = [format(0x1F1E6 + ord(c) - 65, 'x') for c in code]
        elif code in ('GB-ENG', 'GB-SCT', 'GB-WLS'):  # 🏴󠁧󠁢󠁥󠁮󠁧󠁿: a black flag followed by tag letters
            cps = ['1f3f4'] + [format(0xE0000 + ord(c), 'x') for c in code.replace('-', '').lower()] + ['e007f']
        else:
            continue
        save(flag(os.path.join(flags, name)), os.path.join(dest, '-'.join(cps) + '.webp'))
        count += 1
    print(f'{count} emoji written to {dest}')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    here = os.path.dirname(os.path.abspath(__file__))
    main(sys.argv[1], os.path.join(here, '..', 'client', 'vendor', 'noto-emoji'))
