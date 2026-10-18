#!/usr/bin/env python3
"""3D model současné zástavby z měřených dat.

  - půdorysy budov: OpenStreetMap (© přispěvatelé OSM, ODbL) – mezipaměť z tools/build_geo.py,
  - tvar střech a výška: lidar ČÚZK DMP 1G (povrch) a DMR 5G (terén), 2009–2013,
  - barvy střech: ortofoto ČÚZK (UV souřadnice do dlaždic data/real/*_orto.jpg),
  - stromy: vrcholy korun z normalizovaného modelu povrchu mimo budovy.

Výstup: data/real/city.bin + data/real/city.json (popis bloků), data/real/trees.bin.
Spouštět po tools/build_geo.py a tools/build_real.py (používá jejich mezipaměti):
  python3 tools/build_city.py <osm_cache> <real_cache>
"""
import glob
import io
import json
import math
import os
import sys

import numpy as np
from PIL import Image
from scipy.spatial import Delaunay

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_real as br  # noqa: E402  (sdílené rozsahy a převody)

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'data', 'real')
STEP_EDGE = 0.35    # zahuštění obrysu (3,5 m)
STEP_GRID = 0.3     # vnitřní body střechy (3 m)
INSETS = tuple(np.arange(0.06, 1.3, 0.06))  # hledání okraje střechy 0,6–13 m uvnitř půdorysu


def local(lat, lon):
    return ((lon - br.LON0) * 111320 * br.K / 10, -(lat - br.LAT0) * 110574 / 10)


def ring_area(r):
    return 0.5 * sum(r[i][0] * r[i - 1][1] - r[i - 1][0] * r[i][1] for i in range(len(r)))


def point_in_ring(x, z, ring):
    inside = np.zeros_like(x, dtype=bool)
    n = len(ring)
    for i in range(n):
        x1, z1 = ring[i]
        x2, z2 = ring[(i + 1) % n]
        cond = ((z1 > z) != (z2 > z)) & (x < (x2 - x1) * (z - z1) / ((z2 - z1) or 1e-12) + x1)
        inside ^= cond
    return inside


def load_buildings(osm_cache):
    E = {}
    for f in glob.glob(os.path.join(osm_cache, 'map_*.json')):
        for e in json.load(open(f))['elements']:
            E[(e['type'], e['id'])] = e
    nodes = {k[1]: (e['lat'], e['lon']) for k, e in E.items() if k[0] == 'node'}
    ways = {k[1]: e for k, e in E.items() if k[0] == 'way'}

    def ring(nids):
        pts = [local(*nodes[n]) for n in nids if n in nodes]
        if len(pts) > 2 and pts[0] == pts[-1]:
            pts = pts[:-1]
        return pts if len(pts) >= 3 else None

    out = []
    used = set()
    for k, e in E.items():
        if k[0] != 'relation':
            continue
        t = e.get('tags', {})
        if t.get('type') != 'multipolygon' or 'building' not in t:
            continue
        outers, inners = [], []
        for m in e['members']:
            if m['type'] == 'way' and m['ref'] in ways:
                r = ring(ways[m['ref']]['nodes'])
                if r:
                    (inners if m.get('role') == 'inner' else outers).append(r)
                    used.add(m['ref'])
        for o in outers:
            out.append({'outer': o, 'inner': inners, 'tags': t})
    for wid, w in ways.items():
        t = w.get('tags', {})
        if 'building' not in t or wid in used:
            continue
        r = ring(w['nodes'])
        if r:
            out.append({'outer': r, 'inner': [], 'tags': t})
    return out


def densify(ring, step):
    pts, norms = [], []
    n = len(ring)
    ccw = ring_area(ring) > 0  # v souřadnicích x (východ), z (jih)
    for i in range(n):
        ax, az = ring[i]
        bx, bz = ring[(i + 1) % n]
        L = math.hypot(bx - ax, bz - az)
        if L < 1e-6:
            continue
        dx, dz = (bx - ax) / L, (bz - az) / L
        # normála směřující dovnitř polygonu
        nx, nz = (-dz, dx) if ccw else (dz, -dx)
        k = max(1, int(math.ceil(L / step)))
        for j in range(k):
            pts.append((ax + dx * L * j / k, az + dz * L * j / k))
            norms.append((nx, nz))
    return np.array(pts), np.array(norms)


