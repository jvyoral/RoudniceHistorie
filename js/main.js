import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  YEAR_MIN, YEAR_MAX, EVENTS, CATEGORIES, POPULATION, SOURCES,
  populationAt, eraAt,
} from './data.js';

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
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

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
const col = (s) => new THREE.Color(s);

// ---------------------------------------------------------------------------
// Krajina: Labe, terasa se zámkem, niva na severním břehu a hora Říp
// ---------------------------------------------------------------------------

const RIVER_W = 6.5;            // poloviční šířka Labe (~130 m)
const RIP = [390, 390];         // Říp ~5,5 km jihovýchodně od města
const HILL = [-20, 230];        // kopec s Kratochvílovou rozhlednou
const TOWN = [20, 60];          // přibližný střed dnešní zástavby
const TERRAIN_SIZE = 1400;
const TERRAIN_SEG = 300;

function riverZ(x) {
  return -25 - 0.00035 * x * x + 6 * Math.sin(x / 55);
}

function height(x, z) {
  const d = z - riverZ(x);
  const n = fbm(x * 0.012, z * 0.012);
  let h;
  if (d < -RIVER_W) {
    const dd = -d - RIVER_W;
    h = 0.4 + Math.min(dd * 0.006, 3) + (n - 0.5) * 6 * smoothstep(30, 250, dd) + smoothstep(150, 500, dd) * 8 * n;
  } else if (d <= RIVER_W) {
    const t = d / RIVER_W;
    h = -1.6 * (1 - t * t) - 0.1;
  } else {
    const dd = d - RIVER_W;
    const cliff = 1.2 + 2.4 * Math.exp(-((x / 140) ** 2));
    h = 0.4 + cliff * smoothstep(0, 6, dd) + Math.min(dd * 0.01, 3) +
      (n - 0.5) * 8 * smoothstep(40, 300, dd) + smoothstep(150, 600, dd) * 6 * n;
  }
  h += (fbm(x * 0.05 + 100, z * 0.05) - 0.5) * 0.3 * smoothstep(0, 10, Math.abs(d) - RIVER_W);
  const r = Math.hypot(x - RIP[0], z - RIP[1]);
  h += 38 * Math.exp(-Math.pow(r / 50, 2.2));
  h += 4 * Math.exp(-((x - HILL[0]) ** 2 + (z - HILL[1]) ** 2) / (2 * 45 * 45));
  return h;
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
scene.fog = new THREE.Fog(SKY, 450, 1350);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 4000);
camera.position.set(-125, 125, -215);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(30, 0, 60);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = 1.45;
controls.minDistance = 12;
controls.maxDistance = 1100;
controls.update();

scene.add(new THREE.HemisphereLight(0xe4f0ff, 0x5a4d3a, 0.95));
const sun = new THREE.DirectionalLight(0xfff0d8, 1.9);
sun.position.set(-160, 260, 220);
sun.target.position.set(0, 0, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -240, right: 240, top: 240, bottom: -240, near: 10, far: 900 });
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
  rip: new Float32Array(VCOUNT), town: new Float32Array(VCOUNT), vary: new Float32Array(VCOUNT), cell: new Int32Array(VCOUNT),
};
for (let i = 0; i < VCOUNT; i++) {
  const x = warp(tPos.getX(i)), z = warp(tPos.getZ(i));
  const h = height(x, z);
  tPos.setXYZ(i, x, h, z);
  V.x[i] = x; V.z[i] = z; V.h[i] = h;
  V.d[i] = z - riverZ(x);
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

// --- voda ----------------------------------------------------------------

const water = new THREE.Mesh(
  new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE),
  new THREE.MeshPhongMaterial({ color: 0x46778f, shininess: 90, specular: 0x88aacc, transparent: true, opacity: 0.88 }),
);
water.rotation.x = -Math.PI / 2;
water.receiveShadow = true;
scene.add(water);

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

function isForestAt(forestN, ripR, d, townR, year) {
  if (ripR < 55) return forestN > 0.22;
  let th = piecewise(FOREST_TH, year);
  // okolí města je od raného středověku odlesněné (pole, pastviny, sady)
  th += 0.16 * smoothstep(800, 1250, year) * (1 - smoothstep(120, 280, townR));
  if (d < -RIVER_W && d > -RIVER_W - 45) th -= 0.06; // lužní lesy v nivě
  return forestN > th;
}

// Hustota zástavby (mřížka 4×4 jednotky) – ze zástavby se barví terén a mýtí stromy.
const GRID_N = 170, GRID_CELL = 4, GRID_O = -GRID_N * GRID_CELL / 2;
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
// Silnice, železnice, hradby – trasy
// ---------------------------------------------------------------------------

