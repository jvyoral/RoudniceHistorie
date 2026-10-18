// Dobové mapy a letecké snímky položené na terén.
// Dlaždice se načítají přímo ze zdrojových služeb (bez kopírování do repozitáře).
import * as THREE from 'three';

const LAT0 = 50.4253, LON0 = 14.2618;
const K = Math.cos(LAT0 * Math.PI / 180);

// Místní souřadnice scény (1 = 10 m) → zeměpisné souřadnice (stejný převod jako tools/build_geo.py)
function toLatLon(x, z) {
  return [LAT0 - z * 10 / 110574, LON0 + x * 10 / (111320 * K)];
}
// Zeměpisné souřadnice → globální pixel dlaždicového systému Web Mercator v dané úrovni
function toPixel(lat, lon, zoom) {
  const n = 256 * 2 ** zoom;
  const r = lat * Math.PI / 180;
  return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n];
}

export const OVERLAYS = [
  {
    id: 'm2', from: 1842, to: 1877, zoom: 15,
    url: 'https://www.chartae-antiquae.cz/TMS/Military2/{z}/{x}/{y}',
    name: '2. vojenské mapování (1842–1852)',
    credit: 'II. vojenské mapování © VÚGTK, v.v.i. – chartae-antiquae.cz',
  },
  {
    id: 'm3', from: 1877, to: 1953, zoom: 16,
    url: 'https://www.chartae-antiquae.cz/TMS/Military3/{z}/{x}/{y}',
    name: '3. vojenské mapování (1877–1880)',
    credit: 'III. vojenské mapování © VÚGTK, v.v.i. – chartae-antiquae.cz',
  },
];

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Poskládá dlaždice pokrývající obdélník scény do jedné textury.
async function mosaic(ov, rect, onProgress) {
  const [x0, z0, x1, z1] = rect;
  const [la0, lo0] = toLatLon(x0, z0), [la1, lo1] = toLatLon(x1, z1);
  const [px0, py0] = toPixel(la0, lo0, ov.zoom), [px1, py1] = toPixel(la1, lo1, ov.zoom);
  const tx0 = Math.floor(px0 / 256), ty0 = Math.floor(py0 / 256);
  const tx1 = Math.floor(px1 / 256), ty1 = Math.floor(py1 / 256);
  const canvas = document.createElement('canvas');
  canvas.width = (tx1 - tx0 + 1) * 256;
  canvas.height = (ty1 - ty0 + 1) * 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d8cfb4';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
  }
  let done = 0, ok = 0;
  const worker = async () => {
    while (jobs.length) {
      const [tx, ty] = jobs.shift();
      const img = await loadImage(ov.url.replace('{z}', ov.zoom).replace('{x}', tx).replace('{y}', ty));
      if (img) { ctx.drawImage(img, (tx - tx0) * 256, (ty - ty0) * 256); ok++; }
      onProgress?.(++done / ((tx1 - tx0 + 1) * (ty1 - ty0 + 1)));
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (!ok) throw new Error('žádná dlaždice');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, ox: tx0 * 256, oy: ty0 * 256, w: canvas.width, h: canvas.height };
}

// Síť kopírující terén, na kterou se mapa „položí“.
export async function buildOverlay(ov, rect, heightFn, onProgress) {
  const m = await mosaic(ov, rect, onProgress);
  const [x0, z0, x1, z1] = rect;
  const step = 2;
  const nx = Math.round((x1 - x0) / step) + 1, nz = Math.round((z1 - z0) / step) + 1;
  const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step, z = z0 + j * step, k = j * nx + i;
      pos[k * 3] = x; pos[k * 3 + 1] = heightFn(x, z) + 0.25; pos[k * 3 + 2] = z;
      const [la, lo] = toLatLon(x, z);
      const [px, py] = toPixel(la, lo, ov.zoom);
      uv[k * 2] = (px - m.ox) / m.w;
      uv[k * 2 + 1] = 1 - (py - m.oy) / m.h;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let n = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i;
      idx[n++] = k; idx[n++] = k + nx; idx[n++] = k + 1;
      idx[n++] = k + 1; idx[n++] = k + nx; idx[n++] = k + nx + 1;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: m.tex }));
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}
