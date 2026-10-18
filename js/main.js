import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  YEAR_MIN, YEAR_MAX, EVENTS, CATEGORIES, POPULATION, SOURCES,
  populationAt, eraAt,
} from './data.js';
import { RIVER, BUILDINGS, STREETS, RAILS } from './geo.js';
import { loadRealData, buildRealMeshes } from './real.js';
import { OVERLAYS, buildOverlay } from './hist.js';

// ---------------------------------------------------------------------------
// Pomocné funkce
// ---------------------------------------------------------------------------

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function hash2(x, z) {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, z * f);
    n += a; a *= 0.5; f *= 2.03;
  }
  return s / n;
}
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1167);
const rr = (a, b) => a + (b - a) * rand();

// Po částech lineární funkce [[rok, hodnota], ...]
function piecewise(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
function polyDist(px, pz, pts) {
  let m = Infinity;
  for (let i = 1; i < pts.length; i++) {
    m = Math.min(m, segDist(px, pz, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  }
  return m;
}
function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function densify(pts, step) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k++) out.push([lerp(ax, bx, k / n), lerp(az, bz, k / n)]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
const pairs = (flat) => {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
};
const col = (s) => new THREE.Color(s);

// ---------------------------------------------------------------------------
// Geografie (souřadnice z OpenStreetMap, 1 jednotka = 10 m, x = východ, z = jih)
// ---------------------------------------------------------------------------

const RIVER_W = 6.5;              // poloviční šířka Labe (~130 m)
const RIP = [197, 429];           // vrchol Řípu
const CASTLE = [-1.5, -3.5];      // zámek
const SQUARE = [-14, 8];          // Karlovo náměstí
const TOWN = [-15, 30];           // přibližný střed dnešní zástavby
const BRIDGE = [[-6, -19], [3, -50]]; // osa mostu přes Labe
const TERRAIN_SIZE = 1600;
const TERRAIN_SEG = 320;

// Hradby Starého Města (schematicky)
const WALLS = [[-8, -8], [-18, -4], [-30, -8], [-46, -10], [-53, 5], [-46, 25], [-20, 30], [0, 25], [6, 10], [4, 1]];
const WALLS_CLOSED = [...WALLS, WALLS[0]];
// Obce v okolí: [název, x, z, poloměr jádra, orientační vznik]
const VILLAGES = [
  ['Vědomice', -56, -95, 16, 1400],
  ['Dobříň', 226, -136, 14, 1230],
  ['Podlusky', -250, 48, 12, 1200],
  ['Kyškovice', 172, -251, 12, 1200],
  ['Vesce', 191, 217, 10, 1250],
  ['Zavadilka', 0, -180, 6, 1750],
];
// Vzdálenější obce – jen schematická zástavba
const FAR_VILLAGES = [
  ['Černěves', -133, -322], ['Hrobce', -220, -411], ['Chodouny', -80, -529], ['Libotenice', -231, -571],
  ['Krabčice', 280, 220], ['Bechlín', 560, 100], ['Kleneč', -96, 362], ['Přestavlky', -482, 241],
  ['Dušníky', -508, 8], ['Mnetěš', 141, 661], ['Ctiněves', 321, 562], ['Kostomlaty pod Řípem', 506, 470],
  ['Záluží', 403, -355], ['Račice', 633, -398], ['Straškov', -83, 674], ['Račiněves', -306, 577],
];

// --- Labe: znaménková vzdálenost (kladná = pravý břeh / niva uvnitř oblouku) ---
const RIVER_PTS = pairs(RIVER);
function riverSignedExact(x, z) {
  let best = Infinity, sign = 1;
  for (let i = 1; i < RIVER_PTS.length; i++) {
    const [ax, az] = RIVER_PTS[i - 1], [bx, bz] = RIVER_PTS[i];
    const d = segDist(x, z, ax, az, bx, bz);
    if (d < best) {
      best = d;
      sign = (bx - ax) * (z - az) - (bz - az) * (x - ax) >= 0 ? 1 : -1;
    }
  }
  return best * sign;
}
const SD_CELL = 4, SD_N = Math.ceil(TERRAIN_SIZE / SD_CELL) + 3, SD_O = -TERRAIN_SIZE / 2 - SD_CELL;
const sdGrid = new Float32Array(SD_N * SD_N);
for (let j = 0; j < SD_N; j++) {
  for (let i = 0; i < SD_N; i++) sdGrid[j * SD_N + i] = riverSignedExact(SD_O + i * SD_CELL, SD_O + j * SD_CELL);
}
function riverSD(x, z) {
  const fx = clamp((x - SD_O) / SD_CELL, 0, SD_N - 1.001), fz = clamp((z - SD_O) / SD_CELL, 0, SD_N - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const k = j * SD_N + i;
  return lerp(lerp(sdGrid[k], sdGrid[k + 1], u), lerp(sdGrid[k + SD_N], sdGrid[k + SD_N + 1], u), v);
}

// Skutečný terén z DMR 5G (ČÚZK). Výšky jsou mírně převýšené kvůli čitelnosti.
const REAL = await loadRealData();
const VEX = 1.25;           // převýšení
const ELEV0 = 147;          // nadmořská výška odpovídající y = 0 (hladina Labe pod jezem)
const toY = (elev) => (elev - ELEV0) / 10 * VEX;
function height(x, z) {
  return toY(REAL.elevation(x, z));
}
// Hladina Labe v bodech osy řeky (z lidarových dat), pro libovolné místo podle nejbližšího bodu.
const RIVER_LEVEL = REAL.meta.riverLevel.map((e, i) => {
  const [x, z] = RIVER_PTS[i];
  return Math.abs(x) < 790 && Math.abs(z) < 790 ? e : null;
});
for (let i = 0; i < RIVER_LEVEL.length; i++) {
  if (RIVER_LEVEL[i] === null) RIVER_LEVEL[i] = RIVER_LEVEL.find((v) => v !== null);
}
function waterY(x, z) {
  let best = Infinity, lv = RIVER_LEVEL[0];
  RIVER_PTS.forEach(([px, pz], i) => {
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < best) { best = d; lv = RIVER_LEVEL[i]; }
  });
  return toY(lv);
}

// ---------------------------------------------------------------------------
// Scéna
// ---------------------------------------------------------------------------

const container = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const SKY = col('#a9cbe3');
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, 500, 1500);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 4000);
camera.position.set(-95, 150, -255);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 40);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = 1.45;
controls.minDistance = 12;
controls.maxDistance = 1200;
controls.update();

scene.add(new THREE.HemisphereLight(0xe4f0ff, 0x5a4d3a, 0.95));
const sun = new THREE.DirectionalLight(0xfff0d8, 1.9);
sun.position.set(-160, 260, 220);
sun.target.position.set(0, 0, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -280, right: 280, top: 280, bottom: -280, near: 10, far: 900 });
sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);

// --- terén ---------------------------------------------------------------

const terrainGeo = new THREE.PlaneGeometry(2, 2, TERRAIN_SEG, TERRAIN_SEG);
terrainGeo.rotateX(-Math.PI / 2);
const tPos = terrainGeo.attributes.position;
const VCOUNT = tPos.count;
// Mřížka je zhuštěná uprostřed (detail města) a řidší na okrajích.
const warp = (u) => (TERRAIN_SIZE / 2) * (0.35 * u + 0.65 * u * u * u);
const V = {
  x: new Float32Array(VCOUNT), z: new Float32Array(VCOUNT), h: new Float32Array(VCOUNT),
  d: new Float32Array(VCOUNT), forest: new Float32Array(VCOUNT), cult: new Float32Array(VCOUNT),
  rip: new Float32Array(VCOUNT), town: new Float32Array(VCOUNT), vary: new Float32Array(VCOUNT),
  cell: new Int32Array(VCOUNT),
};
for (let i = 0; i < VCOUNT; i++) {
  const x = warp(tPos.getX(i)), z = warp(tPos.getZ(i));
  const h = height(x, z);
  tPos.setXYZ(i, x, h, z);
  V.x[i] = x; V.z[i] = z; V.h[i] = h;
  V.d[i] = riverSD(x, z);
  V.forest[i] = fbm(x * 0.009 + 50, z * 0.009 - 20, 4);
  V.cult[i] = 0.6 * fbm(x * 0.004 + 10, z * 0.004 + 3, 3) + 0.4 * Math.min(1, Math.hypot(x, z) / 700);
  V.rip[i] = Math.hypot(x - RIP[0], z - RIP[1]);
  V.town[i] = Math.hypot(x - TOWN[0], z - TOWN[1]);
  V.vary[i] = 0.9 + 0.2 * vnoise(x * 0.3, z * 0.3);
}
terrainGeo.computeVertexNormals();
const tColors = new Float32Array(VCOUNT * 3);
terrainGeo.setAttribute('color', new THREE.BufferAttribute(tColors, 3));
const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
terrain.receiveShadow = true;
scene.add(terrain);