def main():
    osm_cache, real_cache = sys.argv[1], sys.argv[2]
    ar = br.ANALYSIS['rect']
    dmp = br.raster(br.DMP, ar, br.ANALYSIS['grid'], os.path.join(real_cache, 'analysis_dmp.tif'))
    dmr = br.raster(br.DMR, ar, br.ANALYSIS['grid'], os.path.join(real_cache, 'analysis_dmr.tif'))
    tiles = {k: br.TILES[k]['rect'] for k in ('core', 'mid')}
    S = lambda a, x, z: br.sample(a, ar, np.asarray(x, float), np.asarray(z, float))  # noqa: E731

    blds = load_buildings(osm_cache)
    print('budov z OSM:', len(blds), file=sys.stderr)
    chunks = {'core': {'roof': ([], [], []), 'wall': ([], [], [])}, 'mid': {'roof': ([], [], []), 'wall': ([], [], [])}}
    mask = np.zeros(dmp.shape, dtype=bool)
    H, W = dmp.shape
    stats = {'lidar': 0, 'flat_default': 0}
    rng = np.random.default_rng(1167)

    for b in blds:
        outer = b['outer']
        xs = [p[0] for p in outer]
        zs = [p[1] for p in outer]
        cx, cz = sum(xs) / len(xs), sum(zs) / len(zs)
        tile = 'core' if (tiles['core'][0] < cx < tiles['core'][2] and tiles['core'][1] < cz < tiles['core'][3]) else \
            'mid' if (tiles['mid'][0] < cx < tiles['mid'][2] and tiles['mid'][1] < cz < tiles['mid'][3]) else None
        if tile is None or not (ar[0] < min(xs) and max(xs) < ar[2] and ar[1] < min(zs) and max(zs) < ar[3]):
            continue
        area = abs(ring_area(outer))
        if area < 0.08:
            continue
        # obrys (vnější i dvorky)
        rings = [outer] + b['inner']
        bpts, bnorm, bring = [], [], []
        for ri, r in enumerate(rings):
            p, nrm = densify(r, STEP_EDGE)
            if ri > 0:
                nrm = -nrm  # u dvorků leží budova vně obrysu
            bpts.append(p)
            bnorm.append(nrm)
            bring.append(np.full(len(p), ri))
        bp = np.concatenate(bpts)
        bn = np.concatenate(bnorm)
        # vnitřní body střechy
        gx = np.arange(min(xs) + STEP_GRID / 2, max(xs), STEP_GRID)
        gz = np.arange(min(zs) + STEP_GRID / 2, max(zs), STEP_GRID)
        GX, GZ = np.meshgrid(gx, gz)
        GX, GZ = GX.ravel(), GZ.ravel()
        inside = point_in_ring(GX, GZ, outer)
        for r in b['inner']:
            inside &= ~point_in_ring(GX, GZ, r)
        # nechceme vnitřní body těsně u obrysu
        ip = np.stack([GX[inside], GZ[inside]], 1)
        if len(ip):
            d = np.min(np.hypot(ip[:, None, 0] - bp[None, :, 0], ip[:, None, 1] - bp[None, :, 1]), axis=1)
            ip = ip[d > 0.2]
        # výšky
        ground = S(dmr, bp[:, 0], bp[:, 1])
        base = float(np.min(ground)) - 0.5
        # Okap: od obrysu postupujeme dovnitř, dokud lidar nenarazí na budovu (obrys v OSM bývá o pár metrů
        # větší nebo posunutý a lidar je na hranách rozmazaný). Bereme výšku kousek za touto hranou.
        prof = np.array([S(dmp, bp[:, 0] + bn[:, 0] * d, bp[:, 1] + bn[:, 1] * d) for d in INSETS])
        rel = prof - ground[None, :]
        hit = rel > 2.0
        first = np.where(hit.any(axis=0), hit.argmax(axis=0), -1)
        eaveSamples = np.full(len(bp), base + 0.5 + 1.8)
        for j, f in enumerate(first):
            if f >= 0:
                eaveSamples[j] = prof[min(f + 2, len(INSETS) - 1), j] if f + 2 < len(INSETS) else prof[f:, j].max()
        interior = S(dmp, ip[:, 0], ip[:, 1]) if len(ip) else np.zeros(0)
        allr = np.concatenate([eaveSamples, interior]) - (base + 0.5)
        if np.percentile(allr, 80) < 2.0:
            # budova chybí v lidaru (postavena po roce 2013) – plochá střecha podle podlaží
            try:
                lv = float(b['tags'].get('building:levels', '1'))
            except ValueError:
                lv = 1
            top = base + 0.5 + max(2.6, lv * 3.0 + 0.4)
            eaveSamples[:] = top
            ip = ip[:0]
            interior = np.zeros(0)
            stats['flat_default'] += 1
        else:
            stats['lidar'] += 1
            floor = base + 0.5 + 1.8
            eaveSamples = np.maximum(eaveSamples, floor)
            interior = np.maximum(interior, floor)
            # plochá střecha – stačí obrys
            if len(interior) and np.std(np.concatenate([eaveSamples, interior])) < 0.35:
                med = float(np.median(np.concatenate([eaveSamples, interior])))
                eaveSamples[:] = med
                ip = ip[:0]
                interior = np.zeros(0)
        # trojúhelníky střechy
        rp = np.concatenate([bp, ip]) if len(ip) else bp
        ry = np.concatenate([eaveSamples, interior]) if len(ip) else eaveSamples
        try:
            tri = Delaunay(rp).simplices
        except Exception:
            continue
        c = rp[tri].mean(axis=1)
        keep = point_in_ring(c[:, 0], c[:, 1], outer)
        for r in b['inner']:
            keep &= ~point_in_ring(c[:, 0], c[:, 1], r)
        tri = tri[keep]
        if not len(tri):
            continue
        pos, uv, idx = chunks[tile]['roof']
        off = sum(len(p) for p in pos)
        pos.append(np.column_stack([rp[:, 0], ry, rp[:, 1]]))
        idx.append(tri + off)
        # stěny: pro každý úsek obrysu čtyřúhelník od základu k okapu
        pos2, col2, idx2 = chunks[tile]['wall']
        off2 = sum(len(p) for p in pos2)
        wv, wi = [], []
        shade = int(200 + 40 * rng.random())  # světlost omítky (neznámá barva fasády → neutrální)
        start = 0
        for p in bpts:
            n = len(p)
            ys = eaveSamples[start:start + n]
            v0 = len(wv)
            for j in range(n):  # dva sdílené vrcholy na bod obrysu: pata a okap
                wv += [(p[j][0], base, p[j][1]), (p[j][0], ys[j], p[j][1])]
            for j in range(n):
                k = (j + 1) % n
                a0, a1, b0, b1 = v0 + 2 * j, v0 + 2 * j + 1, v0 + 2 * k, v0 + 2 * k + 1
                wi += [(a0, b0, b1), (a0, b1, a1)]
            start += n
        wv = np.array(wv)
        pos2.append(wv)
        col2.append(np.full(len(wv), shade, dtype=np.uint8))
        idx2.append(np.array(wi) + off2)
        # maska budov pro hledání stromů
        fx = ((np.array(xs) - ar[0]) / (ar[2] - ar[0]) * W)
        fz = ((np.array(zs) - ar[1]) / (ar[3] - ar[1]) * H)
        i0, i1 = max(0, int(fx.min()) - 1), min(W, int(fx.max()) + 2)
        j0, j1 = max(0, int(fz.min()) - 1), min(H, int(fz.max()) + 2)
        if i1 > i0 and j1 > j0:
            II, JJ = np.meshgrid(np.arange(i0, i1), np.arange(j0, j1))
            px = ar[0] + (II + 0.5) / W * (ar[2] - ar[0])
            pz = ar[1] + (JJ + 0.5) / H * (ar[3] - ar[1])
            m = point_in_ring(px.ravel(), pz.ravel(), outer).reshape(px.shape)
            mask[j0:j1, i0:i1] |= m

    # zápis bloků: pozice Float32 (x, výška v m, z), UV / barvy, indexy Uint32
    blocks, buf = [], io.BytesIO()

    def put(arr, dtype):
        a = np.ascontiguousarray(arr, dtype=dtype)
        o = buf.tell()
        buf.write(a.tobytes())
        while buf.tell() % 4:
            buf.write(b'\0')
        return [o, a.size]

    for tile, kinds in chunks.items():
        r = tiles[tile]
        for kind, (pos, extra, idx) in kinds.items():
            if not pos:
                continue
            P = np.concatenate(pos)
            I = np.concatenate(idx).astype(np.uint32)
            # x, z: setiny jednotky (10 cm), výška: decimetry nad 100 m n. m.
            Q = np.column_stack([np.round(P[:, 0] * 100), np.round((P[:, 1] - 100) * 10), np.round(P[:, 2] * 100)])
            assert np.abs(Q[:, [0, 2]]).max() < 32767
            blk = {'tile': tile, 'kind': kind, 'pos': put(Q, '<i2'), 'idx': put(I, '<u4')}
            if kind == 'wall':
                blk['shade'] = put(np.concatenate(extra), 'u1')
            blocks.append(blk)
            print(tile, kind, 'vrcholů', len(P), 'trojúhelníků', len(I) // 3, file=sys.stderr)
    with open(os.path.join(OUT, 'city.bin'), 'wb') as f:
        f.write(buf.getvalue())

    # stromy: lokální maxima normalizovaného povrchu mimo budovy
    ndsm = dmp - dmr
    veg = (ndsm > 3.0) & ~mask
    from numpy.lib.stride_tricks import sliding_window_view as swv
    pad = np.pad(np.where(veg, ndsm, 0), 2)
    mx = swv(pad, (5, 5)).max(axis=(2, 3))
    tops = veg & (ndsm >= mx) & (ndsm > 3.0)
    jj, ii = np.nonzero(tops)
    x = ar[0] + (ii + 0.5) / W * (ar[2] - ar[0])
    z = ar[1] + (jj + 0.5) / H * (ar[3] - ar[1])
    h = ndsm[jj, ii]
    g = dmr[jj, ii]
    # barva koruny z ortofota (široké okolí)
    orto = np.asarray(Image.open(os.path.join(OUT, 'mid_orto.jpg')).convert('RGB'), dtype=np.float32)
    mr = tiles['mid']
    oi = np.clip(((x - mr[0]) / (mr[2] - mr[0]) * orto.shape[1]).astype(int), 0, orto.shape[1] - 1)
    oj = np.clip(((z - mr[1]) / (mr[3] - mr[1]) * orto.shape[0]).astype(int), 0, orto.shape[0] - 1)
    inmid = (x > mr[0]) & (x < mr[2]) & (z > mr[1]) & (z < mr[3])
    c = orto[oj, oi]
    c[~inmid] = (70, 95, 55)
    rec = np.zeros(len(x), dtype=[('x', '<f4'), ('z', '<f4'), ('g', '<f4'), ('h', '<f4'), ('c', 'u1', 3), ('p', 'u1')])
    rec['x'], rec['z'], rec['g'], rec['h'], rec['c'] = x, z, g, h, np.clip(c, 0, 255).astype(np.uint8)
    rec.tofile(os.path.join(OUT, 'trees.bin'))
    json.dump({'blocks': blocks, 'trees': int(len(rec))}, open(os.path.join(OUT, 'city.json'), 'w'))
    print('stromů', len(rec), stats, file=sys.stderr)


if __name__ == '__main__':
    main()