const ROADS = [
  { pts: [[2, -12], [6, 8], [8, 15], [10, 44], [20, 140], [10, 262], [-40, 600]], from: 900 },     // na Prahu
  { pts: [[-2, 15], [-24, 20], [-90, 26], [-150, -16], [-350, -62], [-600, -125]], from: 1000 },     // západ podél Labe
  { pts: [[14, 15], [70, 20], [140, 14], [230, 2], [400, -58], [600, -158]], from: 1000 },        // východ
  { pts: [[2, -34], [0, -80], [-30, -190], [-60, -600]], from: 900 },                               // sever od mostu
  { pts: [[20, 140], [150, 220], [330, 300], [362, 342]], from: 1100 },                            // k Řípu
  { pts: [[30, 195], [-20, 230]], from: 1930 },                                                     // k rozhledně
];
const BYPASS = [[-260, 10], [-215, 120], [-160, 205], [-60, 268], [80, 255], [230, 180], [300, 70], [330, -20]];
const RAIL = [[-600, -100], [-300, -40], [-150, 10], [-70, 30], [0, 52], [60, 56], [150, 50], [300, 10], [600, -90]];
const RAIL_ZLONICE = [[0, 52], [-30, 92], [-80, 175], [-150, 300], [-260, 600]];
const WALLS = [[-4, -6], [-22, 2], [-24, 44], [72, 44], [72, 0], [24, -7]];

// ---------------------------------------------------------------------------
// Zástavba
// ---------------------------------------------------------------------------

const buildings = [];
const occ = new Map();
const reserved = []; // {test(x,z,r) -> bool, start}

function reserveRect(x0, z0, x1, z1, start) {
  reserved.push({ start, test: (x, z, r) => x > x0 - r && x < x1 + r && z > z0 - r && z < z1 + r });
}
function reservePoly(pts, width, start, end = Infinity) {
  reserved.push({ start, end, test: (x, z, r) => polyDist(x, z, pts) < width + r });
}
function occKeys(x, z) {
  return [Math.floor(x / 4), Math.floor(z / 4)];
}

function addBuilding(b) {
  b.r = Math.hypot(b.w, b.d) * 0.45;
  b.end = b.end ?? Infinity;
  const dRiver = b.z - riverZ(b.x);
  if (dRiver < RIVER_W + (b.bank ?? 5)) return false;
  for (const res of reserved) {
    if (res.end !== undefined && res.end <= b.start) continue;
    if (!res.test(b.x, b.z, b.r * 0.8)) continue;
    if (res.start <= b.start) return false;
    b.end = Math.min(b.end, res.start); // stavba ustoupí pozdější (např. železnici)
    if (b.end - b.start < 15) return false;
  }
  const [ci, cj] = occKeys(b.x, b.z);
  for (let di = -2; di <= 2; di++) {
    for (let dj = -2; dj <= 2; dj++) {
      const list = occ.get((ci + di) * 100003 + (cj + dj));
      if (!list) continue;
      for (const o of list) {
        if (o.start >= b.end || b.start >= o.end) continue;
        if (Math.hypot(o.x - b.x, o.z - b.z) < (o.r + b.r) * 0.92) return false;
      }
    }
  }
  const key = ci * 100003 + cj;
  if (!occ.has(key)) occ.set(key, []);
  occ.get(key).push(b);
  b.seed = rand();
  buildings.push(b);
  return true;
}

// Domy podél ulice (obě strany nebo jen jedna).
function houseRow(ax, az, bx, bz, o) {
  const L = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / L, dz = (bz - az) / L;
  const nx = -dz, nz = dx;
  const rot = Math.atan2(-dz, dx);
  for (const side of o.sides ?? [-1, 1]) {
    let t = rand() * o.frontage * 0.5;
    while (t < L - o.frontage * 0.5) {
      const w = o.frontage * rr(0.8, 1.2);
      const d = o.depth * rr(0.85, 1.15);
      const off = (o.street ?? 1) / 2 + (o.setback ?? 0) + d / 2;
      const px = ax + dx * (t + w / 2) + nx * side * off;
      const pz = az + dz * (t + w / 2) + nz * side * off;
      if (rand() < (o.fill ?? 0.95)) {
        addBuilding({
          x: px, z: pz, w: w * 0.96, d, rot,
          h: rr(o.hMin, o.hMax), rh: o.roof ?? 0.7,
          type: o.type, start: o.year(px, pz), end: o.end,
        });
      }
      t += w + (o.gap ?? 0);
    }
  }
}

// Pravoúhlá síť ulic v obdélníku (lehce nepravidelná). Vrací seznam ulic.
function gridZone(o) {
  const [x0, z0, x1, z1] = o.rect;
  const streets = [];
  const jit = o.jitter ?? 0;
  for (let x = x0 + rr(0, o.sx * 0.5); x <= x1; x += o.sx * rr(0.85, 1.15)) {
    streets.push([[x + rr(-jit, jit), z0], [x + rr(-jit, jit), z1]]);
  }
  for (let z = z0 + rr(0, o.sz * 0.5); z <= z1; z += o.sz * rr(0.85, 1.15)) {
    streets.push([[x0, z + rr(-jit, jit)], [x1, z + rr(-jit, jit)]]);
  }
  for (const s of streets) houseRow(s[0][0], s[0][1], s[1][0], s[1][1], o);
  return streets;
}

function growthYear(start, end, cx, cz, radius, spread = 0.35) {
  return (x, z) => {
    const f = clamp(Math.hypot(x - cx, z - cz) / radius * (1 - spread) + rand() * spread, 0, 1);
    return Math.round(start + (end - start) * f);
  };
}