// --- voda: pás podél osy Labe ve výšce skutečné hladiny; terén nad hladinou ho zakryje ---
// Úzký pás = koryto, široký pás se zobrazí jen při povodni.
function riverSheet(W, color, opacity) {
  const pos = [], idx = [];
  const pts = RIVER_PTS.map((p, i) => [...p, toY(RIVER_LEVEL[i]) + 0.06]);
  const dense = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az, ay] = pts[i - 1], [bx, bz, by] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 3));
    for (let k = 0; k < n; k++) dense.push([lerp(ax, bx, k / n), lerp(az, bz, k / n), lerp(ay, by, k / n)]);
  }
  dense.forEach(([x, z, y], i) => {
    const a = dense[Math.max(0, i - 1)], b = dense[Math.min(dense.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    pos.push(x - tz * W, y, z + tx * W, x + tz * W, y, z - tx * W);
    if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshPhongMaterial({
    color, shininess: 90, specular: 0x88aacc, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
  }));
  m.receiveShadow = true;
  m.frustumCulled = false;
  scene.add(m);
  return m;
}
const water = riverSheet(24, 0x46778f, 1);
water.material.transparent = false;
water.material.depthWrite = true;
const floodWater = riverSheet(170, 0x6b7a66, 0.92);
floodWater.visible = false;

// ---------------------------------------------------------------------------
// Barvy krajiny podle období
// ---------------------------------------------------------------------------

const C = {
  bed: col('#4f4a3a'), sand: col('#a39874'), meadow: col('#7b9a46'), meadow2: col('#8aa552'),
  luh: col('#6c9142'), forest: col('#33522a'), forest2: col('#3f5f2e'), urban: col('#8c867a'),
  fieldsOld: ['#b3a35e', '#97984b', '#7f9246', '#8a7550', '#a89c5c', '#6f8c40'].map(col),
  fieldsNew: ['#cdb862', '#8aa648', '#5f8a3a', '#8c6f4e', '#c8b45c', '#7fa24a'].map(col),
  rapeseed: col('#d8d03e'),
};
const FOREST_TH = [[0, 0.47], [450, 0.44], [700, 0.46], [1000, 0.52], [1300, 0.58], [1700, 0.61], [1900, 0.63], [2026, 0.62]];
const CULT = [[0, 0.33], [400, 0.3], [500, 0.17], [650, 0.25], [900, 0.4], [1100, 0.55], [1250, 0.7], [1400, 0.86], [1500, 0.96], [2026, 0.96]];

function isForestAt(forestN, ripR, sd, townR, year) {
  if (ripR < 55) return forestN > 0.22;
  let th = piecewise(FOREST_TH, year);
  if (sd > RIVER_W && sd < RIVER_W + 45) th -= 0.06; // lužní lesy v nivě
  // okolí města je od raného středověku odlesněné (pole, pastviny, sady)
  th += 0.16 * smoothstep(800, 1250, year) * (1 - smoothstep(140, 300, townR));
  return forestN > th;
}

// Hustota zástavby (mřížka 4×4 jednotky) – ze zástavby se barví terén a mýtí stromy.
const GRID_N = 260, GRID_CELL = 4, GRID_O = -GRID_N * GRID_CELL / 2;
const density = new Float32Array(GRID_N * GRID_N);
const densityTmp = new Float32Array(GRID_N * GRID_N);
function gridIndex(x, z) {
  const i = Math.floor((x - GRID_O) / GRID_CELL), j = Math.floor((z - GRID_O) / GRID_CELL);
  if (i < 0 || j < 0 || i >= GRID_N || j >= GRID_N) return -1;
  return j * GRID_N + i;
}
for (let i = 0; i < VCOUNT; i++) V.cell[i] = gridIndex(V.x[i], V.z[i]);

const tmpC = new THREE.Color();
function colorTerrain(year) {
  const thForest = piecewise(FOREST_TH, year);
  const cult = piecewise(CULT, year);
  const modern = year >= 1955;
  const ang = 0.35, ca = Math.cos(ang), sa = Math.sin(ang);
  for (let i = 0; i < VCOUNT; i++) {
    const h = V.h[i], d = V.d[i], x = V.x[i], z = V.z[i];
    const dens = V.cell[i] >= 0 ? density[V.cell[i]] : 0;
    if (h < -0.05) {
      tmpC.copy(C.bed);
    } else if (Math.abs(d) < RIVER_W + 1.3 && h < 0.9) {
      tmpC.copy(C.sand);
    } else if (dens < 0.08 && isForestAt(V.forest[i], V.rip[i], d, V.town[i], year)) {
      tmpC.copy(V.forest[i] > thForest + 0.08 ? C.forest : C.forest2);
    } else if (V.cult[i] < cult && !(Math.abs(d) < RIVER_W + 28) && V.rip[i] > 40) {
      const u = x * ca + z * sa, v = -x * sa + z * ca;
      const ci = modern ? Math.floor(u / 52) : Math.floor(u / 7);
      const cj = modern ? Math.floor(v / 38) : Math.floor(v / 46);
      const hh = hash2(ci + 0.37, cj * 1.31 + 0.11);
      const pal = modern ? C.fieldsNew : C.fieldsOld;
      if (year >= 1985 && hh > 0.9) tmpC.copy(C.rapeseed);
      else tmpC.copy(pal[Math.floor(hh * pal.length) % pal.length]);
    } else {
      tmpC.copy(Math.abs(d) < RIVER_W + 40 ? C.luh : (V.forest[i] > 0.5 ? C.meadow : C.meadow2));
    }
    if (dens > 0) tmpC.lerp(C.urban, Math.min(0.85, dens * 1.1));
    const m = V.vary[i];
    tColors[i * 3] = tmpC.r * m; tColors[i * 3 + 1] = tmpC.g * m; tColors[i * 3 + 2] = tmpC.b * m;
  }
  terrainGeo.attributes.color.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Železnice a dálkové cesty mimo výřez mapy
// ---------------------------------------------------------------------------

// Hlavní trať Praha – Ústí (seřazená od východu k severu) pro jízdu vlaku.
const TRAIN_PATH = [
  [600, -480], [560, -462], [478, -376], [379, -272], [283, -171], [240, -127], [214, -98], [184, -68],
  [171, -55], [158, -44], [142, -37], [125, -31], [108, -26], [98, -23], [78, -17], [57, -13], [25, -13],
  [1, -16], [-14, -18], [-23, -19], [-42, -23], [-54, -26], [-70, -31], [-85, -36], [-105, -50], [-119, -61],
  [-133, -75], [-142, -88], [-152, -105], [-168, -146], [-186, -209], [-195, -243], [-205, -320],
  [-222, -420], [-240, -560], [-262, -800],
];
const RAIL_EXT_MAIN = [
  [[478, -376], [560, -462], [600, -480]],
  [[-195, -243], [-205, -320], [-222, -420], [-240, -560], [-262, -800]],
];
const RAIL_EXT_BRANCH = [[[-84.5, 287.9], [-84, 400], [-83, 560], [-80, 800]]];
// Staré zemské cesty k okolním obcím (mimo podrobný výřez mapy)
const LONG_ROADS = [
  [[-44, -328], [-70, -450], [-80, -529], [-100, -800]],     // na Chodouny
  [[-35, -295], [-133, -322]],                                // Černěves
  [[238, 176], [280, 220], [400, 300], [506, 470]],          // Krabčice – Kostomlaty
  [[280, 220], [250, 330], [215, 395]],                       // pod Říp
  [[280, 220], [420, 150], [560, 100], [800, 60]],          // Bechlín
  [[-232, 308], [-260, 400], [-306, 577], [-330, 800]],      // Račiněves
  [[-29, 170], [-60, 250], [-96, 362], [-83, 674], [-80, 800]], // Kleneč – Straškov
  [[-480, 114], [-482, 241]],                                 // Přestavlky
  [[-480, 114], [-508, 8], [-600, -60]],                      // Dušníky
  [[226, -136], [300, -250], [403, -355], [633, -398]],      // Záluží – Račice
  [[-80, -529], [-231, -571]],                                // Libotenice
  [[141, 661], [160, 500], [215, 470]],                       // Mnetěš
  [[321, 562], [260, 470]],                                   // Ctiněves
];

// ---------------------------------------------------------------------------
// Zástavba: půdorysy z OpenStreetMap + odhad doby vzniku podle polohy
// ---------------------------------------------------------------------------

const buildings = [];
const KINDS = ['res', 'gar', 'ind', 'shop', 'civ', 'farm'];

function inJewishQuarter(x, z) { return x > -80 && x < -44 && z > -32 && z < -8; }

// Vrací {type, start, end?} – kdy a jak budova na daném místě vznikla (schematicky).
function classify(x, z, kind, levels, w, d) {
  const r = rand();
  const dTown = Math.hypot(x - SQUARE[0], z - SQUARE[1]);
  if (polyDist(x, z, TRAIN_PATH) < 3.5) return { type: kind === 'gar' ? 'garage' : 'hall', start: 1850 + r * 60 };
  for (const [, vx, vz, vr, found] of VILLAGES) {
    const dv = Math.hypot(x - vx, z - vz);
    if (dv < vr) return { type: kind === 'farm' ? 'farm' : 'rural', start: found + r * 140 };
    if (dv < vr * 2.4) {
      return { type: kind === 'gar' ? 'garage' : kind === 'farm' ? 'farm' : 'rural', start: 1780 + r * 170 };
    }
  }
  if (kind === 'shop') return { type: 'shop', start: 1993 + r * 25 };
  if (kind === 'ind') {
    return { type: 'hall', start: 1868 + Math.min(1, dTown / 250) * 80 + r * 30, end: r < 0.2 ? 1992 + r * 80 : Infinity };
  }
  if (pointInPoly(x, z, WALLS)) {
    return { type: kind === 'gar' ? 'garage' : 'house', start: kind === 'gar' ? 1930 + r * 60 : 1230 + Math.min(1, dTown / 30) * 120 + r * 50 };
  }
  if (inJewishQuarter(x, z)) return { type: kind === 'gar' ? 'garage' : 'house', start: 1614 + r * 90 };
  const panel = levels >= 5 || (kind === 'res' && w >= 4.5 && d >= 1.0 && d <= 1.9 && w / d >= 2.8 && dTown > 40);
  if (panel) return { type: 'panel', start: 1962 + r * 28 };
  let ring;
  if (dTown < 55) ring = { type: 'house', start: 1420 + r * 380 };
  else if (dTown < 100) ring = { type: 'tenement', start: 1850 + r * 64 };
  else if (dTown < 150) ring = { type: 'villa', start: 1918 + r * 47 };
  else if (dTown < 320) ring = { type: 'modern', start: 1960 + Math.min(1, (dTown - 150) / 150) * 45 + r * 20 };
  else ring = { type: 'modern', start: 1950 + r * 76 };
  if (kind === 'gar') return { type: 'garage', start: Math.max(ring.start, 1925 + r * 60) };
  if (kind === 'farm') return { type: 'farm', start: Math.min(ring.start, 1750 + r * 200) };
  if (kind === 'civ') return { type: 'civic', start: Math.max(ring.start, 1870 + r * 100) };
  return ring;
}

const HEIGHTS = {
  house: [0.8, 1.2, 0.7], tenement: [1.3, 1.9, 0.6], villa: [0.7, 0.85, 0.55], modern: [0.6, 0.75, 0.45],
  rural: [0.55, 0.7, 0.55], farm: [0.6, 0.85, 0.6], garage: [0.25, 0.3, 0.03], hall: [0.9, 1.4, 0.25],
  shop: [0.7, 0.9, 0.03], civic: [1.2, 1.8, 0.4], panel: [2.4, 3.6, 0.03], hut: [0.3, 0.45, 0.6],
};
// Stáří zástavby podle dobových map (tools/build_hist.py): bit 0 = zakresleno na 2. vojenském
// mapování (1842–1852), bit 1 = na 3. vojenském mapování (1877–1880).
const HIST_FLAGS = await fetch('data/hist_flags.bin')
  .then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? new Uint8Array(b) : null)).catch(() => null);
function applyMapEvidence(c, flags, x, z, kind) {
  if (flags === undefined || kind === 'gar' || c.type === 'garage') return c;
  const r = rand();
  const inVillage = VILLAGES.some(([, vx, vz, vr]) => Math.hypot(x - vx, z - vz) < vr * 2.4);
  if (flags & 1) { // stálo už kolem roku 1845
    if (c.start <= 1842) return c;
    return { type: c.type === 'hall' ? 'hall' : inVillage ? 'rural' : 'house', start: 1650 + r * 190, end: c.end };
  }
  if (flags & 2) { // přibylo mezi oběma mapováními
    const type = c.type === 'hall' || c.type === 'civic' ? c.type : inVillage ? 'rural' : 'tenement';
    return { type, start: 1843 + r * 34, end: c.end };
  }
  if (c.start < 1880) { // na žádné z map není – vzniklo až po roce 1880
    const dTown = Math.hypot(x - SQUARE[0], z - SQUARE[1]);
    const type = c.type === 'hall' ? 'hall' : inVillage ? 'rural' : dTown < 110 ? 'tenement' : 'villa';
    return { type, start: 1880 + r * 45, end: c.end };
  }
  return c;
}
for (let i = 0; i < BUILDINGS.length; i += 7) {
  const [x, z, w, d, ang, levels, k] = BUILDINGS.slice(i, i + 7);
  const kind = KINDS[k];
  const c = applyMapEvidence(classify(x, z, kind, levels, w, d), HIST_FLAGS?.[i / 7], x, z, kind);
  const [h0, h1, roof] = HEIGHTS[c.type];
  let h = rr(h0, h1);
  if (levels > 0 && c.type !== 'garage') h = levels * 0.3 + 0.15;
  buildings.push({
    x, z, w, d, rot: -ang, h, rh: Math.min(roof, d * 0.5), type: c.type,
    start: Math.round(c.start), end: c.end ?? Infinity,
  });
}

// Chaty a vesnice mimo podrobnou mapu
function huts(cx, cz, radius, n, start, end, demolish) {
  for (let i = 0; i < n * 4 && n > 0; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * radius;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (Math.abs(riverSD(x, z)) < RIVER_W + 4) continue;
    buildings.push({
      x, z, w: rr(1.6, 2.6), d: rr(0.8, 1.1), rot: rand() * Math.PI, h: rr(0.3, 0.45), rh: rr(0.5, 0.7),
      type: 'hut', start: Math.round(rr(start, end)), end: demolish,
    });
    n--;
  }
}
function farVillage(cx, cz, start) {
  const ring = (r, n, y0, y1, type) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rr(-0.1, 0.1);
      const rad = r * rr(0.85, 1.15);
      const x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad * 0.75;
      if (Math.abs(riverSD(x, z)) < RIVER_W + 5) continue;
      buildings.push({
        x, z, w: type === 'modern' ? 1.1 : 1.3, d: type === 'modern' ? 1.1 : 2.4, rot: -a,
        h: rr(0.55, 0.75), rh: 0.55, type, start: Math.round(rr(y0, y1)), end: Infinity,
      });
    }
  };
  ring(9, 9, start, start + 150, 'rural');
  ring(15, 13, 1780, 1910, 'rural');
  ring(21, 15, 1965, 2026, 'modern');
}
huts(-30, 2, 18, 9, 0, 60, 460);          // germánská osada u brodu
huts(-14, 8, 22, 14, 610, 880, 1240);     // slovanská osada
huts(-55, -92, 12, 5, 850, 1100, 1450);   // osada v nivě (dnešní Vědomice)
huts(226, -136, 10, 4, 1000, 1150, 1300); // zárodek Dobříně
huts(-250, 48, 10, 4, 950, 1150, 1300);   // zárodek Podlusk
for (const [, x, z] of FAR_VILLAGES) farVillage(x, z, Math.round(rr(1150, 1300)));

