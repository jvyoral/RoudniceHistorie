// Skutečná data ČÚZK (© ČÚZK, CC BY 4.0): terén DMR 5G, povrch DMP 1G (lidar 2009–2013) a ortofoto,
// půdorysy budov © přispěvatelé OpenStreetMap. Soubory připravují skripty tools/build_real.py a tools/build_city.py.
import * as THREE from 'three';

const BASE = 'data/real/';

async function getBuf(name) {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.arrayBuffer();
}
const getBin = async (name) => new Uint16Array(await getBuf(name));

// Bilineární vzorkovač mřížky (hodnoty ve středech pixelů) → nadmořská výška v metrech.
function makeSampler(rect, [w, h], data, base, scale) {
  const [x0, z0, x1, z1] = rect;
  const sx = w / (x1 - x0), sz = h / (z1 - z0);
  const fn = (x, z) => {
    const fx = Math.min(Math.max((x - x0) * sx - 0.5, 0), w - 1.001);
    const fz = Math.min(Math.max((z - z0) * sz - 0.5, 0), h - 1.001);
    const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, k = j * w + i;
    const a = data[k], b = data[k + 1], c = data[k + w], d = data[k + w + 1];
    return base + scale * ((a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v);
  };
  fn.inside = (x, z, m = 0) => x > x0 + m && x < x1 - m && z > z0 + m && z < z1 - m;
  return fn;
}

// Načte malé mřížky terénu (potřebné hned při startu) a výšky budov.
export async function loadRealData() {
  const meta = await (await fetch(BASE + 'meta.json')).json();
  const { far, mid } = meta.tiles;
  const [farDmr, midDmr, bh] = await Promise.all([getBin('far_dmr.bin'), getBin('mid_dmr.bin'), getBin('bheights.bin')]);
  const farS = makeSampler(far.rect, far.dmr, farDmr, meta.base, meta.scale);
  const midS = makeSampler(mid.rect, mid.dmr, midDmr, meta.base, meta.scale);
  // holý terén v metrech n. m.; uvnitř podrobnější mřížka s plynulým přechodem k okraji
  const elevation = (x, z) => {
    if (!midS.inside(x, z)) return farS(x, z);
    const [x0, z0, x1, z1] = mid.rect;
    const edge = Math.min(x - x0, x1 - x, z - z0, z1 - z);
    if (edge > 20) return midS(x, z);
    const t = edge / 20;
    return farS(x, z) * (1 - t) + midS(x, z) * t;
  };
  return { meta, elevation, buildingHeights: bh };
}

function terrainMesh(meta, tile, data, map, hole, toY) {
  const t = meta.tiles[tile];
  const [w, h] = t.dmr;
  const [x0, z0, x1, z1] = t.rect;
  const dx = (x1 - x0) / w, dz = (z1 - z0) / h;
  const pos = new Float32Array(w * h * 3), uv = new Float32Array(w * h * 2);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      pos[k * 3] = x0 + (i + 0.5) * dx;
      pos[k * 3 + 1] = toY(meta.base + meta.scale * data[k]) - (tile === 'core' ? 0 : 0.04);
      pos[k * 3 + 2] = z0 + (j + 0.5) * dz;
      uv[k * 2] = (i + 0.5) / w;
      uv[k * 2 + 1] = 1 - (j + 0.5) / h;
    }
  }
  const idx = new Uint32Array((w - 1) * (h - 1) * 6);
  let n = 0;
  const [hx0, hz0, hx1, hz1] = hole ?? [0, 0, 0, 0];
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      if (hole) {
        const cx = x0 + (i + 1) * dx, cz = z0 + (j + 1) * dz;
        if (cx > hx0 + dx && cx < hx1 - dx && cz > hz0 + dz && cz < hz1 - dz) continue;
      }
      const k = j * w + i;
      idx[n++] = k; idx[n++] = k + w; idx[n++] = k + 1;
      idx[n++] = k + 1; idx[n++] = k + w; idx[n++] = k + w + 1;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx.subarray(0, n), 1));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map }));
  m.receiveShadow = true;
  m.frustumCulled = false;
  return m;
}

