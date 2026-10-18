#!/usr/bin/env python3
"""Stáří zástavby podle dobových map.

Pro každou budovu z js/geo.js zjistí, zda na jejím místě (±6 m) byla zástavba zakreslena
  - na 2. vojenském mapování (Čechy 1842–1852),
  - na 3. vojenském mapování (Čechy 1877–1880).
Zástavba je na mapách vybarvena červeně/karmínově; silnice (tenké červené linky) odstraní
morfologické otevření. Dlaždice: Virtuální mapová sbírka Chartae Antiquae (© VÚGTK, v.v.i.),
používají se jen pro odvození příznaků, do repozitáře se neukládají.

Výstup: data/hist_flags.bin – Uint8 na budovu: bit 0 = na 2. mapování, bit 1 = na 3. mapování.
Použití: python3 tools/build_hist.py [adresář_mezipaměti]
"""
import io
import json
import math
import os
import re
import sys
import urllib.request

import numpy as np
from PIL import Image

LAT0, LON0 = 50.4253, 14.2618
K = math.cos(math.radians(LAT0))
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ZOOM = 16
MAPS = {
    'm2': {'url': 'https://www.chartae-antiquae.cz/TMS/Military2/{z}/{x}/{y}', 'th': (22, 15), 'min': 0.15},
    'm3': {'url': 'https://www.chartae-antiquae.cz/TMS/Military3/{z}/{x}/{y}', 'th': (35, 30), 'min': 0.25},
}
BUFFER = 0.6  # 6 m – přesnost umístění vojenských map je zhruba 10 m


def latlon(x, z):
    return LAT0 - z * 10 / 110574, LON0 + x * 10 / (111320 * K)


def gpix(lat, lon):
    n = 256 * 2 ** ZOOM
    r = np.radians(lat)
    return (lon + 180) / 360 * n, (1 - np.log(np.tan(r) + 1 / np.cos(r)) / np.pi) / 2 * n


def opening(m, r):
    def er(a):
        o = a.copy(); o[1:] &= a[:-1]; o[:-1] &= a[1:]; o[:, 1:] &= a[:, :-1]; o[:, :-1] &= a[:, 1:]
        return o

    def di(a):
        o = a.copy(); o[1:] |= a[:-1]; o[:-1] |= a[1:]; o[:, 1:] |= a[:, :-1]; o[:, :-1] |= a[:, 1:]
        return o
    for _ in range(r):
        m = er(m)
    for _ in range(r):
        m = di(m)
    return m


def main():
    cache = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '.hist-cache')
    os.makedirs(cache, exist_ok=True)
    geo = open(os.path.join(ROOT, 'js', 'geo.js'), encoding='utf-8').read()
    b = np.array(json.loads(re.search(r'export const BUILDINGS = (\[.*?\]);', geo).group(1)), dtype=float).reshape(-1, 7)
    la0, lo0 = latlon(b[:, 0].min() - 2, b[:, 1].min() - 2)
    la1, lo1 = latlon(b[:, 0].max() + 2, b[:, 1].max() + 2)
    px0, py0 = gpix(np.array(la0), np.array(lo0))
    px1, py1 = gpix(np.array(la1), np.array(lo1))
    tx0, tx1 = int(min(px0, px1) // 256), int(max(px0, px1) // 256)
    ty0, ty1 = int(min(py0, py1) // 256), int(max(py0, py1) // 256)
    flags = np.zeros(len(b), dtype=np.uint8)
    for bit, (name, m) in enumerate(MAPS.items()):
        W, H = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
        img = np.zeros((H, W, 3), dtype=np.uint8)
        for ty in range(ty0, ty1 + 1):
            for tx in range(tx0, tx1 + 1):
                path = os.path.join(cache, '%s_%d_%d_%d.img' % (name, ZOOM, tx, ty))
                if not os.path.exists(path):
                    url = m['url'].format(z=ZOOM, x=tx, y=ty)
                    req = urllib.request.Request(url, headers={'User-Agent': 'RoudniceHistorie/1.0'})
                    with urllib.request.urlopen(req, timeout=120) as r, open(path, 'wb') as f:
                        f.write(r.read())
                try:
                    t = Image.open(path).convert('RGB')
                except Exception:
                    continue
                img[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = np.asarray(t)
        a = img.astype(int)
        red = (a[..., 0] > a[..., 1] + m['th'][0]) & (a[..., 0] > a[..., 2] + m['th'][1])
        built = opening(red, 2)
        Image.fromarray((built * 255).astype(np.uint8)).save(os.path.join(cache, '%s_built.png' % name))
        us, vs = np.meshgrid(np.linspace(-0.5, 0.5, 7), np.linspace(-0.5, 0.5, 7))
        us, vs = us.ravel(), vs.ravel()
        hit = 0
        for k, (cx, cz, w, d, ang, _lv, _kind) in enumerate(b):
            c, s = math.cos(ang), math.sin(ang)
            lx, lz = us * (w + 2 * BUFFER), vs * (d + 2 * BUFFER)
            x, z = cx + lx * c - lz * s, cz + lx * s + lz * c
            lat, lon = latlon(x, z)
            gx, gy = gpix(lat, lon)
            ix = np.clip((gx - tx0 * 256).astype(int), 0, W - 1)
            iy = np.clip((gy - ty0 * 256).astype(int), 0, H - 1)
            if built[iy, ix].mean() >= m['min']:
                flags[k] |= 1 << bit
                hit += 1
        print(name, 'budov se zástavbou na mapě:', hit, '/', len(b), file=sys.stderr)
    os.makedirs(os.path.join(ROOT, 'data'), exist_ok=True)
    flags.tofile(os.path.join(ROOT, 'data', 'hist_flags.bin'))


if __name__ == '__main__':
    main()