// ---------------------------------------------------------------------------
// Instancované budovy
// ---------------------------------------------------------------------------

function prismGeometry() {
  // Sedlová střecha: základna 1×1 v y=0, hřeben ve výšce 1 rovnoběžně s osou x.
  const p = [
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, 0, -0.5, 0, -0.5, 0.5, 1, 0, -0.5, 1, 0, // sever
    -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, 0.5, 0, 0.5,    // jih
    -0.5, 0, -0.5, -0.5, 1, 0, -0.5, 0, 0.5,                                      // štít Z
    0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 1, 0,                                         // štít V
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}
function hipGeometry() {
  // Valbová střecha: základna 1×1 v y=0, krátký hřeben ve výšce 1.
  const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], Cc = [0.5, 0, 0.5], D = [-0.5, 0, 0.5];
  const R1 = [-0.22, 1, 0], R2 = [0.22, 1, 0];
  const p = [...A, ...R2, ...B, ...A, ...R1, ...R2, ...D, ...Cc, ...R2, ...D, ...R2, ...R1,
    ...A, ...D, ...R1, ...B, ...R2, ...Cc];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

const bodyGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const roofGeo = prismGeometry();
const NB = buildings.length;
const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshLambertMaterial(), NB);
const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), NB);
const hips = new THREE.InstancedMesh(hipGeometry(), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), NB);
const HIP_TYPES = new Set(['villa', 'modern', 'civic']);
for (const m of [bodies, roofs, hips]) {
  m.castShadow = true; m.receiveShadow = true;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  scene.add(m);
}
const B_HEIGHT = VEX; // stejné převýšení jako terén
for (const b of buildings) {
  let g = Infinity;
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  for (const [ox, oz] of [[0, 0], [0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]]) {
    const lx = ox * b.w, lz = oz * b.d;
    g = Math.min(g, height(b.x + lx * c + lz * s, b.z - lx * s + lz * c));
  }
  b.y = g - 0.3;
  b.seed = rand();
}
// Skutečné výšky okapu a hřebene z lidaru (DMP 1G − DMR 5G) pro budovy z OSM.
for (let i = 0; i < BUILDINGS.length / 7; i++) {
  const eave = REAL.buildingHeights[i * 2] / 100, ridge = REAL.buildingHeights[i * 2 + 1] / 100;
  if (!ridge) continue;
  const b = buildings[i];
  b.h = eave / 10;
  const r = (ridge - eave) / 10;
  b.rh = r < 0.12 ? 0.02 : Math.min(r, b.d * 0.7);
  b.real = true;
}

const PAL = {
  hut: { walls: ['#7a5c3e', '#6b4f35', '#86664a'], roofs: ['#a58d55', '#9a8450', '#b09a62'] },
  wood: { walls: ['#9b7b56', '#b39a74', '#8a6a48', '#c2ab84'], roofs: ['#6e5a3c', '#7d6545', '#5f4e36'] },
  house: { walls: ['#efe3c8', '#e8d2a6', '#f2ead8', '#d9c09a', '#e6cfb8', '#cfd6c4', '#e9dcc0'], roofs: ['#a4452c', '#b4553a', '#8f3d2a', '#9a4a33', '#a85a3e'] },
  rural: { walls: ['#bfa77f', '#a98f68', '#c9b48e'], roofs: ['#9a8455', '#a89060', '#8e7a4e'] },
  rural2: { walls: ['#efe8d8', '#e6d6b2', '#f2ecdf'], roofs: ['#a4452c', '#b4553a', '#93412c'] },
  tenement: { walls: ['#e9e2d0', '#d8cdb6', '#c7b79a', '#ede5d3', '#bfb6a5', '#dccfb4'], roofs: ['#7d3a2a', '#5f5a55', '#8a3f2c', '#6b4a3c'] },
  villa: { walls: ['#f1ebdd', '#e7dcc2', '#d9d2c0', '#efe1c4'], roofs: ['#b0503a', '#99402e', '#a9563f'] },
  panel: { walls: ['#d8d6cf', '#cfcac0', '#e2ded5', '#c9c6be'], roofs: ['#9a968e'] },
  panelNew: { walls: ['#e9c46a', '#a8cfd6', '#f1a76a', '#cbd8bf', '#e6e1d4', '#d9b8d9'], roofs: ['#8a8a8a'] },
  hall: { walls: ['#a0522d', '#9b6a52', '#8c6a5a', '#a38b75'], roofs: ['#5b5b5b', '#6a625a'] },
  shop: { walls: ['#d0d4d8', '#c4cbd2', '#e2e4e6'], roofs: ['#9aa0a6'] },
  modern: { walls: ['#f4f1ea', '#e9e5dc', '#dcd7cb', '#f0e6d2', '#e3e7ea'], roofs: ['#4a4a4a', '#7a3b2e', '#3d3d3d', '#8c4632'] },
  garage: { walls: ['#bdb7ad', '#a9a49b', '#c8c2b6'], roofs: ['#6f6f6f', '#7d776d'] },
  farm: { walls: ['#b9a48a', '#c9b79a', '#a8927a'], roofs: ['#8f4a33', '#7a5a42', '#9a8455'] },
  civic: { walls: ['#e6dcc6', '#d9cdb3', '#ece4d2'], roofs: ['#6b4a3c', '#7d3a2a', '#5f5a55'] },
};
for (const k in PAL) {
  PAL[k].walls = PAL[k].walls.map(col);
  PAL[k].roofs = PAL[k].roofs.map(col);
}
function paletteFor(type, year) {
  if (type === 'house') return year < 1560 ? PAL.wood : PAL.house;
  if (type === 'rural') return year < 1720 ? PAL.rural : PAL.rural2;
  if (type === 'panel') return year < 2003 ? PAL.panel : PAL.panelNew;
  return PAL[type];
}
const STYLE_YEARS = [1560, 1720, 2003];
let styleKey = -1;
function colorBuildings(year) {
  const key = STYLE_YEARS.filter((y) => year >= y).length;
  if (key === styleKey) return;
  styleKey = key;
  buildings.forEach((b, i) => {
    const pal = paletteFor(b.type, year);
    const s = b.seed;
    bodies.setColorAt(i, pal.walls[Math.floor(s * 997) % pal.walls.length]);
    const rc = pal.roofs[Math.floor(s * 7919) % pal.roofs.length];
    roofs.setColorAt(i, rc);
    hips.setColorAt(i, rc);
  });
  bodies.instanceColor.needsUpdate = true;
  roofs.instanceColor.needsUpdate = true;
  hips.instanceColor.needsUpdate = true;
}

// Války: část domů postavených před pohromou je na několik let vypálená.
const FIRES = [[1421, 1426], [1425, 1428], [1428, 1433], [1466, 1470], [1631, 1634], [1634, 1638], [1639, 1644], [1645, 1650]];
function burned(b, year) {
  for (const [a, e] of FIRES) {
    if (year >= a && year < e && b.start < a && b.x > -85 && b.x < 20 && b.z < 40 && b.z > -35) {
      return hash2(b.seed * 100, a) < 0.45;
    }
  }
  return false;
}

const dummy = new THREE.Object3D();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
function updateBuildings(year) {
  density.fill(0);
  for (let i = 0; i < NB; i++) {
    const b = buildings[i];
    if (year < b.start || year >= b.end || burned(b, year)) {
      bodies.setMatrixAt(i, ZERO);
      roofs.setMatrixAt(i, ZERO);
      hips.setMatrixAt(i, ZERO);
      continue;
    }
    const grow = clamp((year - b.start) / 3, 0.08, 1);
    // dnešní výšky; staré měšťanské domy a statky byly do 19. století nižší
    const bh = year < 1800 && (b.type === 'house' || b.type === 'rural') ? Math.min(b.h, 0.8) : b.h;
    const h = bh * B_HEIGHT * grow + 0.3;
    dummy.position.set(b.x, b.y, b.z);
    dummy.rotation.set(0, b.rot, 0);
    dummy.scale.set(b.w, h, b.d);
    dummy.updateMatrix();
    bodies.setMatrixAt(i, dummy.matrix);
    dummy.position.y = b.y + h;
    const rh = Math.max(0.02, b.rh * B_HEIGHT * grow);
    dummy.scale.set(b.w * 1.04, rh, b.d * 1.1);
    dummy.updateMatrix();
    const hip = HIP_TYPES.has(b.type);
    (hip ? hips : roofs).setMatrixAt(i, dummy.matrix);
    (hip ? roofs : hips).setMatrixAt(i, ZERO);
    const gi = gridIndex(b.x, b.z);
    if (gi >= 0) density[gi] += (b.w * b.d) / (GRID_CELL * GRID_CELL) * 1.6;
  }
  bodies.instanceMatrix.needsUpdate = true;
  roofs.instanceMatrix.needsUpdate = true;
  hips.instanceMatrix.needsUpdate = true;
  // rozmazání mřížky hustoty
  densityTmp.set(density);
  for (let j = 1; j < GRID_N - 1; j++) {
    for (let i = 1; i < GRID_N - 1; i++) {
      const k = j * GRID_N + i;
      density[k] = (densityTmp[k] * 4 + densityTmp[k - 1] + densityTmp[k + 1] +
        densityTmp[k - GRID_N] + densityTmp[k + GRID_N]) / 8;
    }
  }
}

// ---------------------------------------------------------------------------
// Cesty, ulice a koleje (pásy kopírující terén)
// ---------------------------------------------------------------------------

const timed = []; // objekty s viditelností dle roku: {obj, from, to}

