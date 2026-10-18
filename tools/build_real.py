#!/usr/bin/env python3
"""Stáhne skutečná výšková data a letecké snímky ČÚZK (© ČÚZK, CC BY 4.0) a připraví je pro web.

  - DMR 5G  – digitální model reliéfu (holý terén),
  - DMP 1G  – digitální model povrchu (terén + budovy + vegetace, lidar 2009–2013),
  - Ortofoto ČR (Web Mercator).

Výstup do data/real/:
  far_dmr.bin, mid_dmr.bin            – terén (Uint16, decimetry nad 100 m n. m.)
  mid_dmp.bin, core_dmp.bin           – povrch s budovami a stromy (Uint16, decimetry nad 100 m)
  far_orto.jpg, mid_orto.jpg, core_orto.jpg – letecké snímky
  bheights.bin                        – pro každou budovu z js/geo.js výška okapu a hřebene (Uint16, cm)
  meta.json                           – rozsahy dlaždic, rozměry mřížek a hladina Labe

Souřadnice scény: 1 jednotka = 10 m, x = východ, z = jih, počátek 50.4253 N, 14.2618 E.
Použití: python3 tools/build_real.py [adresář_mezipaměti]
"""
import io
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image

LAT0, LON0 = 50.4253, 14.2618
R = 6378137.0
K = math.cos(math.radians(LAT0))
DMR = 'https://ags.cuzk.cz/arcgis2/rest/services/dmr5g/ImageServer/exportImage'
DMP = 'https://ags.cuzk.cz/arcgis2/rest/services/dmp1g/ImageServer/exportImage'
ORTO = 'https://ags.cuzk.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/export'
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'data', 'real')

# rect = (x0, z0, x1, z1) v jednotkách scény; grid = (sloupce, řádky)
TILES = {
    'far': {'rect': (-800, -800, 800, 800), 'dmr': (640, 640), 'orto': (4096, 4096)},
    'mid': {'rect': (-320, -300, 320, 260), 'dmr': (640, 560), 'dmp': (800, 700), 'orto': (4096, 3584)},
    'core': {'rect': (-120, -110, 120, 130), 'dmp': (960, 960), 'orto': (4096, 4096)},
}
# Jemná data jen pro výpočet výšek budov (nepublikují se).
ANALYSIS = {'rect': (-440, -280, 310, 290), 'grid': (3750, 2850)}


def merc(lat, lon):
    return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def local_to_merc(x, z):
    # inverzní k převodu v tools/build_geo.py (rovnoběžkové měřítko 111 320 m, poledníkové 110 574 m)
    lat = LAT0 - z * 10 / 110574
    lon = LON0 + x * 10 / (111320 * K)
    return merc(lat, lon)


def merc_bbox(rect):
    x0, z0, x1, z1 = rect
    ax, ay = local_to_merc(x0, z1)  # jihozápadní roh
    bx, by = local_to_merc(x1, z0)  # severovýchodní roh
    return '%f,%f,%f,%f' % (ax, ay, bx, by)


def fetch(url, params, path):
    if os.path.exists(path):
        with open(path, 'rb') as f:
            return f.read()
    q = dict(params, bboxSR=3857, imageSR=3857, f='json')
    meta = json.load(urllib.request.urlopen(url + '?' + urllib.parse.urlencode(q), timeout=300))
    if 'href' not in meta:
        raise RuntimeError('%s: %s' % (url, meta))
    print('stahuji', os.path.basename(path), file=sys.stderr)
    data = urllib.request.urlopen(meta['href'], timeout=600).read()
    with open(path, 'wb') as f:
        f.write(data)
    return data


def raster(url, rect, grid, path):
    data = fetch(url, {
        'bbox': merc_bbox(rect), 'size': '%d,%d' % grid, 'format': 'tiff', 'pixelType': 'F32',
        'interpolation': 'RSP_BilinearInterpolation', 'noData': -9999,
    }, path)
    a = np.array(Image.open(io.BytesIO(data)), dtype=np.float32)
    if (a < -1000).any():  # díry (např. hladina řeky bez odrazu) doplníme okolím
        bad = a < -1000
        a[bad] = np.median(a[~bad])
    return a


def save_u16(a, name):
    q = np.clip(np.round((a - 100.0) * 10.0), 0, 65535).astype('<u2')
    q.tofile(os.path.join(OUT, name))


