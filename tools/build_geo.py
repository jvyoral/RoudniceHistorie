#!/usr/bin/env python3
"""Vygeneruje js/geo.js z dat OpenStreetMap (© přispěvatelé OpenStreetMap, licence ODbL).

Stáhne (nebo načte z mezipaměti) výřezy mapy okolí Roudnice nad Labem přes OSM API 0.6,
převede je do lokálních souřadnic scény (1 jednotka = 10 m, x = východ, z = jih,
počátek ve středu města) a uloží:
  - tok Labe,
  - železniční tratě,
  - silnice a ulice,
  - půdorysy budov (jako natočené obdélníky).

Použití:  python3 tools/build_geo.py [adresář_mezipaměti]
"""
import json
import math
import os
import sys
import urllib.request

LAT0, LON0 = 50.4253, 14.2618
API = 'https://api.openstreetmap.org/api/0.6/'
UA = {'User-Agent': 'RoudniceHistorie/1.0 (build script)'}
BBOXES = {
    'c': (14.240, 50.415, 14.280, 50.435),  # centrum
    'w': (14.200, 50.410, 14.240, 50.435),  # Podlusky
    'n': (14.235, 50.435, 14.280, 50.448),  # Vědomice
    'e': (14.280, 50.410, 14.305, 50.450),  # Dobříň, Kyškovice
    's': (14.225, 50.400, 14.290, 50.415),  # jih města
}
RIVER_WAYS = [514836866, 514836868, 514836869, 514836870, 514836871]


def local(lat, lon):
    x = (lon - LON0) * 111320 * math.cos(math.radians(LAT0)) / 10
    z = -(lat - LAT0) * 110574 / 10
    return (x, z)


def fetch(url, path):
    if not os.path.exists(path):
        print('stahuji', url, file=sys.stderr)
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=180) as r, open(path, 'wb') as f:
            f.write(r.read())
    with open(path) as f:
        return json.load(f)


def convex_hull(pts):
    pts = sorted(set(pts))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def min_rect(pts):
    """Obdélník s nejmenší plochou: (cx, cz, šířka podél osy, hloubka, úhel osy)."""
    hull = convex_hull(pts)
    best = None
    for i in range(len(hull)):
        ax, az = hull[i]
        bx, bz = hull[(i + 1) % len(hull)]
        ang = math.atan2(bz - az, bx - ax)
        c, s = math.cos(ang), math.sin(ang)
        us = [x * c + z * s for x, z in hull]
        vs = [-x * s + z * c for x, z in hull]
        area = (max(us) - min(us)) * (max(vs) - min(vs))
        if best is None or area < best[0]:
            u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
            uc, vc = (u0 + u1) / 2, (v0 + v1) / 2
            best = (area, uc * c - vc * s, uc * s + vc * c, u1 - u0, v1 - v0, ang)
    _, cx, cz, w, d, ang = best
    if d > w:  # delší strana jako „šířka“ (podél hřebene)
        w, d, ang = d, w, ang + math.pi / 2
    return cx, cz, w, d, ang


def poly_area(ps):
    return abs(sum(ps[i][0] * ps[i - 1][1] - ps[i - 1][0] * ps[i][1] for i in range(len(ps)))) / 2


KIND = {
    'residential': 'res', 'house': 'res', 'detached': 'res', 'semidetached_house': 'res',
    'terrace': 'res', 'apartments': 'res', 'yes': 'res', 'hotel': 'res', 'construction': 'res',
    'garage': 'gar', 'garages': 'gar', 'shed': 'gar', 'roof': 'gar', 'carport': 'gar', 'cabin': 'gar',
    'hut': 'gar', 'outbuilding': 'gar', 'transformer_tower': 'gar', 'service': 'gar',
    'industrial': 'ind', 'warehouse': 'ind', 'transportation': 'ind', 'manufacture': 'ind',
    'commercial': 'shop', 'retail': 'shop', 'supermarket': 'shop', 'mall': 'shop',
    'civic': 'civ', 'school': 'civ', 'hospital': 'civ', 'fire_station': 'civ', 'public': 'civ',
    'barn': 'farm', 'farm_auxiliary': 'farm', 'farm': 'farm',
}
KIND_CODE = {'res': 0, 'gar': 1, 'ind': 2, 'shop': 3, 'civ': 4, 'farm': 5}
STREETS = {'motorway': 'm', 'trunk': 'p', 'primary': 'p', 'secondary': 'p', 'tertiary': 't',
           'residential': 'r', 'unclassified': 'r', 'living_street': 'r', 'pedestrian': 'r',
           'secondary_link': 't'}