function ribbonGeometry(lines, width, yOff) {
  const pos = [], idx = [];
  for (const line of lines) {
    const pts = densify(line, 2);
    const base = pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const nx = -tz * width / 2, nz = tx * width / 2;
      const [x, z] = pts[i];
      pos.push(x + nx, Math.max(0.05, height(x + nx, z + nz)) + yOff, z + nz,
        x - nx, Math.max(0.05, height(x - nx, z - nz)) + yOff, z - nz);
      if (i > 0) {
        const k = base + (i - 1) * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function ribbon(lines, width, color, yOff = 0.08) {
  const m = new THREE.Mesh(ribbonGeometry(lines, width, yOff), new THREE.MeshLambertMaterial({
    color, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide,
  }));
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
const ROAD_COLORS = [[0, col('#a8936f')], [1920, col('#8f8a80')], [1960, col('#626262')]];
function roadColor(year) {
  let c = ROAD_COLORS[0][1];
  for (const [y, cc] of ROAD_COLORS) if (year >= y) c = cc;
  return c;
}
const roadMeshes = [];

// Kdy ulice vznikla – stejná logika jako u zástavby.
function streetYear(cls, x, z) {
  if (cls === 'h') return 1000;
  if (cls === 'p' || cls === 't') return 1250;
  if (cls === 'm') return 1990;
  if (cls === 'b') return 2021;
  for (const [, vx, vz, vr, found] of VILLAGES) {
    const dv = Math.hypot(x - vx, z - vz);
    if (dv < vr * 1.2) return found;
    if (dv < vr * 2.4) return 1800;
  }
  if (pointInPoly(x, z, WALLS)) return 1240;
  if (inJewishQuarter(x, z)) return 1615;
  const dTown = Math.hypot(x - SQUARE[0], z - SQUARE[1]);
  if (dTown < 55) return 1450;
  if (dTown < 100) return 1860;
  if (dTown < 150) return 1920;
  return Math.round(1960 + Math.min(1, (dTown - 150) / 150) * 40);
}
const STREET_W = { h: 1.4, p: 1.4, t: 1.1, r: 0.8, m: 2.6, b: 2.2 };
const streetGroups = new Map();
for (const s of STREETS) {
  const pts = pairs(s.p);
  const mid = pts[Math.floor(pts.length / 2)];
  const year = Math.floor(streetYear(s.c, mid[0], mid[1]) / 10) * 10;
  const key = `${s.c}|${year}`;
  if (!streetGroups.has(key)) streetGroups.set(key, { cls: s.c, year, lines: [] });
  streetGroups.get(key).lines.push(pts);
}
streetGroups.get('h|1000')?.lines.push(...LONG_ROADS);
for (const g of streetGroups.values()) {
  if (g.cls === 'b' || g.cls === 'm') {
    timed.push({ obj: ribbon(g.lines, STREET_W[g.cls], 0x55575a, 0.15), from: g.year });
  } else {
    const m = ribbon(g.lines, STREET_W[g.cls], 0xa8936f);
    roadMeshes.push(m);
    timed.push({ obj: m, from: g.year });
  }
}

// Železnice (od 1850 hlavní trať, od 1900 odbočka do Zlonic a vlečky)
{
  const main = RAILS.filter((r) => r.u === 'm').map((r) => pairs(r.p)).concat(RAIL_EXT_MAIN);
  const branch = RAILS.filter((r) => r.u === 'b').map((r) => pairs(r.p)).concat(RAIL_EXT_BRANCH);
  const yard = RAILS.filter((r) => r.u === 'y').map((r) => pairs(r.p));
  timed.push(
    { obj: ribbon(main, 1.4, 0x7a6f63, 0.14), from: 1850 }, { obj: ribbon(main, 0.5, 0x3e352e, 0.22), from: 1850 },
    { obj: ribbon(branch, 1.2, 0x7a6f63, 0.14), from: 1900 }, { obj: ribbon(branch, 0.45, 0x3e352e, 0.22), from: 1900 },
    { obj: ribbon(yard, 0.9, 0x6f655a, 0.13), from: 1880 },
  );
}

// ---------------------------------------------------------------------------
// Stromy
// ---------------------------------------------------------------------------

const trees = [];
while (trees.length < 14000) {
  const near = trees.length < 5000;
  const x = near ? rr(-300, 300) : rr(-640, 640);
  const z = near ? rr(-300, 320) : rr(-640, 640);
  const sd = riverSD(x, z);
  if (Math.abs(sd) < RIVER_W + 1.5) continue;
  const forestN = fbm(x * 0.009 + 50, z * 0.009 - 20, 4);
  const ripR = Math.hypot(x - RIP[0], z - RIP[1]);
  if (forestN < 0.38 && ripR > 55) continue;
  trees.push({
    x, z, y: height(x, z), forestN, ripR, sd, townR: Math.hypot(x - TOWN[0], z - TOWN[1]),
    s: rr(0.8, 1.5), conifer: rand() < 0.25, cell: gridIndex(x, z),
  });
}
const leafy = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0x3f6a30 }), trees.length);
const conif = new THREE.InstancedMesh(new THREE.ConeGeometry(0.8, 2.6, 6), new THREE.MeshLambertMaterial({ color: 0x2c4c2a }), trees.length);
for (const m of [leafy, conif]) { m.castShadow = true; m.frustumCulled = false; scene.add(m); }
const treeTint = new THREE.Color();
trees.forEach((t, i) => {
  treeTint.setHSL(0.26 + hash2(t.x, t.z) * 0.06, 0.38, 0.22 + hash2(t.z, t.x) * 0.1);
  leafy.setColorAt(i, treeTint);
  conif.setColorAt(i, treeTint.offsetHSL(0.02, 0, -0.06));
});
function updateTrees(year) {
  trees.forEach((t, i) => {
    const show = isForestAt(t.forestN, t.ripR, t.sd, t.townR, year) && (t.cell < 0 || density[t.cell] < 0.08);
    if (!show) {
      leafy.setMatrixAt(i, ZERO); conif.setMatrixAt(i, ZERO);
      return;
    }
    dummy.rotation.set(0, t.x, 0);
    if (t.conifer) {
      dummy.position.set(t.x, t.y + 1.2 * t.s, t.z);
      dummy.scale.setScalar(t.s);
      dummy.updateMatrix();
      conif.setMatrixAt(i, dummy.matrix); leafy.setMatrixAt(i, ZERO);
    } else {
      dummy.position.set(t.x, t.y + 1.1 * t.s, t.z);
      dummy.scale.set(1.2 * t.s, 1.3 * t.s, 1.2 * t.s);
      dummy.updateMatrix();
      leafy.setMatrixAt(i, dummy.matrix); conif.setMatrixAt(i, ZERO);
    }
  });
  leafy.instanceMatrix.needsUpdate = true;
  conif.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Památky
// ---------------------------------------------------------------------------

const MAT = {};
function mat(color) {
  if (!MAT[color]) MAT[color] = new THREE.MeshLambertMaterial({ color });
  return MAT[color];
}
function mesh(geo, color, x, y, z, rotY = 0) {
  const m = new THREE.Mesh(geo, mat(color));
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
const box = (w, h, d, color, x, y, z, rotY) => mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), color, x, y, z, rotY);
const cyl = (r, h, color, x, y, z, seg = 12) => mesh(new THREE.CylinderGeometry(r, r, h, seg).translate(0, h / 2, 0), color, x, y, z);
const cone = (r, h, color, x, y, z, seg = 12, rotY = 0) => mesh(new THREE.ConeGeometry(r, h, seg).translate(0, h / 2, 0), color, x, y, z, rotY);
function matDS(color) {
  const key = color + '|ds';
  if (!MAT[key]) MAT[key] = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
  return MAT[key];
}
function gable(w, h, d, color, x, y, z, rotY = 0) {
  const m = new THREE.Mesh(roofGeo, matDS(color));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.castShadow = true;
  return m;
}
function group(parts, from, to = Infinity, extra = {}, parent = scene) {
  const g = new THREE.Group();
  parts.forEach((p) => g.add(p));
  parent.add(g);
  timed.push({ obj: g, from, to, ...extra });
  return g;
}
const H = (x, z) => height(x, z);

// Románský biskupský hrad (1189/90 – přestavba na zámek)
{
  const [cx, cz] = CASTLE, g = H(cx, cz) - 0.2, stone = '#b9ad92';
  const parts = [
    box(10, 1.6, 0.6, stone, cx, g, cz - 4), box(10, 1.6, 0.6, stone, cx, g, cz + 4),
    box(0.6, 1.6, 8, stone, cx - 5, g, cz), box(0.6, 1.6, 8, stone, cx + 5, g, cz),
    box(6, 2.6, 2.2, '#c4b89d', cx - 1, g, cz - 2.6), gable(6, 1.3, 2.2, '#6d5a42', cx - 1, g + 2.6, cz - 2.6),
    cyl(1.1, 4.8, stone, cx + 3, g, cz + 1.5), cone(1.3, 1.6, '#6d5a42', cx + 3, g + 4.8, cz + 1.5),
  ];
  for (const [bx, bz] of [[-5, -4], [5, -4], [-5, 4], [5, 4], [0, -4], [0, 4], [-5, 0]]) {
    parts.push(cyl(0.7, 2.2, stone, cx + bx, g, cz + bz, 10));
  }
  group(parts, 1189, 1655);
}
// Barokní zámek Lobkoviců (1652–1684), křídla přibývají postupně
{
  const [cx, cz] = CASTLE, g = H(cx, cz) - 0.3, wall = '#efe6cf', roof = '#55565a';
  const wings = [[0, -3.4, 11, 2.2], [0, 3.4, 11, 2.2], [-4.4, 0, 2.2, 4.6], [4.4, 0, 2.2, 4.6]];
  wings.forEach(([ox, oz, w, d], i) => {
    const along = w > d;
    const body = box(w, 2.9, d, wall, cx + ox, g, cz + oz);
    group([
      body,
      gable(along ? w : d, 1.3, along ? d : w, roof, cx + ox, g + 2.9, cz + oz, along ? 0 : Math.PI / 2),
    ], 1652 + i * 8, Infinity, { grow: true });
  });
}
// Augustiniánský klášter a kostel Narození Panny Marie (1333)
{
  const cx = -35, cz = -14, g = H(cx, cz) - 0.2, stone = '#d9cfb8', roof = '#7b4a36';
  group([
    box(5.2, 2.0, 2.3, stone, cx, g, cz), gable(5.2, 1.3, 2.3, roof, cx, g + 2.0, cz),
    box(2, 1.8, 1.9, stone, cx + 3.5, g, cz), gable(2, 1.1, 1.9, roof, cx + 3.5, g + 1.8, cz),
    // průčelí se dvěma věžemi s vysokými jehlancovými střechami (dobové fotografie)
    box(1.0, 2.2, 3.0, stone, cx - 3.0, g, cz),
    box(1.0, 1.4, 1.0, stone, cx - 3.0, g + 2.2, cz - 0.95), box(1.0, 1.4, 1.0, stone, cx - 3.0, g + 2.2, cz + 0.95),
    cone(0.72, 2.1, '#3d3f45', cx - 3.0, g + 3.6, cz - 0.95, 4, Math.PI / 4),
    cone(0.72, 2.1, '#3d3f45', cx - 3.0, g + 3.6, cz + 0.95, 4, Math.PI / 4),
  ], 1333, Infinity, { grow: true });
  group([
    box(5, 1.8, 1.6, '#cfc4ab', cx, g, cz + 3.4), gable(5, 1, 1.6, roof, cx, g + 1.8, cz + 3.4),
    box(1.6, 1.8, 3, '#cfc4ab', cx + 3.3, g, cz + 2.4),
  ], 1335, 1421);
  group([box(5, 0.6, 0.4, '#8f877a', cx, g, cz + 3.4), box(0.4, 0.7, 3, '#8f877a', cx + 3.3, g, cz + 2.4)], 1421, 1600);
}

// Mosty leží na ose BRIDGE; místní osa x vede od jižního (městského) břehu k severnímu.
const bridgeAxis = (() => {
  const [[ax, az], [bx, bz]] = BRIDGE;
  const L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L;
  let s0 = 0, s1 = L;
  for (let s = 0; s <= L; s += 0.25) {
    const sd = riverSD(ax + dx * s, az + dz * s);
    if (sd < -RIVER_W - 3) s0 = s;
    if (sd < RIVER_W + 3) s1 = s;
  }
  return { ax, az, dx, dz, s0, s1, rot: Math.atan2(-dz, dx) };
})();
const bridgeMid0 = [bridgeAxis.ax + bridgeAxis.dx * (bridgeAxis.s0 + bridgeAxis.s1) / 2,
  bridgeAxis.az + bridgeAxis.dz * (bridgeAxis.s0 + bridgeAxis.s1) / 2];
function bridgeGroup() {
  const g = new THREE.Group();
  g.userData.keepReal = true; // mosty v lidarovém terénu chybějí, zobrazujeme je i ve skutečném modelu
  g.position.set(bridgeAxis.ax, 0, bridgeAxis.az);
  g.rotation.y = bridgeAxis.rot;
  scene.add(g);
  return g;
}
// Šikmý nájezd z mostovky na terén na severním břehu.
function ramp(parent, sFrom, yFrom, length, width, color) {
  const x = bridgeAxis.ax + bridgeAxis.dx * (sFrom + length), z = bridgeAxis.az + bridgeAxis.dz * (sFrom + length);
  const yTo = H(x, z) + 0.1;
  const len = Math.hypot(length, yFrom - yTo);
  const m = mesh(new THREE.BoxGeometry(len, 0.35, width), color, sFrom + length / 2, (yFrom + yTo) / 2 - 0.17, 0);
  m.rotation.z = -Math.atan2(yFrom - yTo, length);
  parent.add(m);
  return m;
}
// Kamenný most Jana IV. z Dražic (1333–1340), zbytky do 1906
{
  const parent = bridgeGroup();
  const { s0, s1 } = bridgeAxis;
  const wy = waterY(bridgeMid0[0], bridgeMid0[1]);
  const n = 9, L = (s1 - s0) / n, top = wy + 1.6, bottom = wy - 2.2, stone = '#a89e8a';
  for (let i = 0; i < n; i++) {
    // pole mostu s klenutým otvorem (obrys bez děr, aby triangulace byla spolehlivá)
    const r = (L - 0.8) / 2, spring = 0.3;
    const shape = new THREE.Shape();
    shape.moveTo(0, bottom);
    shape.lineTo(0.4, bottom);
    shape.lineTo(0.4, spring);
    shape.absarc(L / 2, spring, r, Math.PI, 0, true);
    shape.lineTo(L - 0.4, bottom);
    shape.lineTo(L, bottom);
    shape.lineTo(L, top);
    shape.lineTo(0, top);
    shape.lineTo(0, bottom);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.0, bevelEnabled: false }).translate(0, 0, -0.5);
    const ruin = i % 3 === 0;
    group([mesh(geo, stone, s0 + i * L, 0, 0)], 1333 + (i + 1) * (7 / n), ruin ? 1906 : 1640, {}, parent);
  }
  group([ramp(parent, s1, top, 8, 1.0, stone)], 1340, 1640, {}, parent);
}
// Železný most (1906–1910): příhradová ocelová pole na kamenných pilířích a kamenná mostní brána
// s průjezdem na městském břehu (podle dobových fotografií ze stavby mostu)
{
  const parent = bridgeGroup();
  const { s0, s1 } = bridgeAxis;
  const deckY = waterY(bridgeMid0[0], bridgeMid0[1]) + 1.9, steel = '#3a4a46', stone = '#b9b2a4';
  const parts = [box(s1 - s0 + 2, 0.3, 1.2, '#6b6b6b', (s0 + s1) / 2, deckY - 0.3, 0), ramp(parent, s1 + 1, deckY, 9, 1.2, '#6b6b6b')];
  const n = 3, L = (s1 - s0) / n, th = 0.8;
  for (let k = 0; k < n; k++) {
    const a = s0 + k * L, b = a + L;
    for (const side of [-0.62, 0.62]) {
      parts.push(box(L, 0.1, 0.1, steel, (a + b) / 2, deckY, side), box(L, 0.1, 0.1, steel, (a + b) / 2, deckY + th, side));
      const m = 8;
      for (let q = 0; q < m; q++) {
        const xa = a + (q / m) * L, xb = a + ((q + 1) / m) * L;
        parts.push(box(0.07, th, 0.07, steel, xa, deckY, side));
        const diag = mesh(new THREE.BoxGeometry(Math.hypot(xb - xa, th), 0.06, 0.06), steel, (xa + xb) / 2, deckY + th / 2, side);
        diag.rotation.z = (q % 2 ? -1 : 1) * Math.atan2(th, xb - xa);
        parts.push(diag);
      }
    }
    for (let q = 0; q <= 8; q++) parts.push(box(0.07, 0.07, 1.3, steel, a + (q / 8) * L, deckY + th, 0));
  }
  for (let k = 0; k <= n; k++) parts.push(box(1.0, 3.5, 1.7, stone, s0 + k * L, deckY - 3.6, 0));
  // mostní brána na městském břehu
  const gx = s0 - 1.2;
  parts.push(
    box(1.6, deckY + 1.6, 0.55, stone, gx, -1, -0.85), box(1.6, deckY + 1.6, 0.55, stone, gx, -1, 0.85),
    box(1.6, 0.6, 2.25, stone, gx, deckY + 0.6, 0), box(1.8, 0.2, 2.45, '#9c9488', gx, deckY + 1.2, 0),
  );
  group(parts, 1910, Infinity, {}, parent);
}
// Hradby (konec 14. století – 19. století)
{
  const stone = '#9c917c';
  const segs = [];
  for (let i = 1; i < WALLS_CLOSED.length; i++) {
    const [ax, az] = WALLS_CLOSED[i - 1], [bx, bz] = WALLS_CLOSED[i];
    const L = Math.hypot(bx - ax, bz - az), rot = Math.atan2(-(bz - az), bx - ax);
    const steps = Math.ceil(L / 4);
    for (let k = 0; k < steps; k++) {
      const x = lerp(ax, bx, (k + 0.5) / steps), z = lerp(az, bz, (k + 0.5) / steps);
      if (Math.hypot(x - CASTLE[0], z - CASTLE[1]) < 7) continue; // hrad má vlastní opevnění
      const keep = (i * 7 + k) % 6 === 0;
      const w = box(L / steps + 0.1, 1.5, 0.5, stone, x, H(x, z) - 0.3, z, rot);
      if (keep) segs.push(w); else group([w], 1390, 1860);
    }
    if (Math.hypot(ax - CASTLE[0], az - CASTLE[1]) > 7) group([cyl(0.8, 2.3, stone, ax, H(ax, az) - 0.3, az, 10)], 1390, 1860);
  }
  group(segs, 1390);
  for (const [x, z] of [[-53, 5], [-20, 30]]) {
    group([box(2, 2.8, 2, stone, x, H(x, z) - 0.3, z), gable(2, 1, 2, '#6d5a42', x, H(x, z) + 2.5, z)], 1395, 1860);
  }
}
// Hláska (15. století), od baroka s jehlancovou střechou a lucernou
{
  const x = -18, z = -4, g = H(x, z) - 0.3;
  group([box(2, 5.5, 2, '#cbbfa6', x, g, z)], 1475, Infinity, { grow: true });
  group([cone(1.5, 2.2, '#5d4a3a', x, g + 5.5, z, 4, Math.PI / 4)], 1475, 1700);
  group([
    cone(1.5, 1.4, '#3f4a44', x, g + 5.5, z, 4, Math.PI / 4),
    box(0.6, 0.6, 0.6, '#cbbfa6', x, g + 6.6, z),
    cone(0.45, 1.1, '#3f4a44', x, g + 7.2, z, 4, Math.PI / 4),
  ], 1700);
}
// Kapucínský klášter s kostelem sv. Václava (1615–1628) u zámku
{
  const x = 14, z = 3, g = H(x, z) - 0.3;
  group([
    box(3.4, 2.0, 1.4, '#efe7d4', x, g, z - 0.8), gable(3.4, 1.1, 1.4, '#9b4630', x, g + 2.0, z - 0.8),
    box(3.2, 1.5, 0.8, '#e8dfca', x, g, z + 2.6), box(0.8, 1.5, 3, '#e8dfca', x + 1.2, g, z + 1),
    box(0.8, 1.5, 3, '#e8dfca', x - 1.2, g, z + 1),
    gable(3.2, 0.7, 0.8, '#9b4630', x, g + 1.5, z + 2.6),
  ], 1615, Infinity, { grow: true });
}
// Synagogy: v nové židovské čtvrti (1619, zbořena kvůli železnici) a novorománská (1852–1853)
{
  const ox = -60, oz = -27;
  group([box(2, 1.4, 1.6, '#d8c9a8', ox, H(ox, oz) - 0.3, oz), gable(2, 0.9, 1.6, '#7a4a35', ox, H(ox, oz) + 1.1, oz)], 1619, 1850);
  const x = -52, z = -24, g = H(x, z) - 0.3;
  group([
    box(3, 2.2, 2.2, '#d6c3a0', x, g, z), gable(3, 1, 2.2, '#5f5a55', x, g + 2.2, z),
    box(0.7, 3.2, 0.7, '#d6c3a0', x - 1.5, g, z + 1.1), box(0.7, 3.2, 0.7, '#d6c3a0', x - 1.5, g, z - 1.1),
    cone(0.5, 0.8, '#5f5a55', x - 1.5, g + 3.2, z + 1.1, 4, Math.PI / 4), cone(0.5, 0.8, '#5f5a55', x - 1.5, g + 3.2, z - 1.1, 4, Math.PI / 4),
  ], 1853);
}
// Židovské hřbitovy
function cemetery(x, z, w, d, from) {
  const g = H(x, z) - 0.2;
  const parts = [
    box(w, 0.5, 0.2, '#8f877a', x, g, z - d / 2), box(w, 0.5, 0.2, '#8f877a', x, g, z + d / 2),
    box(0.2, 0.5, d, '#8f877a', x - w / 2, g, z), box(0.2, 0.5, d, '#8f877a', x + w / 2, g, z),
  ];
  for (let i = 0; i < 24; i++) parts.push(box(0.15, 0.35, 0.3, '#b5b0a5', x + rr(-w, w) * 0.42, g + 0.15, z + rr(-d, d) * 0.42));
  group(parts, from);
}
cemetery(-90, -17, 6, 4, 1620);
cemetery(-171, -19, 7, 5, 1890);
// Nádraží a továrny
const FACTORY_CHIMNEYS = [[10, 72, 1872, Infinity], [-57, 53, 1885, 1998], [-72, 84, 1898, Infinity], [120, 5, 1905, 1995]];
{
  const x = 14, z = -9, g = H(x, z) - 0.3;
  const st = box(6, 1.8, 1.8, '#e5d7bb', x, g, z, -0.12);
  group([st, gable(6, 0.9, 1.8, '#6d4a3a', x, g + 1.8, z, -0.12)], 1850);
  for (const [cx, cz, from, to] of FACTORY_CHIMNEYS) {
    group([cyl(0.5, 7, '#8b4a32', cx, H(cx, cz) - 0.3, cz, 10)], from, to);
  }
}
// Kratochvílova rozhledna (1935) – podle dobové fotografie
{
  const x = -5, z = 40, g = H(x, z) - 0.2;
  const concrete = '#c9c4b8', parts = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    parts.push(cyl(0.06, 2.6, concrete, x + Math.cos(a) * 0.55, g, z + Math.sin(a) * 0.55, 6));
  }
  const helix = [];
  for (let t = 0; t <= 1; t += 1 / 60) {
    const a = t * Math.PI * 2 * 3;
    helix.push(new THREE.Vector3(x + Math.cos(a) * 0.28, g + 0.1 + t * 2.4, z + Math.sin(a) * 0.28));
  }
  parts.push(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), 120, 0.07, 5), concrete, 0, 0, 0));
  parts.push(cyl(0.68, 0.18, concrete, x, g + 2.6, z, 16), cyl(1.0, 0.1, '#8f8a80', x, g + 3.05, z, 20),
    cyl(0.08, 0.3, concrete, x, g + 2.78, z, 6));
  group(parts, 1935);
}
// Kaple sv. Vojtěcha na Řípu (pravděpodobně kolem 1039), roku 1126 opravena a rozšířena o západní věž
{
  const [x, z] = RIP, g = H(x, z) - 0.3, s = '#d3c7ad';
  group([
    cyl(1.3, 2.2, s, x, g, z, 16), cone(1.5, 1.4, '#6e5e4a', x, g + 2.2, z, 16),
    cyl(0.75, 1.5, s, x + 1.3, g, z, 12),
  ], 1039);
  group([cyl(0.75, 3.8, s, x - 1.7, g, z, 12), cone(0.9, 1.2, '#6e5e4a', x - 1.7, g + 3.8, z, 12)], 1126);
}