function huts(cx, cz, radius, n, start, end, demolish) {
  for (let i = 0; i < n * 3 && n > 0; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * radius;
    if (addBuilding({
      x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, w: rr(1.6, 2.6), d: rr(0.8, 1.1), rot: rand() * Math.PI,
      h: rr(0.3, 0.45), rh: rr(0.5, 0.7), type: 'hut', start: Math.round(rr(start, end)), end: demolish,
    })) n--;
  }
}

function village(cx, cz, radius, start) {
  const ring = (r, n, y0, y1, type) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rr(-0.1, 0.1);
      const rad = r * rr(0.9, 1.1);
      addBuilding({
        x: cx + Math.cos(a) * rad, z: cz + Math.sin(a) * rad * 0.7,
        w: type === 'modern' ? 1.1 : 1.3, d: type === 'modern' ? 1.1 : 2.4, rot: -a,
        h: rr(0.6, 0.8), rh: 0.6, type, start: Math.round(rr(y0, y1)), bank: 8,
      });
    }
  };
  ring(radius, Math.round(radius * 0.9), start, start + 150, 'rural');
  ring(radius * 1.6, Math.round(radius * 1.2), 1780, 1910, 'rural');
  ring(radius * 2.3, Math.round(radius * 1.4), 1965, 2026, 'modern');
}

function panelEstate(rect, start, end, angle) {
  const [x0, z0, x1, z1] = rect;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const hw = (x1 - x0) / 2, hd = (z1 - z0) / 2;
  for (let v = -hd; v <= hd; v += rr(7, 9)) {
    for (let u = -hw; u <= hw; u += rr(11, 14)) {
      if (rand() < 0.15) continue;
      const tower = rand() < 0.18;
      const x = cx + u * ca - v * sa, z = cz + u * sa + v * ca;
      addBuilding({
        x, z, w: tower ? 1.8 : rr(6, 10), d: tower ? 1.8 : 1.3, rot: -angle,
        h: tower ? rr(3.6, 4.2) : rr(1.6, 3.0), rh: 0.05, type: 'panel',
        start: Math.round(rr(start, end)),
      });
    }
  }
}

function halls(rect, start, end, n, type, closeShare = 0) {
  const [x0, z0, x1, z1] = rect;
  for (let i = 0; i < n * 4 && n > 0; i++) {
    const big = type === 'shop';
    if (addBuilding({
      x: rr(x0, x1), z: rr(z0, z1), w: big ? rr(5, 9) : rr(3, 6.5), d: big ? rr(3, 5) : rr(2, 3.2),
      rot: rr(-0.15, 0.15) + (rand() < 0.5 ? 0 : Math.PI / 2), h: big ? rr(0.8, 1.2) : rr(0.9, 1.6),
      rh: big ? 0.05 : 0.35, type, start: Math.round(rr(start, end)),
      end: rand() < closeShare ? Math.round(rr(1992, 2010)) : undefined,
    })) n--;
  }
}

// --- rezervace míst pro památky a trasy (dříve než se generují domy) ---
reserveRect(-2, 11, 14, 19, 1200);          // náměstí
reserveRect(-26, -16, -2, 3, 1189);         // hrad / zámek
reserveRect(-32, 0, -18, 9, 1660);          // jízdárna
reserveRect(8, -14, 25, -1, 1333);          // klášter a kostel
reserveRect(-40, 25, -28, 36, 1615);        // kapucíni
reserveRect(-38, 45, -32, 51, 1852);        // synagoga
reserveRect(-5, 53, 6, 59, 1850);           // nádraží
reserveRect(-4, -40, 8, -10, 1333);         // předmostí
reservePoly(WALLS, 1.2, 1390, 1860);
reservePoly(RAIL, 2.6, 1850);
reservePoly(RAIL_ZLONICE, 2.2, 1900);
reservePoly(BYPASS, 3, 2019);
for (const r of ROADS) reservePoly(r.pts, 1.1, r.from);

// --- osídlení před vznikem města ---
huts(-28, 8, 16, 9, 0, 60, 460);              // germánská osada u brodu
huts(-8, 6, 20, 13, 610, 880, 1240);           // slovanská osada
huts(40, 24, 14, 7, 820, 1000, 1290);
huts(-150, -12, 12, 5, 900, 1100, 1300);       // zárodek Podlusk
huts(30, 196, 12, 5, 950, 1150, 1300);         // zárodek Hracholusk