# Plochy, kde stojí ručně modelované památky – budovy z OSM tam vynecháme.
EXCLUDE = [(-9, -10, 6, 3), (-39, -17, -31, -11), (-20, -6, -16, -2), (-55, -27, -49, -21),
           (10, -1, 19, 6), (5, -12, 24, -6)]


def r1(v):
    return round(v, 1)


def main():
    cache = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '.osm-cache')
    os.makedirs(cache, exist_ok=True)
    E = {}
    for key, bb in BBOXES.items():
        data = fetch(API + 'map.json?bbox=%s,%s,%s,%s' % bb, os.path.join(cache, 'map_%s.json' % key))
        for e in data['elements']:
            E[(e['type'], e['id'])] = e
    nodes = {k[1]: (e['lat'], e['lon']) for k, e in E.items() if k[0] == 'node'}
    ways = [e for k, e in E.items() if k[0] == 'way']

    def pts_of(w):
        return [local(*nodes[n]) for n in w['nodes'] if n in nodes]

    # --- Labe ---
    river = []
    for wid in RIVER_WAYS:
        d = fetch(API + 'way/%d/full.json' % wid, os.path.join(cache, 'river_%d.json' % wid))
        nd = {e['id']: (e['lat'], e['lon']) for e in d['elements'] if e['type'] == 'node'}
        w = [e for e in d['elements'] if e['type'] == 'way'][0]
        p = [local(*nd[n]) for n in w['nodes']]
        river += p if not river else p[1:]

    # --- budovy ---
    buildings = []
    for w in ways:
        t = w.get('tags', {})
        if 'building' not in t or len(w['nodes']) < 4:
            continue
        ps = pts_of(w)
        if len(ps) < 3:
            continue
        area = poly_area(ps)
        if area < 0.12:
            continue
        cx, cz, bw, bd, ang = min_rect(ps)
        if any(x0 < cx < x1 and z0 < cz < z1 for x0, z0, x1, z1 in EXCLUDE):
            continue
        kind = KIND.get(t['building'], 'res')
        if kind == 'gar' and area < 0.3:
            continue  # drobné kůlny a chatky by v měřítku modelu jen rušily
        try:
            lv = int(float(t.get('building:levels', '-1')))
        except ValueError:
            lv = -1
        buildings += [r1(cx), r1(cz), r1(bw), r1(bd), round(ang, 3), lv, KIND_CODE[kind]]

    # --- silnice a koleje ---
    streets, rails = [], []
    for w in ways:
        t = w.get('tags', {})
        ps = [(r1(x), r1(z)) for x, z in pts_of(w)]
        if len(ps) < 2:
            continue
        if t.get('highway') in STREETS:
            cls = STREETS[t['highway']]
            if t.get('ref') == '246' and sum(z for _, z in ps) / len(ps) > 95 and \
                    all(-290 < x < 85 for x, _ in ps):
                cls = 'b'  # obchvat
            elif t.get('ref') in ('240', '246'):
                cls = 'h'  # historická zemská cesta
            streets.append({'c': cls, 'p': [c for p in ps for c in p]})
        elif t.get('railway') == 'rail':
            u = t.get('usage') or ('yard' if t.get('service') else 'branch')
            rails.append({'u': {'main': 'm', 'branch': 'b'}.get(u, 'y'), 'p': [c for p in ps for c in p]})

    out = {
        'RIVER': [c for p in river for c in (r1(p[0]), r1(p[1]))],
        'BUILDINGS': buildings,
        'STREETS': streets,
        'RAILS': rails,
    }
    target = os.path.join(os.path.dirname(__file__), '..', 'js', 'geo.js')
    with open(target, 'w') as f:
        f.write('// Vygenerováno skriptem tools/build_geo.py z dat © přispěvatelé OpenStreetMap (ODbL).\n')
        f.write('// Lokální souřadnice: 1 jednotka = 10 m, x = východ, z = jih, počátek 50.4253 N, 14.2618 E.\n')
        for k, v in out.items():
            f.write('export const %s = %s;\n' % (k, json.dumps(v, separators=(',', ':'))))
    print('budov: %d, ulic: %d, kolejí: %d, bodů řeky: %d' % (
        len(buildings) // 7, len(streets), len(rails), len(river)), file=sys.stderr)


if __name__ == '__main__':
    main()