// ---------------------------------------------------------------------------
// Drobné detaily: lampy, zahrady, aleje, auta, povozy, lodě, trh
// ---------------------------------------------------------------------------

const props = [];
// items: {x, z, y?, rot, s, from, to, color?}
function makeProps(geo, material, items, shadow = true) {
  const m = new THREE.InstancedMesh(geo, material, Math.max(1, items.length));
  m.castShadow = shadow; m.frustumCulled = false;
  scene.add(m);
  for (const it of items) it.y ??= height(it.x, it.z);
  items.forEach((it, i) => { if (it.color) m.setColorAt(i, it.color); });
  props.push({ mesh: m, items });
  return m;
}
function updateProps(year) {
  for (const { mesh: m, items } of props) {
    items.forEach((it, i) => {
      if (year < it.from || year >= (it.to ?? Infinity)) { m.setMatrixAt(i, ZERO); return; }
      dummy.position.set(it.x, it.y, it.z);
      dummy.rotation.set(0, it.rot, 0);
      if (it.sv) dummy.scale.set(it.s, it.s * it.sv, it.s); else dummy.scale.setScalar(it.s);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }
}
// Body podél lomené čáry po krocích `step`; vrací [x, z, úhel].
function alongLine(pts, step, offset) {
  const out = [];
  let carry = rr(0, step);
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-6) continue;
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    for (let t = carry; t < L; t += step) {
      out.push([ax + dx * t - dz * offset, az + dz * t + dx * offset, Math.atan2(-dz, dx)]);
      carry = t + step - L;
    }
    if (carry > step) carry = 0;
  }
  return out;
}
function inVillageCore(x, z, mult = 1.6) {
  return VILLAGES.some(([, vx, vz, vr]) => Math.hypot(x - vx, z - vz) < vr * mult);
}
const townDist = (x, z) => Math.hypot(x - SQUARE[0], z - SQUARE[1]);