// --- Staré Město (13.–14. století) ---
const oldTown = { type: 'house', frontage: 1.5, depth: 2.3, hMin: 0.9, hMax: 1.4, roof: 0.8, street: 1.0 };
const otYear = growthYear(1220, 1360, 6, 15, 40);
houseRow(-2, 11, 14, 11, { ...oldTown, sides: [-1], street: 0, year: otYear, fill: 1 });
houseRow(-2, 19, 14, 19, { ...oldTown, sides: [1], street: 0, year: otYear, fill: 1 });
houseRow(-2, 11, -2, 19, { ...oldTown, sides: [1], street: 0, year: otYear, fill: 1 });
houseRow(14, 11, 14, 19, { ...oldTown, sides: [-1], street: 0, year: otYear, fill: 1 });
const oldStreets = gridZone({ ...oldTown, rect: [-20, -1, 30, 42], sx: 8.5, sz: 8, jitter: 1.2, year: otYear });
// Nové Město (konec 14. století)
const newStreets = gridZone({ ...oldTown, rect: [33, -1, 70, 42], sx: 9.5, sz: 9, jitter: 1, year: growthYear(1375, 1470, 33, 20, 40) });
// Předměstí podél cest (renesance a baroko)
for (const [a, b] of [[[12, 46], [20, 120]], [[-26, 20], [-90, 27]], [[74, 20], [140, 14]]]) {
  houseRow(a[0], a[1], b[0], b[1], { ...oldTown, street: 2.4, hMin: 0.7, hMax: 1.0, fill: 0.8, year: growthYear(1500, 1820, a[0], a[1], 90, 0.5) });
}
// Židovská čtvrť (po roce 1614)
const jewStreets = gridZone({ ...oldTown, rect: [-60, 20, -40, 42], sx: 6, sz: 6, jitter: 0.6, frontage: 1.2, year: growthYear(1614, 1700, -50, 32, 15) });
// Vesnice
village(-152, -16, 10, 1250);  // Podlusky
village(30, 196, 10, 1250);    // Hracholusky
village(225, 8, 9, 1200);      // Vědomice
village(-40, -190, 9, 1150);   // Dobříň
village(180, -155, 8, 1200);   // Počaply
village(-370, 110, 10, 1100);  // Bechlín
village(330, 300, 9, 1150);    // Krabčice pod Řípem
village(470, 250, 8, 1200);
village(-260, 320, 8, 1200);
village(120, 420, 8, 1250);

// --- 19. století: činžovní domy a průmysl ---
const c19 = gridZone({
  type: 'tenement', rect: [-55, 46, 110, 125], sx: 11, sz: 10, jitter: 0.3, frontage: 1.8, depth: 2.4,
  hMin: 1.5, hMax: 2.2, roof: 0.7, street: 1.4, fill: 0.9, year: growthYear(1852, 1914, 10, 50, 120, 0.3),
});
halls([85, 58, 190, 82], 1868, 1925, 22, 'hall', 0.4);
// --- první republika: vily ---
const villas1 = gridZone({
  type: 'villa', rect: [-150, 32, -62, 128], sx: 9, sz: 7, frontage: 1.3, depth: 1.3, setback: 0.9, gap: 1.1,
  hMin: 0.7, hMax: 0.95, roof: 0.6, street: 1.1, fill: 0.85, year: growthYear(1919, 1940, -62, 60, 110, 0.4),
});
const villas2 = gridZone({
  type: 'villa', rect: [-50, 128, 70, 172], sx: 9, sz: 7, frontage: 1.3, depth: 1.3, setback: 0.9, gap: 1.1,
  hMin: 0.7, hMax: 0.95, roof: 0.6, street: 1.1, fill: 0.8, year: growthYear(1925, 1965, 10, 128, 120, 0.4),
});
// --- sídliště ---
panelEstate([112, 90, 215, 165], 1966, 1989, 0.12);
panelEstate([-210, 140, -125, 200], 1976, 1988, -0.2);
// --- po roce 1990: rodinné domy a obchodní zóny ---
const mod1 = gridZone({
  type: 'modern', rect: [-265, 30, -165, 125], sx: 8, sz: 7, frontage: 1.3, depth: 1.2, setback: 0.9, gap: 1.2,
  hMin: 0.6, hMax: 0.8, roof: 0.5, street: 1.1, fill: 0.75, year: growthYear(1994, 2026, -165, 70, 120, 0.4),
});
const mod2 = gridZone({
  type: 'modern', rect: [222, 40, 290, 160], sx: 8, sz: 7, frontage: 1.3, depth: 1.2, setback: 0.9, gap: 1.2,
  hMin: 0.6, hMax: 0.8, roof: 0.5, street: 1.1, fill: 0.7, year: growthYear(1996, 2026, 222, 90, 110, 0.4),
});
const mod3 = gridZone({
  type: 'modern', rect: [70, 175, 150, 222], sx: 8, sz: 7, frontage: 1.3, depth: 1.2, setback: 0.9, gap: 1.2,
  hMin: 0.6, hMax: 0.8, roof: 0.5, street: 1.1, fill: 0.7, year: growthYear(2002, 2026, 70, 175, 100, 0.4),
});
halls([200, 185, 290, 230], 2003, 2025, 10, 'shop');
halls([-250, 150, -215, 190], 2005, 2024, 5, 'shop');

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
const bodyGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const roofGeo = prismGeometry();
const NB = buildings.length;
const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshLambertMaterial(), NB);
const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), NB);
for (const m of [bodies, roofs]) {
  m.castShadow = true; m.receiveShadow = true;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  scene.add(m);
}
const B_HEIGHT = 1.3; // budovy mírně převýšené kvůli čitelnosti
for (const b of buildings) {
  let g = Infinity;
  for (const [ox, oz] of [[0, 0], [0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]]) {
    g = Math.min(g, height(b.x + ox * b.w, b.z + oz * b.d));
  }
  b.y = g - 0.3;
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
    roofs.setColorAt(i, pal.roofs[Math.floor(s * 7919) % pal.roofs.length]);
  });
  bodies.instanceColor.needsUpdate = true;
  roofs.instanceColor.needsUpdate = true;
}

