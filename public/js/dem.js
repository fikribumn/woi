// Model elevasi digital dari tile Terrarium (AWS Open Data, Mapzen/Tilezen). Resolusi ±10–30 m di zoom 14.
// Elevasi (m) = R*256 + G + B/256 - 32768. Nilai laut berupa kedalaman negatif.

const URL_TILE = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
export const DEM_MAKS_ZOOM = 14;
const MAKS_CACHE = 160; // ±256 KB per tile
const cache = new Map();

function kanvas() {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(256, 256);
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  return c;
}

/** Elevasi satu tile sebagai Float32Array 256×256 (baris demi baris). */
export function tileElevasi(z, x, y) {
  const k = `${z}/${x}/${y}`;
  const ada = cache.get(k);
  if (ada) {
    cache.delete(k); // perbarui urutan LRU
    cache.set(k, ada);
    return ada;
  }
  const p = (async () => {
    let res;
    for (let coba = 0; coba < 2; coba++) {
      try {
        res = await fetch(URL_TILE(z, x, y));
        if (res.ok) break;
      } catch (e) {
        if (coba) throw e;
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    if (!res?.ok) throw new Error(`DEM HTTP ${res?.status}`);
    const bmp = await createImageBitmap(await res.blob());
    const c = kanvas();
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, 256, 256).data;
    const e = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) e[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
    return e;
  })();
  cache.set(k, p);
  p.catch(() => cache.delete(k));
  if (cache.size > MAKS_CACHE) cache.delete(cache.keys().next().value);
  return p;
}

// ----- Proyeksi Web Mercator -----
export function keTile(lat, lon, z) {
  const n = 256 * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

export function dariPiksel(px, py, z) {
  const n = 256 * 2 ** z;
  const lon = (px / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / n))) * 180) / Math.PI;
  return { lat, lon };
}

/** Ukuran satu piksel (meter) pada lintang dan zoom tertentu. */
export const ukuranPiksel = (lat, z) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

/** Kemiringan lereng (derajat) di piksel (px,py) sebuah tile, memakai beda tinggi ±jarak piksel. */
export function lerengDi(e, px, py, mPerPx, jarak = 2) {
  const at = (x, y) => e[Math.max(0, Math.min(255, y)) * 256 + Math.max(0, Math.min(255, x))];
  const dzdx = (at(px + jarak, py) - at(px - jarak, py)) / (2 * jarak * mPerPx);
  const dzdy = (at(px, py + jarak) - at(px, py - jarak)) / (2 * jarak * mPerPx);
  return (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
}

/** Elevasi dan kemiringan di satu titik. */
export async function sampelTitik(lat, lon, z = 13) {
  const { x, y } = keTile(lat, lon, z);
  const tx = Math.floor(x / 256);
  const ty = Math.floor(y / 256);
  const e = await tileElevasi(z, tx, ty);
  const px = Math.floor(x - tx * 256);
  const py = Math.floor(y - ty * 256);
  return { elev: e[py * 256 + px], lereng: lerengDi(e, px, py, ukuranPiksel(lat, z)) };
}