const CAR_COLORS = ['#b23a32', '#2f5d8a', '#e8e4da', '#3b3b3b', '#7a8a3a', '#c9a13a', '#8a8f96', '#264a3a', '#d26a2a'].map(col);
const carGeo = mergeGeometries([
  new THREE.BoxGeometry(0.46, 0.13, 0.21).translate(0, 0.1, 0),
  new THREE.BoxGeometry(0.25, 0.11, 0.19).translate(-0.02, 0.22, 0),
]);

// Stromy na zahradách vil, rodinných domů a statků
const gardenItems = [];
for (const b of buildings) {
  if (!['villa', 'modern', 'rural', 'farm'].includes(b.type) || rand() > 0.6) continue;
  const off = b.d / 2 + rr(0.7, 1.4), lat = rr(-0.4, 0.4) * b.w;
  const c = Math.cos(b.rot), sn = Math.sin(b.rot);
  const x = b.x + lat * c + off * sn, z = b.z - lat * sn + off * c;
  if (Math.abs(riverSD(x, z)) < RIVER_W + 1) continue;
  gardenItems.push({ x, z, rot: rand() * 6, s: rr(0.4, 0.7), sv: 1.25, from: b.start + 4, to: b.end });
}
// Ovocné aleje podél silnic mimo město (od druhé poloviny 18. století)
const alleyLines = [...LONG_ROADS];
for (const s of STREETS) if (s.c === 'h' || s.c === 't') alleyLines.push(pairs(s.p));
for (const line of alleyLines) {
  for (const sideOff of [1.25, -1.25]) {
    for (const [x, z] of alongLine(line, 3.2, sideOff)) {
      if (townDist(x, z) < 150 || inVillageCore(x, z, 2.2)) continue;
      if (Math.abs(riverSD(x, z)) < RIVER_W + 2) continue;
      if (FAR_VILLAGES.some(([, vx, vz]) => Math.hypot(x - vx, z - vz) < 26)) continue;
      gardenItems.push({ x, z, rot: rand() * 6, s: rr(0.45, 0.6), sv: 1.3, from: 1760 + rand() * 40, to: rand() < 0.3 ? 1960 + rand() * 50 : Infinity });
    }
  }
}
const smallTreeGeo = new THREE.IcosahedronGeometry(1, 0).translate(0, 1.05, 0);
const smallTrees = makeProps(smallTreeGeo, new THREE.MeshLambertMaterial(), gardenItems);
gardenItems.forEach((t, i) => {
  treeTint.setHSL(0.24 + hash2(t.x, t.z) * 0.08, 0.42, 0.26 + hash2(t.z, t.x) * 0.1);
  smallTrees.setColorAt(i, treeTint);
});

// Trhové stánky na náměstí (vrcholný středověk – 19. století)
{
  const parts = [];
  const awnings = ['#b5452f', '#e0c27a', '#3f6b8a', '#6b8a3f', '#d9d2c0'];
  for (let i = 0; i < 12; i++) {
    const x = SQUARE[0] + rr(-6, 6), z = SQUARE[1] + rr(-3.5, 3.5), g = H(x, z) - 0.1, rot = rr(-0.2, 0.2);
    parts.push(box(0.9, 0.35, 0.55, '#8a6a48', x, g, z, rot));
    parts.push(gable(1.0, 0.25, 0.65, awnings[i % awnings.length], x, g + 0.35, z, rot));
  }
  group(parts, 1300, 1880);
  // studna / kašna uprostřed náměstí
  const g = H(SQUARE[0], SQUARE[1]) - 0.1;
  group([cyl(0.6, 0.35, '#9c917c', SQUARE[0], g, SQUARE[1], 12), cyl(0.08, 0.9, '#6b6b6b', SQUARE[0], g, SQUARE[1], 6)], 1350);
}

// Doprava na silnicích: povozy (do 1930) a auta (od 1925)
const traffic = [];
{
  const paths = [];
  for (const line of [...LONG_ROADS, ...STREETS.filter((s) => s.c === 'h' || s.c === 'p').map((s) => pairs(s.p))]) {
    const pts = densify(line, 1);
    let L = 0;
    const len = [0];
    for (let i = 1; i < pts.length; i++) { L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); len.push(L); }
    if (L > 35) paths.push({ pts, len, L, ys: pts.map(([x, z]) => Math.max(0.05, height(x, z))) });
  }
  const N = 60;
  const mesh = new THREE.InstancedMesh(carGeo, new THREE.MeshLambertMaterial(), N);
  mesh.castShadow = true; mesh.frustumCulled = false;
  scene.add(mesh);
  for (let k = 0; k < N; k++) {
    traffic.push({ path: paths[k % paths.length], s: rand() * 1000, v: rr(2.5, 5), dir: rand() < 0.5 ? 1 : -1, c: CAR_COLORS[k % CAR_COLORS.length], r: rand() });
  }
  traffic.mesh = mesh;
}
const CART = col('#6b4a2e');
function animateTraffic(dt, year) {
  const m = traffic.mesh;
  const carShare = clamp((year - 1925) / 80, 0, 1);
  const cartShare = year < 1100 ? 0 : year < 1930 ? 0.2 : 0;
  traffic.forEach((t, k) => {
    const isCar = t.r < carShare;
    const isCart = !isCar && t.r < cartShare;
    if (!isCar && !isCart) { m.setMatrixAt(k, ZERO); return; }
    t.s += dt * (isCar ? t.v * 3 : t.v * 0.5);
    const p = t.path;
    let s = t.s % (2 * p.L);
    const back = s > p.L;
    if (back) s = 2 * p.L - s;
    let lo = 0, hi = p.len.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p.len[mid] < s) lo = mid; else hi = mid; }
    const f = (s - p.len[lo]) / (p.len[hi] - p.len[lo] || 1);
    const [ax, az] = p.pts[lo], [bx, bz] = p.pts[hi];
    let dx = bx - ax, dz = bz - az;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const side = back ? -0.3 : 0.3;
    dummy.position.set(lerp(ax, bx, f) - dz * side, lerp(p.ys[lo], p.ys[hi], f) + 0.08, lerp(az, bz, f) + dx * side);
    dummy.rotation.set(0, Math.atan2(-dz, dx) + (back ? Math.PI : 0), 0);
    dummy.scale.setScalar(isCart ? 1.15 : 1);
    dummy.updateMatrix();
    m.setMatrixAt(k, dummy.matrix);
    m.setColorAt(k, isCart ? CART : t.c);
  });
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
}

// Lodě na Labi: dřevěné čluny a vory, od 1841 parníky, po roce 1950 nákladní motorové lodě
const boats = [];
{
  const pts = densify(RIVER_PTS, 1);
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  boats.path = { pts, len, L: len[len.length - 1], ys: pts.map(([x, z]) => waterY(x, z)) };
  const geo = mergeGeometries([
    new THREE.BoxGeometry(2.6, 0.3, 0.75).translate(0, 0.15, 0),
    new THREE.BoxGeometry(0.8, 0.35, 0.55).translate(-0.6, 0.47, 0),
    new THREE.CylinderGeometry(0.07, 0.07, 0.5, 6).translate(-0.3, 0.75, 0),
  ]);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), 7);
  mesh.castShadow = true; mesh.frustumCulled = false;
  scene.add(mesh);
  boats.mesh = mesh;
  for (let k = 0; k < 7; k++) boats.push({ s: k * boats.path.L / 7 + rr(0, 60), v: rr(4, 7), off: rr(-2.5, 2.5) });
}
const BOAT_COLORS = { wood: col('#6b4a2e'), steam: col('#ece6d6'), cargo: col('#4a3a36') };
function animateBoats(dt, year) {
  const { mesh: m, path: p } = boats;
  const c = year < 1841 ? BOAT_COLORS.wood : year < 1950 ? BOAT_COLORS.steam : BOAT_COLORS.cargo;
  boats.forEach((b, k) => {
    if (year < 900 || (year < 1300 && k > 2)) { m.setMatrixAt(k, ZERO); return; }
    b.s = (b.s + dt * b.v) % p.L;
    let lo = 0, hi = p.len.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p.len[mid] < b.s) lo = mid; else hi = mid; }
    const f = (b.s - p.len[lo]) / (p.len[hi] - p.len[lo] || 1);
    const [ax, az] = p.pts[lo], [bx, bz] = p.pts[hi];
    let dx = bx - ax, dz = bz - az;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    dummy.position.set(lerp(ax, bx, f) - dz * b.off, p.ys[lo] - 0.02, lerp(az, bz, f) + dx * b.off);
    dummy.rotation.set(0, Math.atan2(-dz, dx), 0);
    dummy.scale.set(1, year < 1841 ? 0.5 : 1, 1);
    dummy.updateMatrix();
    m.setMatrixAt(k, dummy.matrix);
    m.setColorAt(k, c);
  });
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
}

// Vlak (od roku 1850)
const railPts = densify(TRAIN_PATH, 1);
const railLen = [0];
for (let i = 1; i < railPts.length; i++) {
  railLen.push(railLen[i - 1] + Math.hypot(railPts[i][0] - railPts[i - 1][0], railPts[i][1] - railPts[i - 1][1]));
}
const train = new THREE.Group();
const trainCars = [];
for (let k = 0; k < 6; k++) {
  const car = box(2.2, 0.75, 0.75, '#333', 0, 0, 0);
  train.add(car);
  trainCars.push(car);
}
scene.add(train);
timed.push({ obj: train, from: 1850 });
function trainColors(year) {
  const c = year < 1955 ? ['#1f1f1f', '#3d4e3a'] : year < 1995 ? ['#7c2a26', '#4d6b4a'] : ['#2d5aa0', '#d0d6dc'];
  trainCars.forEach((car, k) => { car.material = mat(k === 0 ? c[0] : c[1]); });
}
function railAt(s) {
  const total = railLen[railLen.length - 1];
  s = ((s % total) + total) % total;
  let lo = 0, hi = railLen.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (railLen[mid] < s) lo = mid; else hi = mid; }
  const t = (s - railLen[lo]) / (railLen[hi] - railLen[lo] || 1);
  const x = lerp(railPts[lo][0], railPts[hi][0], t), z = lerp(railPts[lo][1], railPts[hi][1], t);
  return { x, z, rot: Math.atan2(-(railPts[hi][1] - railPts[lo][1]), railPts[hi][0] - railPts[lo][0]) };
}