def sample(a, rect, x, z):
    """Bilineární vzorek mřížky (středy pixelů) v bodech scény."""
    x0, z0, x1, z1 = rect
    h, w = a.shape
    fx = np.clip((x - x0) / (x1 - x0) * w - 0.5, 0, w - 1.001)
    fz = np.clip((z - z0) / (z1 - z0) * h - 0.5, 0, h - 1.001)
    i, j = np.floor(fx).astype(int), np.floor(fz).astype(int)
    u, v = fx - i, fz - j
    return (a[j, i] * (1 - u) * (1 - v) + a[j, i + 1] * u * (1 - v) +
            a[j + 1, i] * (1 - u) * v + a[j + 1, i + 1] * u * v)


def main():
    cache = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '.real-cache')
    os.makedirs(cache, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    meta = {'base': 100.0, 'scale': 0.1, 'tiles': {}}
    grids = {}
    for name, t in TILES.items():
        meta['tiles'][name] = {'rect': t['rect']}
        for kind, url in (('dmr', DMR), ('dmp', DMP)):
            if kind in t:
                a = raster(url, t['rect'], t[kind], os.path.join(cache, '%s_%s.tif' % (name, kind)))
                save_u16(a, '%s_%s.bin' % (name, kind))
                grids[(name, kind)] = a
                meta['tiles'][name][kind] = list(t[kind])
        jpg = fetch(ORTO, {'bbox': merc_bbox(t['rect']), 'size': '%d,%d' % t['orto'], 'format': 'jpg',
                           'transparent': 'false'}, os.path.join(cache, '%s_orto.jpg' % name))
        Image.open(io.BytesIO(jpg)).convert('RGB').save(os.path.join(OUT, '%s_orto.jpg' % name), quality=82,
                                                         optimize=True, progressive=True)

    # Hladina Labe: nejnižší terén v příčném profilu kolem osy řeky.
    geo = open(os.path.join(ROOT, 'js', 'geo.js'), encoding='utf-8').read()
    river = json.loads(re.search(r'export const RIVER = (\[.*?\]);', geo).group(1))
    pts = np.array(river, dtype=np.float64).reshape(-1, 2)
    levels = []
    for i, (x, z) in enumerate(pts):
        a, b = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]
        dx, dz = b - a
        n = math.hypot(dx, dz) or 1
        nx, nz = -dz / n, dx / n
        offs = np.linspace(-6, 6, 25)
        grid, rect = ((grids[('mid', 'dmr')], TILES['mid']['rect'])
                      if -320 < x < 320 and -300 < z < 260 else (grids[('far', 'dmr')], TILES['far']['rect']))
        levels.append(float(np.min(sample(grid, rect, x + nx * offs, z + nz * offs))))
    # vyhlazení a zaokrouhlení
    lv = np.array(levels)
    lv = np.convolve(np.pad(lv, 2, mode='edge'), np.ones(5) / 5, mode='valid')
    meta['riverLevel'] = [round(float(v), 2) for v in lv]

    # Výšky budov z normalizovaného modelu povrchu (DMP − DMR) uvnitř půdorysu.
    ar = ANALYSIS['rect']
    dmp = raster(DMP, ar, ANALYSIS['grid'], os.path.join(cache, 'analysis_dmp.tif'))
    dmr = raster(DMR, ar, ANALYSIS['grid'], os.path.join(cache, 'analysis_dmr.tif'))
    ndsm = dmp - dmr
    b = np.array(json.loads(re.search(r'export const BUILDINGS = (\[.*?\]);', geo).group(1)),
                 dtype=np.float64).reshape(-1, 7)
    out = np.zeros((len(b), 2), dtype='<u2')
    us, vs = np.meshgrid(np.linspace(-0.4, 0.4, 7), np.linspace(-0.4, 0.4, 7))
    us, vs = us.ravel(), vs.ravel()
    for k, (cx, cz, w, d, ang, _lv, _kind) in enumerate(b):
        c, s = math.cos(ang), math.sin(ang)
        lx, lz = us * w, vs * d
        x = cx + lx * c - lz * s
        z = cz + lx * s + lz * c
        if not (ar[0] < cx < ar[2] and ar[1] < cz < ar[3]):
            continue
        h = sample(ndsm, ar, x, z)
        eave, ridge = np.percentile(h, 35), np.percentile(h, 92)
        if ridge < 2.0:  # budova postavená po roce 2013 nebo chyba dat
            continue
        out[k] = (round(max(eave, 2.0) * 100), round(max(ridge, eave) * 100))
    out.tofile(os.path.join(OUT, 'bheights.bin'))
    with open(os.path.join(OUT, 'meta.json'), 'w') as f:
        json.dump(meta, f, separators=(',', ':'))
    print('hotovo, budov s výškou: %d / %d' % ((out[:, 1] > 0).sum(), len(b)), file=sys.stderr)


if __name__ == '__main__':
    main()