// Války: část domů postavených před pohromou je na několik let vypálená.
const FIRES = [[1421, 1426], [1425, 1428], [1428, 1433], [1634, 1638], [1639, 1646]];
function burned(b, year) {
  for (const [a, e] of FIRES) {
    if (year >= a && year < e && b.start < a && b.x > -70 && b.x < 80 && b.z < 60 && b.z > -20) {
      return hash2(b.seed * 100, a) < 0.45;
    }
  }
  return false;
}

const dummy = new THREE.Object3D();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
let visibleCount = 0;
function updateBuildings(year) {
  density.fill(0);
  visibleCount = 0;
  for (let i = 0; i < NB; i++) {
    const b = buildings[i];
    if (year < b.start || year >= b.end || burned(b, year)) {
      bodies.setMatrixAt(i, ZERO);
      roofs.setMatrixAt(i, ZERO);
      continue;
    }
    visibleCount++;
    const grow = clamp((year - b.start) / 3, 0.08, 1);
    const h = b.h * B_HEIGHT * grow + 0.3;
    dummy.position.set(b.x, b.y, b.z);
    dummy.rotation.set(0, b.rot, 0);
    dummy.scale.set(b.w, h, b.d);
    dummy.updateMatrix();
    bodies.setMatrixAt(i, dummy.matrix);
    dummy.position.y = b.y + h;
    dummy.scale.set(b.w * 1.04, Math.max(0.02, b.rh * B_HEIGHT * grow), b.d * 1.1);
    dummy.updateMatrix();
    roofs.setMatrixAt(i, dummy.matrix);
    const gi = gridIndex(b.x, b.z);
    if (gi >= 0) density[gi] += (b.w * b.d) / (GRID_CELL * GRID_CELL) * 1.6;
  }
  bodies.instanceMatrix.needsUpdate = true;
  roofs.instanceMatrix.needsUpdate = true;
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
// Stromy
// ---------------------------------------------------------------------------

const trees = [];
const roadsAll = ROADS.map((r) => r.pts);
while (trees.length < 13000) {
  const near = trees.length < 5000;
  const x = near ? rr(-260, 260) : rr(-560, 560);
  const z = near ? rr(-260, 280) : rr(-560, 560);
  const d = z - riverZ(x);
  if (Math.abs(d) < RIVER_W + 1.5) continue;
  const forestN = fbm(x * 0.009 + 50, z * 0.009 - 20, 4);
  const ripR = Math.hypot(x - RIP[0], z - RIP[1]);
  if (forestN < 0.38 && ripR > 55) continue;
  if (roadsAll.some((p) => polyDist(x, z, p) < 2)) continue;
  trees.push({ x, z, y: height(x, z), forestN, ripR, d, townR: Math.hypot(x - TOWN[0], z - TOWN[1]), s: rr(0.8, 1.5), conifer: rand() < 0.25, cell: gridIndex(x, z) });
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
    const show = isForestAt(t.forestN, t.ripR, t.d, t.townR, year) && (t.cell < 0 || density[t.cell] < 0.08);
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
// Cesty (pásy kopírující terén)
// ---------------------------------------------------------------------------

const timed = []; // objekty s viditelností dle roku: {obj, from, to, update?}

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
      pos.push(x + nx, height(x + nx, z + nz) + yOff, z + nz, x - nx, height(x - nx, z - nz) + yOff, z - nz);
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
function timedRibbon(lines, width, from, to = Infinity) {
  const m = ribbon(lines, width, 0xa8936f);
  roadMeshes.push(m);
  timed.push({ obj: m, from, to });
}
for (const r of ROADS) timedRibbon([r.pts], 1.5, r.from);
timedRibbon(oldStreets, 0.9, 1240);
timedRibbon(newStreets, 0.9, 1390);
timedRibbon(jewStreets, 0.7, 1620);
timedRibbon(c19, 1.2, 1860);
timedRibbon(villas1, 1.0, 1922);
timedRibbon(villas2, 1.0, 1930);
timedRibbon(mod1, 1.0, 1996);
timedRibbon(mod2, 1.0, 1998);
timedRibbon(mod3, 1.0, 2004);
// Obchvat
const bypass = ribbon([BYPASS], 2.4, 0x55575a, 0.15);
timed.push({ obj: bypass, from: 2021 });
// Náměstí
const square = new THREE.Mesh(new THREE.PlaneGeometry(16, 8), new THREE.MeshLambertMaterial({
  color: 0xb8ad98, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
}));
square.rotation.x = -Math.PI / 2;
square.position.set(6, height(6, 15) + 0.12, 15);
scene.add(square);
timed.push({ obj: square, from: 1250 });

// Železnice
const ballast = ribbon([RAIL], 1.6, 0x7a6f63, 0.14);
const track = ribbon([RAIL], 0.6, 0x3e352e, 0.22);
const ballast2 = ribbon([RAIL_ZLONICE], 1.3, 0x7a6f63, 0.14);
const track2 = ribbon([RAIL_ZLONICE], 0.5, 0x3e352e, 0.22);
timed.push({ obj: ballast, from: 1850 }, { obj: track, from: 1850 }, { obj: ballast2, from: 1900 }, { obj: track2, from: 1900 });

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
function gable(w, h, d, color, x, y, z, rotY = 0) {
  const m = new THREE.Mesh(roofGeo, mat(color));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.castShadow = true;
  return m;
}
function group(parts, from, to = Infinity, extra = {}) {
  const g = new THREE.Group();
  parts.forEach((p) => g.add(p));
  scene.add(g);
  timed.push({ obj: g, from, to, ...extra });
  return g;
}
const H = (x, z) => height(x, z);

// Románský biskupský hrad (1189/90 – přestavba na zámek)
{
  const cx = -14, cz = -6, g = H(cx, cz) - 0.2, stone = '#b9ad92';
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
  const cx = -14, cz = -6, g = H(cx, cz) - 0.3, wall = '#efe6cf', roof = '#55565a', rot = -0.05;
  const wings = [
    [0, -4.2, 13, 2.4], [0, 4.2, 13, 2.4], [-5.5, 0, 2.4, 6], [5.5, 0, 2.4, 6],
  ];
  wings.forEach(([ox, oz, w, d], i) => {
    const hgt = 2.9;
    const x = cx + ox * Math.cos(rot) + oz * Math.sin(rot);
    const z = cz - ox * Math.sin(rot) + oz * Math.cos(rot);
    const along = w > d;
    group([
      box(w, hgt, d, wall, x, g, z, rot),
      gable(along ? w : d, 1.3, along ? d : w, roof, x, g + hgt, z, rot + (along ? 0 : Math.PI / 2)),
    ], 1652 + i * 8, Infinity, { grow: true });
  });
  // jízdárna (dnes Galerie moderního umění)
  const jx = -25, jz = 4.5, jg = H(jx, jz) - 0.2;
  group([box(8, 1.7, 2, '#e8dcc0', jx, jg, jz, 0.08), gable(8, 0.9, 2, roof, jx, jg + 1.7, jz, 0.08)], 1680);
}
// Augustiniánský klášter a kostel Narození Panny Marie (1333)
{
  const cx = 16, cz = -7, g = H(cx, cz) - 0.2, stone = '#d9cfb8', roof = '#7b4a36';
  group([
    box(6.5, 2.6, 2.3, stone, cx, g, cz), gable(6.5, 1.8, 2.3, roof, cx, g + 2.6, cz),
    box(2.4, 2.2, 1.9, stone, cx + 4.3, g, cz), gable(2.4, 1.4, 1.9, roof, cx + 4.3, g + 2.2, cz),
    box(1.4, 6, 1.4, stone, cx - 3.8, g, cz), cone(1.05, 2.2, '#4f4a45', cx - 3.8, g + 6, cz, 4, Math.PI / 4),
  ], 1333, Infinity, { grow: true });
  group([
    box(6, 1.8, 1.6, '#cfc4ab', cx, g, cz + 3.6), gable(6, 1, 1.6, roof, cx, g + 1.8, cz + 3.6),
    box(1.6, 1.8, 3, '#cfc4ab', cx + 3.8, g, cz + 2.6),
  ], 1335, 1421);
  group([box(6, 0.6, 0.4, '#8f877a', cx, g, cz + 3.6), box(0.4, 0.7, 3, '#8f877a', cx + 3.8, g, cz + 2.6)], 1421, 1600);
}
// Kamenný most Jana IV. z Dražic (1333–1340), zbytky do 1906
{
  const bx = 2, zS = -10, zN = -38, n = 9, L = (zS - zN) / n, top = 2.6, bottom = -2.2;
  const stone = '#a89e8a';
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
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.0, bevelEnabled: false });
    const m = mesh(geo, stone, bx - 0.5, 0, zS - i * L, Math.PI / 2);
    const ruin = i % 3 === 0;
    group([m], 1333 + (i + 1) * (7 / n), ruin ? 1906 : 1640);
  }
}
// Železný most (1906–1910)
{
  const bx = 2, zS = -9, zN = -40, deckY = 2.9, steel = '#3f6656';
  const parts = [box(1.3, 0.35, zS - zN, '#6b6b6b', bx, deckY - 0.35, (zS + zN) / 2)];
  const spans = [[-17.5, -24.5], [-24.5, -31.5]];
  for (const [a, b] of spans) {
    parts.push(box(1.6, deckY + 2, 1.0, '#9a948a', bx, -2, b));
    for (const side of [-0.6, 0.6]) {
      const pts = [];
      for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        pts.push(new THREE.Vector3(bx + side, deckY + Math.sin(t * Math.PI) * 2.0, lerp(a, b, t)));
      }
      parts.push(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.12, 6), steel, 0, 0, 0));
      for (let k = 1; k < 8; k++) {
        const t = k / 8;
        const hgt = Math.sin(t * Math.PI) * 2.0;
        parts.push(box(0.08, hgt, 0.08, steel, bx + side, deckY, lerp(a, b, t)));
      }
    }
  }
  parts.push(box(1.6, deckY + 2, 1.0, '#9a948a', bx, -2, -17.5));
  group(parts, 1910);
}
// Hradby (konec 14. století – 19. století)
{
  const stone = '#9c917c';
  const segs = [];
  for (let i = 1; i < WALLS.length; i++) {
    const [ax, az] = WALLS[i - 1], [bx, bz] = WALLS[i];
    const L = Math.hypot(bx - ax, bz - az), rot = Math.atan2(-(bz - az), bx - ax);
    const steps = Math.ceil(L / 4);
    for (let k = 0; k < steps; k++) {
      const x = lerp(ax, bx, (k + 0.5) / steps), z = lerp(az, bz, (k + 0.5) / steps);
      const keep = (i * 7 + k) % 6 === 0;
      const w = box(L / steps + 0.1, 1.5, 0.5, stone, x, H(x, z) - 0.3, z, rot);
      if (keep) segs.push(w); else group([w], 1390, 1860);
    }
    group([cyl(0.8, 2.3, stone, ax, H(ax, az) - 0.3, az, 10)], 1390, 1860);
  }
  group(segs, 1390);
  for (const [x, z] of [[-24, 22], [72, 22]]) {
    group([box(2, 2.8, 2, stone, x, H(x, z) - 0.3, z), gable(2, 1, 2, '#6d5a42', x, H(x, z) + 2.5, z)], 1395, 1860);
  }
}
// Hláska (15. století), od baroka s cibulovitou střechou
{
  const x = 10, z = 44, g = H(x, z) - 0.3;
  group([box(2, 5.5, 2, '#cbbfa6', x, g, z)], 1475, Infinity, { grow: true });
  group([cone(1.5, 2.2, '#5d4a3a', x, g + 5.5, z, 4, Math.PI / 4)], 1475, 1700);
  group([
    cyl(1.15, 0.4, '#3f4a44', x, g + 5.5, z, 10),
    mesh(new THREE.SphereGeometry(0.8, 12, 10), '#3f4a44', x, g + 6.5, z),
    cone(0.35, 1.5, '#3f4a44', x, g + 7, z, 8),
  ], 1700);
}
// Kapucínský klášter s kostelem sv. Václava (1615–1628)
{
  const x = -34, z = 30, g = H(x, z) - 0.3;
  group([
    box(1.8, 2.1, 5, '#efe7d4', x - 3, g, z), gable(5, 1.2, 1.8, '#9b4630', x - 3, g + 2.1, z, Math.PI / 2),
    box(4, 1.6, 0.9, '#e8dfca', x, g, z - 2), box(4, 1.6, 0.9, '#e8dfca', x, g, z + 2),
    box(0.9, 1.6, 4.9, '#e8dfca', x + 1.6, g, z),
    gable(4, 0.8, 0.9, '#9b4630', x, g + 1.6, z - 2), gable(4, 0.8, 0.9, '#9b4630', x, g + 1.6, z + 2),
  ], 1615, Infinity, { grow: true });
}
// Synagogy
{
  const ox = -50, oz = 36;
  group([box(2, 1.4, 1.6, '#d8c9a8', ox, H(ox, oz) - 0.3, oz), gable(2, 0.9, 1.6, '#7a4a35', ox, H(ox, oz) + 1.1, oz)], 1619, 1850);
  const x = -35, z = 48, g = H(x, z) - 0.3;
  group([
    box(3, 2.2, 2.2, '#d6c3a0', x, g, z), gable(3, 1, 2.2, '#5f5a55', x, g + 2.2, z),
    box(0.7, 3.2, 0.7, '#d6c3a0', x - 1.5, g, z + 1.1), box(0.7, 3.2, 0.7, '#d6c3a0', x - 1.5, g, z - 1.1),
    cone(0.5, 0.8, '#5f5a55', x - 1.5, g + 3.2, z + 1.1, 4, Math.PI / 4), cone(0.5, 0.8, '#5f5a55', x - 1.5, g + 3.2, z - 1.1, 4, Math.PI / 4),
  ], 1853);
}
// Nádraží a továrny
{
  const x = 0, z = 56, g = H(x, z) - 0.3;
  group([box(8, 1.8, 2, '#e5d7bb', x, g, z), gable(8, 0.9, 2, '#6d4a3a', x, g + 1.8, z)], 1850);
  for (const [cx, cz, from, to] of [[105, 64, 1872, Infinity], [140, 70, 1885, 1998], [172, 66, 1898, Infinity], [120, 76, 1910, 1995]]) {
    group([cyl(0.5, 7, '#8b4a32', cx, H(cx, cz) - 0.3, cz, 10)], from, to);
  }
}
// Kratochvílova rozhledna (1935)
{
  const [x, z] = HILL, g = H(x, z) - 0.2;
  group([box(1.1, 4.2, 1.1, '#cfc7b4', x, g, z), box(2, 0.3, 2, '#9a8f7c', x, g + 4.2, z), cone(1.3, 0.9, '#7a4a35', x, g + 4.5, z, 4, Math.PI / 4)], 1935);
}
// Rotunda sv. Jiří na Řípu (obnovena 1126)
{
  const [x, z] = RIP, g = H(x, z) - 0.3, s = '#d3c7ad';
  group([
    cyl(1.3, 2.2, s, x, g, z, 16), cone(1.5, 1.4, '#6e5e4a', x, g + 2.2, z, 16),
    cyl(0.75, 1.5, s, x + 1.3, g, z, 12), box(1.2, 3.8, 1.2, s, x - 1.6, g, z),
    cone(0.95, 1.2, '#6e5e4a', x - 1.6, g + 3.8, z, 4, Math.PI / 4),
  ], 1126);
}