// Kouř při požárech města
const smokeTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(70,64,60,0.9)');
  grd.addColorStop(1, 'rgba(70,64,60,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const smoke = [];
for (let i = 0; i < 70; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false }));
  s.userData = { x: rr(-55, 5), z: rr(-10, 30), phase: rand() };
  s.visible = false;
  scene.add(s);
  smoke.push(s);
}
const SMOKE_YEARS = [[1421, 1422.5], [1425, 1426], [1428, 1429], [1466, 1467], [1631, 1632], [1634, 1635.5], [1639, 1640.5], [1645, 1646]];
// Kouř z továrních komínů (do 90. let 20. století)
const factorySmoke = [];
for (const [cx, cz, from, to] of FACTORY_CHIMNEYS) {
  for (let k = 0; k < 5; k++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, color: 0xb8b2aa }));
    sp.userData = { x: cx, z: cz, y: H(cx, cz) + 6.8, from, to: Math.min(to, 1992), phase: k / 5 };
    sp.visible = false;
    scene.add(sp);
    factorySmoke.push(sp);
  }
}
function animateFactorySmoke(time, year) {
  for (const sp of factorySmoke) {
    const d = sp.userData;
    sp.visible = year >= d.from && year < d.to;
    if (!sp.visible) continue;
    const u = (time * 0.15 + d.phase) % 1;
    sp.position.set(d.x + u * 5, d.y + u * 7, d.z - u * 2);
    const sc = 1 + u * 4;
    sp.scale.set(sc, sc, 1);
    sp.material.opacity = 0.55 * (1 - u);
  }
}

// ---------------------------------------------------------------------------
// Popisky
// ---------------------------------------------------------------------------

const labelsEl = document.getElementById('labels');
const bridgeMid = [bridgeAxis.ax + bridgeAxis.dx * (bridgeAxis.s0 + bridgeAxis.s1) / 2,
  bridgeAxis.az + bridgeAxis.dz * (bridgeAxis.s0 + bridgeAxis.s1) / 2];
const LABELS = [
  { text: 'Labe', x: -122, z: -96, y: 1, from: 0, far: 2000 },
  { text: 'Labe', x: 190, z: -250, y: 1, from: 0, far: 2000 },
  { text: 'Říp', x: RIP[0], z: RIP[1], y: 8, from: 0, far: 2500 },
  { text: 'Kaple sv. Vojtěcha', x: RIP[0], z: RIP[1], y: 5, from: 1039, to: 1126, far: 220 },
  { text: 'Rotunda sv. Jiří', x: RIP[0], z: RIP[1], y: 6, from: 1126, far: 220 },
  { text: 'Germánská osada', x: -30, z: 2, y: 2, from: 0, to: 460, far: 500 },
  { text: 'Slovanská osada', x: -14, z: 8, y: 2, from: 610, to: 1220, far: 500 },
  { text: 'Biskupský hrad', x: CASTLE[0], z: CASTLE[1], y: 6, from: 1189, to: 1577, far: 500 },
  { text: 'Rožmberský hrad', x: CASTLE[0], z: CASTLE[1], y: 6, from: 1577, to: 1603, far: 500 },
  { text: 'Lobkovický hrad', x: CASTLE[0], z: CASTLE[1], y: 6, from: 1603, to: 1652, far: 500 },
  { text: 'Zámek Lobkoviců', x: CASTLE[0], z: CASTLE[1], y: 6, from: 1652, far: 600 },
  { text: 'Kamenný most', x: bridgeMid[0], z: bridgeMid[1], y: 4, from: 1340, to: 1640, far: 500 },
  { text: 'Zbytky gotického mostu', x: bridgeMid[0], z: bridgeMid[1], y: 4, from: 1640, to: 1906, far: 400 },
  { text: 'Most přes Labe', x: bridgeMid[0], z: bridgeMid[1], y: 6, from: 1910, far: 500 },
  { text: 'Augustiniánský klášter', x: -35, z: -14, y: 9, from: 1333, to: 1421, far: 400 },
  { text: 'Kostel Narození P. Marie', x: -35, z: -14, y: 9, from: 1421, far: 300 },
  { text: 'Náměstí', x: SQUARE[0], z: SQUARE[1], y: 3, from: 1250, far: 300 },
  { text: 'Hláska', x: -18, z: -4, y: 8.5, from: 1475, far: 300 },
  { text: 'Kapucínský klášter', x: 14, z: 3, y: 4, from: 1615, far: 250 },
  { text: 'Synagoga', x: -60, z: -27, y: 3, from: 1619, to: 1850, far: 250 },
  { text: 'Synagoga', x: -52, z: -24, y: 4.5, from: 1853, far: 250 },
  { text: 'Starý židovský hřbitov', x: -90, z: -17, y: 2, from: 1620, far: 220 },
  { text: 'Nový židovský hřbitov', x: -171, z: -19, y: 2, from: 1890, far: 250 },
  { text: 'Nádraží', x: 14, z: -9, y: 3.5, from: 1850, far: 400 },
  { text: 'Kratochvílova rozhledna', x: -5, z: 40, y: 6.5, from: 1935, far: 400 },
  { text: 'Obchvat', x: -160, z: 146, y: 2, from: 2021, far: 800 },
  { text: 'Trať do Zlonic', x: -93, z: 116, y: 2, from: 1900, far: 600 },
  ...VILLAGES.map(([text, x, z, , from]) => ({ text, x, z, y: 3, from, far: 900, village: true })),
  ...FAR_VILLAGES.map(([text, x, z]) => ({ text, x, z, y: 3, from: 1250, far: 1300, village: true })),
];
for (const l of LABELS) {
  l.el = document.createElement('div');
  l.el.className = l.village ? 'label village' : 'label';
  l.el.textContent = l.text;
  labelsEl.appendChild(l.el);
  l.pos = new THREE.Vector3(l.x, height(l.x, l.z) + l.y, l.z);
}
const tmpV = new THREE.Vector3();
function updateLabels(year) {
  const w = window.innerWidth, h = window.innerHeight;
  for (const l of LABELS) {
    const active = year >= l.from && year < (l.to ?? Infinity);
    const dist = camera.position.distanceTo(l.pos);
    tmpV.copy(l.pos).project(camera);
    const show = active && dist < l.far && tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1;
    l.el.style.display = show ? 'block' : 'none';
    if (show) {
      l.el.style.left = `${(tmpV.x * 0.5 + 0.5) * w}px`;
      l.el.style.top = `${(-tmpV.y * 0.5 + 0.5) * h}px`;
    }
  }
}

// ---------------------------------------------------------------------------
// Rekonstrukce × skutečnost: od roku 2013 lze zobrazit skutečný 3D povrch (lidar + ortofoto ČÚZK)
// ---------------------------------------------------------------------------

const REAL_FROM = 2013;
const KEEP = new Set([water, floodWater, train, traffic.mesh, boats.mesh, sun, sun.target, ...smoke, ...factorySmoke]);
const recon = new THREE.Group();
for (const o of scene.children.slice()) if (!KEEP.has(o) && !o.isLight && !o.userData.keepReal) recon.add(o);
scene.add(recon);
const realState = { on: true, group: null, progress: 0, failed: false };
const realToggle = document.getElementById('real-toggle');
const realInput = realToggle.querySelector('input');
const realNote = document.getElementById('real-note');
realInput.addEventListener('change', () => { realState.on = realInput.checked; applyYear(state.year, true); });
buildRealMeshes(REAL.meta, toY, renderer, (p) => { realState.progress = p; updateRealUI(state.year); })
  .then((g) => {
    realState.group = g;
    scene.add(g);
    applyYear(state.year, true);
  })
  .catch((e) => {
    console.warn('Skutečný 3D model se nepodařilo načíst', e);
    realState.failed = true;
    updateRealUI(state.year);
  });
function realActive(year) {
  return realState.on && !!realState.group && year >= REAL_FROM;
}
function updateRealUI(year) {
  realToggle.hidden = year < REAL_FROM || realState.failed;
  if (!realState.group) {
    realNote.textContent = realState.failed ? '' : `Načítám skutečný 3D model… ${Math.round(realState.progress * 100)} %`;
  } else {
    realNote.textContent = realState.on
      ? 'Letecké snímky ČÚZK, výšky budov a stromů z lidaru 2009–2013'
      : 'Rekonstrukce (schematické budovy podle půdorysů OSM)';
  }
  realNote.hidden = year < REAL_FROM || realState.failed;
}

// ---------------------------------------------------------------------------
// Dobové mapy položené na terén (načítají se až při prvním zobrazení daného období)
// ---------------------------------------------------------------------------

const OVERLAY_RECT = [-250, -220, 250, 220];
const histState = { on: true, loaded: {}, loading: {}, progress: {}, failed: {} };
const histToggle = document.getElementById('hist-toggle');
const histInput = histToggle.querySelector('input');
const histNote = document.getElementById('hist-note');
const attribution = document.getElementById('attribution');
const ATTR_BASE = attribution.textContent;
histInput.addEventListener('change', () => { histState.on = histInput.checked; applyYear(state.year, true); });
function overlayFor(year) {
  return OVERLAYS.find((o) => year >= o.from && year < o.to) ?? null;
}
function ensureOverlay(ov) {
  if (histState.loaded[ov.id] || histState.loading[ov.id] || histState.failed[ov.id]) return;
  histState.loading[ov.id] = true;
  buildOverlay(ov, OVERLAY_RECT, height, (p) => { histState.progress[ov.id] = p; updateHistUI(state.year); })
    .then((mesh) => {
      histState.loaded[ov.id] = mesh;
      mesh.visible = false;
      recon.add(mesh);
      applyYear(state.year, true);
    })
    .catch((e) => {
      console.warn('Dobovou mapu se nepodařilo načíst', ov.id, e);
      histState.failed[ov.id] = true;
      updateHistUI(state.year);
    })
    .finally(() => { histState.loading[ov.id] = false; });
}
function updateHistUI(year) {
  const ov = overlayFor(year);
  const show = !!ov && !realActive(year);
  histToggle.hidden = !show;
  histNote.hidden = !show;
  if (show) {
    histNote.textContent = histState.failed[ov.id] ? 'Mapu se nepodařilo načíst'
      : histState.loaded[ov.id] ? ov.name
        : `Načítám mapu… ${Math.round((histState.progress[ov.id] ?? 0) * 100)} %`;
  }
  attribution.textContent = show && histState.on ? `${ATTR_BASE} · ${ov.credit}` : ATTR_BASE;
}
function applyOverlays(year) {
  const ov = !realActive(year) && histState.on ? overlayFor(year) : null;
  if (ov) ensureOverlay(ov);
  for (const o of OVERLAYS) {
    const m = histState.loaded[o.id];
    if (m) m.visible = !!ov && ov.id === o.id;
  }
  updateHistUI(year);
}

// ---------------------------------------------------------------------------
// Aplikace roku na scénu
// ---------------------------------------------------------------------------