// Budovy: střechy podle lidaru s barvou z ortofota, svislé stěny v neutrální omítce
// (skutečnou barvu fasád letecký snímek nezachycuje).
function cityMeshes(meta, city, buf, maps, toY) {
  const out = [];
  for (const b of city.blocks) {
    const rect = meta.tiles[b.tile].rect;
    const q = new Int16Array(buf, b.pos[0], b.pos[1]);
    const nv = b.pos[1] / 3;
    const pos = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      pos[i * 3] = q[i * 3] / 100;
      pos[i * 3 + 1] = toY(100 + q[i * 3 + 1] / 10);
      pos[i * 3 + 2] = q[i * 3 + 2] / 100;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, b.idx[0], b.idx[1]), 1));
    let mat;
    if (b.kind === 'roof') {
      const uv = new Float32Array(nv * 2);
      for (let i = 0; i < nv; i++) {
        uv[i * 2] = (pos[i * 3] - rect[0]) / (rect[2] - rect[0]);
        uv[i * 2 + 1] = 1 - (pos[i * 3 + 2] - rect[1]) / (rect[3] - rect[1]);
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      mat = new THREE.MeshLambertMaterial({ map: maps[b.tile], flatShading: true, side: THREE.DoubleSide });
    } else {
      const shade = new Uint8Array(buf, b.shade[0], b.shade[1]);
      const colors = new Float32Array(nv * 3);
      const c = new THREE.Color();
      for (let i = 0; i < nv; i++) {
        const s = shade[i] / 255;
        c.setRGB(0.95 * s, 0.91 * s, 0.84 * s, THREE.SRGBColorSpace);
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    }
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    out.push(m);
  }
  return out;
}

// Stromy z lidaru: poloha a výška vrcholu koruny, barva z ortofota.
function treeMeshes(buf, toY) {
  const n = buf.byteLength / 20;
  const dv = new DataView(buf);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial(), n);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.7, 1, 5).translate(0, 0.5, 0),
    new THREE.MeshLambertMaterial({ color: 0x4a3a2c }), n);
  const o = new THREE.Object3D();
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const p = i * 20;
    const x = dv.getFloat32(p, true), z = dv.getFloat32(p + 4, true);
    const g = dv.getFloat32(p + 8, true), h = dv.getFloat32(p + 12, true);
    const crownH = Math.min(h * 0.6, 12);
    const r = Math.min(Math.max(h * 0.28, 1.6), 6) / 10;
    const yTop = toY(g + h), yBot = toY(g + h - crownH), yG = toY(g);
    o.position.set(x, (yTop + yBot) / 2, z);
    o.rotation.set(0, i, 0);
    o.scale.set(r, (yTop - yBot) / 2, r);
    o.updateMatrix();
    crown.setMatrixAt(i, o.matrix);
    o.position.set(x, yG, z);
    o.scale.set(r * 0.18, Math.max(0.05, yBot - yG + 0.1), r * 0.18);
    o.updateMatrix();
    trunk.setMatrixAt(i, o.matrix);
    c.setRGB(dv.getUint8(p + 16) / 255, dv.getUint8(p + 17) / 255, dv.getUint8(p + 18) / 255, THREE.SRGBColorSpace);
    crown.setColorAt(i, c);
  }
  for (const m of [crown, trunk]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; }
  return [crown, trunk];
}

// Postaví skutečný model: terén s ortofotem, budovy a stromy.
export async function buildRealMeshes(meta, toY, renderer, onProgress) {
  const group = new THREE.Group();
  const loader = new THREE.TextureLoader();
  const tex = (name) => new Promise((resolve, reject) => loader.load(BASE + name, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    resolve(t);
  }, undefined, reject));
  let done = 0;
  const step = (p) => { onProgress?.(++done / 6); return p; };
  const [farMap, midMap, coreMap, farD, midD, coreD, city, cityBuf, treeBuf] = await Promise.all([
    tex('far_orto.jpg').then(step), tex('mid_orto.jpg').then(step), tex('core_orto.jpg').then(step),
    getBin('far_dmr.bin'), getBin('mid_dmr.bin'), getBin('core_dmr.bin'),
    fetch(BASE + 'city.json').then((r) => r.json()), getBuf('city.bin').then(step), getBuf('trees.bin').then(step),
  ]);
  group.add(terrainMesh(meta, 'far', farD, farMap, meta.tiles.mid.rect, toY));
  group.add(terrainMesh(meta, 'mid', midD, midMap, meta.tiles.core.rect, toY));
  group.add(terrainMesh(meta, 'core', coreD, coreMap, null, toY));
  for (const m of cityMeshes(meta, city, cityBuf, { core: coreMap, mid: midMap }, toY)) group.add(m);
  for (const m of treeMeshes(treeBuf, toY)) group.add(m);
  step();
  return group;
}
