// Skutečná data ČÚZK (© ČÚZK, CC BY 4.0): terén DMR 5G, povrch DMP 1G (lidar 2009–2013) a ortofoto.
// Soubory připravuje skript tools/build_real.py do adresáře data/real/.
import * as THREE from 'three';

const BASE = 'data/real/';

async function getBin(name) {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return new Uint16Array(await res.arrayBuffer());
}

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

// Postaví texturované sítě skutečného povrchu (vzdálené okolí, širší okolí, centrum).
export async function buildRealMeshes(meta, toY, renderer, onProgress) {
  const group = new THREE.Group();
  const loader = new THREE.TextureLoader();
  const tex = (name) => new Promise((resolve, reject) => loader.load(BASE + name, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    resolve(t);
  }, undefined, reject));
  const specs = [
    { tile: 'far', kind: 'dmr', hole: meta.tiles.mid.rect },
    { tile: 'mid', kind: 'dmp', hole: meta.tiles.core.rect },
    { tile: 'core', kind: 'dmp', hole: null },
  ];
  let done = 0;
  await Promise.all(specs.map(async ({ tile, kind, hole }) => {
    const t = meta.tiles[tile];
    const [w, h] = t[kind];
    const [data, map] = await Promise.all([getBin(`${tile}_${kind}.bin`), tex(`${tile}_orto.jpg`)]);
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
    const mat = new THREE.MeshLambertMaterial({ map });
    // Ortofoto zachycuje jen střechy; na strmých stěnách by se barva střechy „roztékala“,
    // proto stěny tlumíme do neutrálního odstínu podle jasu snímku.
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vUp;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUp = normalize(mat3(modelMatrix) * objectNormal).y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vUp;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float steep = 1.0 - smoothstep(0.3, 0.55, abs(vUp));
          vec3 c = diffuseColor.rgb;
          float lum = dot(c, vec3(0.299, 0.587, 0.114));
          // koruny stromů (zelené nebo tmavé) ponecháme
          float green = max(smoothstep(-0.02, 0.03, c.g - max(c.r, c.b)), 1.0 - smoothstep(0.16, 0.3, lum));
          vec3 wall = vec3(0.86, 0.82, 0.74) * (0.6 + 0.55 * lum);
          diffuseColor.rgb = mix(c, wall, steep * 0.65 * (1.0 - green));`);
    };
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.castShadow = false;
    m.frustumCulled = false;
    group.add(m);
    onProgress?.(++done / specs.length);
  }));
  return group;
}