let terrainYear = -9999;
let propsYear = null;
let lastTerrainTime = 0;
function applyYear(year, force = false) {
  const real = realActive(year);
  recon.visible = !real;
  water.visible = !real; // ve skutečném modelu je řeka přímo na leteckém snímku
  if (realState.group) realState.group.visible = real;
  updateRealUI(year);
  applyOverlays(year);
  updateBuildings(year);
  colorBuildings(year);
  for (const t of timed) {
    const vis = year >= t.from && year < (t.to ?? Infinity);
    t.obj.visible = vis;
    if (t.grow && vis) {
      const s = clamp((year - t.from) / 4, 0.05, 1);
      t.obj.scale.y = s;
    }
  }
  const rc = roadColor(year);
  for (const m of roadMeshes) m.material.color.copy(rc);
  trainColors(year);
  if (Math.floor(year) !== propsYear) { updateProps(year); propsYear = Math.floor(year); }
  const now = performance.now();
  if (force || Math.abs(year - terrainYear) >= 1 && now - lastTerrainTime > 120) {
    colorTerrain(year);
    updateTrees(year);
    terrainYear = year;
    lastTerrainTime = now;
  }
}
// Zvětšování „rostoucích“ skupin musí vycházet od země – posuneme pivot.
for (const t of timed) {
  if (!t.grow) continue;
  const g = t.obj;
  let minY = Infinity;
  g.traverse((o) => { if (o.isMesh) minY = Math.min(minY, o.position.y); });
  const pivot = new THREE.Group();
  pivot.position.y = minY;
  g.parent.add(pivot);
  g.children.slice().forEach((c) => { c.position.y -= minY; pivot.add(c); });
  pivot.add(g);
  t.obj = pivot;
}


// ---------------------------------------------------------------------------
// UI: časová osa, karta události, počet obyvatel
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const state = { year: 2026, playing: false, speed: 1, popShown: populationAt(2026), dirty: true };
const pct = (y) => (y - YEAR_MIN) / (YEAR_MAX - YEAR_MIN) * 100;

// značky událostí
const markersEl = $('markers');
const tooltip = $('tooltip');
EVENTS.forEach((ev, i) => {
  const m = document.createElement('div');
  m.className = 'marker';
  m.style.left = `${pct(ev.year)}%`;
  m.style.background = CATEGORIES[ev.cat].color;
  m.addEventListener('pointerdown', (e) => e.stopPropagation());
  m.addEventListener('click', (e) => { e.stopPropagation(); goToEvent(i); });
  m.addEventListener('mouseenter', () => {
    tooltip.hidden = false;
    tooltip.textContent = `${ev.label ?? ev.year}: ${ev.title}`;
    tooltip.style.left = `${pct(ev.year)}%`;
  });
  m.addEventListener('mouseleave', () => { tooltip.hidden = true; });
  ev.marker = m;
  markersEl.appendChild(m);
});
// popisky let
function buildTicks() {
  const ticksEl = $('ticks');
  ticksEl.innerHTML = '';
  const narrow = ticksEl.clientWidth < 600;
  for (let y = 0; y <= 2000; y += 100) {
    const major = y % (narrow ? 500 : 200) === 0;
    const t = document.createElement('div');
    t.className = major ? 'tick' : 'tick minor';
    t.style.left = `${pct(y)}%`;
    t.textContent = major ? y : '';
    ticksEl.appendChild(t);
  }
}
buildTicks();

// tažení po ose
const trackEl = $('track');
function yearFromPointer(e) {
  const r = trackEl.getBoundingClientRect();
  return clamp((e.clientX - r.left) / r.width, 0, 1) * (YEAR_MAX - YEAR_MIN) + YEAR_MIN;
}
let dragging = false;
trackEl.addEventListener('pointerdown', (e) => {
  dragging = true;
  trackEl.setPointerCapture(e.pointerId);
  setPlaying(false);
  setYear(Math.round(yearFromPointer(e)));
});
trackEl.addEventListener('pointermove', (e) => { if (dragging) setYear(Math.round(yearFromPointer(e))); });
trackEl.addEventListener('pointerup', () => { dragging = false; });
trackEl.addEventListener('pointercancel', () => { dragging = false; });

function setYear(y) {
  y = clamp(y, YEAR_MIN, YEAR_MAX);
  if (y === state.year) return;
  state.year = y;
  state.dirty = true;
}

let currentEvent = -1;
function eventIndexAt(year) {
  let idx = -1;
  EVENTS.forEach((ev, i) => { if (ev.year <= year + 1e-6) idx = i; });
  return idx;
}
function showEvent(i) {
  const card = $('event-card');
  if (i < 0) { card.hidden = true; return; }
  const ev = EVENTS[i];
  card.hidden = false;
  card.style.borderLeftColor = CATEGORIES[ev.cat].color;
  $('ev-cat').textContent = CATEGORIES[ev.cat].label;
  $('ev-year').textContent = ev.label ?? ev.year;
  $('ev-title').textContent = ev.title;
  $('ev-text').textContent = ev.text;
  const link = $('ev-link');
  link.hidden = !ev.link;
  if (ev.link) { link.textContent = `${ev.link[0]} ↗`; link.href = ev.link[1]; }
}

function updateUI() {
  const y = Math.floor(state.year + 1e-6);
  $('year-big').textContent = y;
  $('era').textContent = eraAt(y);
  $('track-fill').style.width = `${pct(state.year)}%`;
  const handle = $('handle');
  handle.style.left = `${pct(state.year)}%`;
  handle.setAttribute('aria-valuenow', y);
  const idx = eventIndexAt(state.year);
  if (idx !== currentEvent) {
    if (currentEvent >= 0) EVENTS[currentEvent].marker.classList.remove('active');
    if (idx >= 0) EVENTS[idx].marker.classList.add('active');
    currentEvent = idx;
    showEvent(idx);
  }
  $('pop-note').textContent = y < 1869 ? 'historický odhad' : 'sčítání lidu / ČSÚ (interpolace)';
}

// Sparkline populace
const SPARK_MAX = 15000;
const sx = (y) => y / YEAR_MAX * 200, sy = (p) => 42 - p / SPARK_MAX * 40;
{
  const pts = POPULATION.map(([y, p]) => `${sx(y).toFixed(1)},${sy(p).toFixed(1)}`);
  $('pop-spark').innerHTML =
    `<path d="M0,42 L${pts.join(' L')} L200,42 Z" fill="rgba(224,178,92,.22)"/>` +
    `<path d="M${pts.join(' L')}" fill="none" stroke="#e0b25c" stroke-width="1.4" vector-effect="non-scaling-stroke"/>` +
    '<line id="spark-line" x1="0" x2="0" y1="0" y2="44" stroke="#fff" stroke-opacity=".6" stroke-width="1" vector-effect="non-scaling-stroke"/>';
}
const popFmt = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 });

// Přehrávání
function setPlaying(p) {
  state.playing = p;
  $('btn-play').textContent = p ? '⏸' : '▶';
  $('btn-play').title = p ? 'Pozastavit' : 'Přehrát';
  if (p && state.year >= YEAR_MAX) state.year = YEAR_MIN;
}
$('btn-play').addEventListener('click', () => setPlaying(!state.playing));
$('speed').addEventListener('change', (e) => { state.speed = parseFloat(e.target.value); });
$('btn-prev').addEventListener('click', () => stepEvent(-1));
$('btn-next').addEventListener('click', () => stepEvent(1));
function stepEvent(dir) {
  setPlaying(false);
  const y = state.year;
  let i;
  if (dir > 0) i = EVENTS.findIndex((ev) => ev.year > y + 1e-6);
  else { i = -1; EVENTS.forEach((ev, k) => { if (ev.year < y - 1e-6) i = k; }); }
  if (i >= 0) goToEvent(i);
}
function goToEvent(i) {
  setPlaying(false);
  const ev = EVENTS[i];
  setYear(ev.year);
  if (ev.focus) flyTo(ev.focus[0], ev.focus[1], ev.focus[2]);
}
// rychlost: dávné období rychle, novověk pomaleji (roků za sekundu)
const PLAY_RATE = [[0, 70], [1050, 70], [1150, 14], [1800, 10], [1850, 5], [2026, 5]];

// Kamera – plynulý přelet
let flight = null;
function flyTo(x, z, dist) {
  const target = new THREE.Vector3(x, height(x, z), z);
  const dir = camera.position.clone().sub(controls.target).normalize();
  if (dir.y < 0.35) { dir.y = 0.35; dir.normalize(); }
  flight = {
    start: performance.now(),
    fromT: controls.target.clone(), toT: target,
    fromP: camera.position.clone(), toP: target.clone().add(dir.multiplyScalar(dist)),
  };
}

// Klávesnice
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); setPlaying(!state.playing); }
  else if (e.key === 'ArrowRight') { setPlaying(false); setYear(Math.floor(state.year) + (e.shiftKey ? 10 : 1)); }
  else if (e.key === 'ArrowLeft') { setPlaying(false); setYear(Math.ceil(state.year) - (e.shiftKey ? 10 : 1)); }
  else if (e.key === 'PageDown') { e.preventDefault(); stepEvent(1); }
  else if (e.key === 'PageUp') { e.preventDefault(); stepEvent(-1); }
  else if (e.key === 'Escape') $('info').hidden = true;
});

// Informační panel se zdroji
$('sources').innerHTML = SOURCES.map(([t, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${t}</a></li>`).join('');
$('info-btn').addEventListener('click', () => { $('info').hidden = false; });
$('info-close').addEventListener('click', () => { $('info').hidden = true; });
$('info').addEventListener('click', (e) => { if (e.target.id === 'info') $('info').hidden = true; });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  buildTicks();
});

// ---------------------------------------------------------------------------
// Smyčka
// ---------------------------------------------------------------------------

const clock = new THREE.Clock();
let trainS = 0;
let lastApplied = null;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const time = clock.elapsedTime;

  if (state.playing) {
    state.year = Math.min(YEAR_MAX, state.year + piecewise(PLAY_RATE, state.year) * state.speed * dt);
    state.dirty = true;
    if (state.year >= YEAR_MAX) setPlaying(false);
  }
  if (state.dirty) {
    const force = lastApplied === null || !state.playing;
    applyYear(state.year, force);
    lastApplied = state.year;
    updateUI();
    state.dirty = false;
  } else if (terrainYear !== state.year) {
    applyYear(state.year, true);
  }

  // počet obyvatel – plynulé dopočítávání
  const target = populationAt(state.year);
  state.popShown += (target - state.popShown) * Math.min(1, dt * 10);
  if (Math.abs(target - state.popShown) < 1) state.popShown = target;
  $('pop-value').textContent = popFmt.format(Math.round(state.popShown));
  const sl = document.getElementById('spark-line');
  if (sl) { sl.setAttribute('x1', sx(state.year)); sl.setAttribute('x2', sx(state.year)); }

  // voda – povodně 2002 a 2013
  const y = state.year;
  const flood = (y >= 2002 && y < 2003) || (y >= 2013 && y < 2014) ? 0.95 : 0;
  floodWater.position.y += (flood - floodWater.position.y) * Math.min(1, dt * 2);
  floodWater.visible = floodWater.position.y > 0.05;

  animateTraffic(dt, y);
  animateBoats(dt, y);
  animateFactorySmoke(time, y);

  // vlak
  if (train.visible) {
    trainS += dt * 14;
    trainCars.forEach((car, k) => {
      const p = railAt(trainS - k * 2.4);
      car.position.set(p.x, height(p.x, p.z) + 0.3, p.z);
      car.rotation.y = p.rot;
    });
  }

  // kouř
  const burning = SMOKE_YEARS.some(([a, b]) => y >= a && y < b);
  smoke.forEach((s) => {
    s.visible = burning;
    if (!burning) return;
    const u = (time * 0.12 + s.userData.phase) % 1;
    s.position.set(s.userData.x + u * 6, height(s.userData.x, s.userData.z) + 1 + u * 22, s.userData.z - u * 4);
    const sc = 3 + u * 12;
    s.scale.set(sc, sc, 1);
    s.material.opacity = 0.85 * (1 - u);
  });

  // přelet kamery
  if (flight) {
    const t = Math.min(1, (performance.now() - flight.start) / 1400);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    controls.target.lerpVectors(flight.fromT, flight.toT, e);
    camera.position.lerpVectors(flight.fromP, flight.toP, e);
    if (t >= 1) flight = null;
  }
  controls.update();
  updateLabels(y);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

applyYear(state.year, true);
updateUI();
frame();
const loading = $('loading');
loading.style.opacity = '0';
setTimeout(() => loading.remove(), 700);
window.__roudnice = { state, buildings, setYear, goToEvent, flyTo };