// Vlak (od roku 1850)
const railPts = densify(RAIL, 1);
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
  s.userData = { x: rr(-25, 70), z: rr(-2, 45), phase: rand() };
  s.visible = false;
  scene.add(s);
  smoke.push(s);
}
const SMOKE_YEARS = [[1421, 1422.5], [1425, 1426], [1428, 1429], [1634, 1635.5], [1639, 1640.5]];

// ---------------------------------------------------------------------------
// Popisky
// ---------------------------------------------------------------------------

const labelsEl = document.getElementById('labels');
const LABELS = [
  { text: 'Labe', x: -170, z: riverZ(-170), y: 1, from: 0, far: 2000 },
  { text: 'Říp', x: RIP[0], z: RIP[1], y: 6, from: 0, far: 2000 },
  { text: 'Rotunda sv. Jiří', x: RIP[0], z: RIP[1], y: 5, from: 1126, far: 180 },
  { text: 'Germánská osada', x: -28, z: 8, y: 2, from: 0, to: 460, far: 500 },
  { text: 'Slovanská osada', x: -8, z: 6, y: 2, from: 610, to: 1220, far: 500 },
  { text: 'Biskupský hrad', x: -14, z: -6, y: 6, from: 1189, to: 1577, far: 500 },
  { text: 'Rožmberský hrad', x: -14, z: -6, y: 6, from: 1577, to: 1603, far: 500 },
  { text: 'Lobkovický hrad', x: -14, z: -6, y: 6, from: 1603, to: 1652, far: 500 },
  { text: 'Zámek Lobkoviců', x: -14, z: -6, y: 6, from: 1652, far: 600 },
  { text: 'Kamenný most', x: 2, z: -24, y: 4, from: 1340, to: 1640, far: 500 },
  { text: 'Zbytky gotického mostu', x: 2, z: -24, y: 4, from: 1640, to: 1906, far: 400 },
  { text: 'Most přes Labe', x: 2, z: -24, y: 6, from: 1910, far: 500 },
  { text: 'Augustiniánský klášter', x: 16, z: -7, y: 9, from: 1333, to: 1421, far: 400 },
  { text: 'Kostel Narození P. Marie', x: 14, z: -7, y: 9, from: 1421, far: 300 },
  { text: 'Náměstí', x: 6, z: 15, y: 2, from: 1250, far: 300 },
  { text: 'Nové Město', x: 52, z: 20, y: 3, from: 1390, to: 1900, far: 300 },
  { text: 'Hláska', x: 10, z: 44, y: 8.5, from: 1475, far: 300 },
  { text: 'Kapucínský klášter', x: -36, z: 30, y: 4, from: 1615, far: 250 },
  { text: 'Synagoga', x: -50, z: 36, y: 3, from: 1619, to: 1850, far: 250 },
  { text: 'Synagoga', x: -35, z: 48, y: 4.5, from: 1853, far: 250 },
  { text: 'Nádraží', x: 0, z: 56, y: 3.5, from: 1850, far: 400 },
  { text: 'Továrny', x: 140, z: 70, y: 8, from: 1872, far: 450 },
  { text: 'Vilová čtvrť', x: -105, z: 80, y: 3, from: 1925, far: 400 },
  { text: 'Sídliště', x: 160, z: 125, y: 6, from: 1970, far: 500 },
  { text: 'Sídliště', x: -168, z: 170, y: 6, from: 1980, far: 500 },
  { text: 'Kratochvílova rozhledna', x: HILL[0], z: HILL[1], y: 6, from: 1935, far: 500 },
  { text: 'Podlusky', x: -152, z: -16, y: 3, from: 1250, far: 600 },
  { text: 'Hracholusky', x: 30, z: 196, y: 3, from: 1250, far: 600 },
  { text: 'Obchvat', x: -60, z: 268, y: 2, from: 2021, far: 700 },
  { text: 'Trať do Zlonic', x: -115, z: 237, y: 2, from: 1900, far: 600 },
];
for (const l of LABELS) {
  l.el = document.createElement('div');
  l.el.className = 'label';
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
// Aplikace roku na scénu
// ---------------------------------------------------------------------------

let terrainYear = -9999;
let lastTerrainTime = 0;
function applyYear(year, force = false) {
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
  scene.add(pivot);
  g.children.slice().forEach((c) => { c.position.y -= minY; pivot.add(c); });
  scene.remove(g);
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
  water.position.y += (flood - water.position.y) * Math.min(1, dt * 2);
  water.material.color.setHex(flood ? 0x5f7f86 : 0x46778f);

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
window.__roudnice = { state, buildings, setYear, goToEvent };
