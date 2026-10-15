// Rute evakuasi (OSRM) dan analisisnya terhadap medan: profil elevasi, waktu jalan kaki yang
// dikoreksi tanjakan (fungsi Tobler), tanjakan tercuram, jembatan/penyeberangan sungai, dan
// panjang rute yang melewati zona bahaya.
import { getJson, jarakKm } from './util.js';
import { nilaiDi, WARNA_CSS } from './zona.js';
import { sampelTitik } from './dem.js';
import { banjirDiRute } from './laporan.js';

const OSRM = { foot: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot', car: 'https://routing.openstreetmap.de/routed-car/route/v1/driving' };

// Server OSRM publik membatasi permintaan beruntun. Tanpa antrean, sebagian rute gagal secara acak, sehingga
// tujuan yang terpilih berganti-ganti walau lokasinya sama. Jadi: maks. 2 permintaan sekaligus, coba ulang
// bila gagal, dan simpan hasilnya selama sesi.
const MAKS_SERENTAK = 2;
let berjalan = 0;
const antre = [];
async function giliran(fn) {
  if (berjalan >= MAKS_SERENTAK) await new Promise((r) => antre.push(r));
  berjalan++;
  try {
    return await fn();
  } finally {
    berjalan--;
    antre.shift()?.();
  }
}
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const cacheRute = new Map();

export function rute(moda, dari, ke) {
  const url = `${OSRM[moda]}/${dari[1].toFixed(6)},${dari[0].toFixed(6)};${ke.lon.toFixed(6)},${ke.lat.toFixed(6)}?overview=full&geometries=geojson`;
  if (!cacheRute.has(url)) {
    const p = (async () => {
      let galat;
      for (let coba = 0; coba < 3; coba++) {
        if (coba) await tidur(1000 * 2 ** coba);
        try {
          const d = await giliran(() => getJson(url, { timeout: 20000 }));
          const r = d.routes?.[0];
          // "Tidak ada rute" adalah jawaban pasti, tidak perlu dicoba ulang.
          if (!r) return null;
          return { jarakKm: r.distance / 1000, menit: r.duration / 60, garis: r.geometry.coordinates.map(([lo, la]) => [la, lo]) };
        } catch (err) {
          galat = err;
        }
      }
      throw galat;
    })();
    p.catch(() => cacheRute.delete(url));
    cacheRute.set(url, p);
  }
  // Salinan, karena pemanggil menambahkan properti (tujuan, analisis medan) ke objek rute.
  return cacheRute.get(url).then((r) => {
    if (!r) throw new Error('Rute tidak ditemukan');
    return { ...r };
  });
}

/** Kecepatan jalan kaki (km/jam) pada kemiringan g (dh/dx), fungsi Tobler. Datar ±5 km/jam. */
export const kecepatanTobler = (g) => 6 * Math.exp(-3.5 * Math.abs(g + 0.05));

/** Jumlah perpotongan garis rute dengan garis sungai (perkiraan jumlah jembatan yang dilewati). */
function hitungPenyeberangan(garis, sungai) {
  if (!sungai?.length || garis.length < 2) return [];
  const [la0, lo0] = garis[0];
  const kx = 111.32 * Math.cos((la0 * Math.PI) / 180);
  const P = ([a, b]) => [(b - lo0) * kx, (a - la0) * 110.57];
  const r = garis.map(P);
  const minX = Math.min(...r.map((p) => p[0])) - 0.1;
  const maxX = Math.max(...r.map((p) => p[0])) + 0.1;
  const minY = Math.min(...r.map((p) => p[1])) - 0.1;
  const maxY = Math.max(...r.map((p) => p[1])) + 0.1;
  const silang = (a, b, c, d) => {
    const s = (p, q, t) => (q[0] - p[0]) * (t[1] - p[1]) - (q[1] - p[1]) * (t[0] - p[0]);
    return s(a, b, c) * s(a, b, d) < 0 && s(c, d, a) * s(c, d, b) < 0;
  };
  const hasil = [];
  for (const s of sungai) {
    const g = s.garis.map(P);
    for (let k = 1; k < g.length; k++) {
      const c = g[k - 1];
      const d = g[k];
      if (Math.max(c[0], d[0]) < minX || Math.min(c[0], d[0]) > maxX || Math.max(c[1], d[1]) < minY || Math.min(c[1], d[1]) > maxY) continue;
      for (let i = 1; i < r.length; i++) {
        if (!silang(r[i - 1], r[i], c, d)) continue;
        // Satu sungai yang berkelok bisa terpotong berkali-kali di titik yang sama; gabungkan yang < 60 m.
        const titik = garis[i];
        if (!hasil.some((h) => jarakKm(...h.titik, ...titik) < 0.06)) hasil.push({ nama: s.nama, titik });
      }
    }
  }
  return hasil;
}

/**
 * Profil medan sepanjang rute.
 * opsi.level(v)   → tingkat bahaya (0–3) yang dipakai untuk bahayaKm, dari hasil nilaiDi
 * opsi.sungai     → garis sungai OSM untuk menghitung penyeberangan/jembatan
 */
export async function analisisRute(garis, opsi = {}) {
  const level = opsi.level || (() => 0);
  const total = garis.reduce((s, p, i) => (i ? s + jarakKm(...garis[i - 1], ...p) : 0), 0);
  // Sampel tiap ±50 m (maks. 60) agar tanjakan pendek tetap terlihat
  const nSampel = Math.min(60, Math.max(8, Math.round(total / 0.05)));
  const sampel = [];
  let akum = 0;
  let k = 0;
  for (let s = 0; s < nSampel; s++) {
    const target = (s / (nSampel - 1)) * total;
    while (k < garis.length - 1 && akum + jarakKm(...garis[k], ...garis[k + 1]) < target) {
      akum += jarakKm(...garis[k], ...garis[k + 1]);
      k++;
    }
    sampel.push({ titik: garis[k], km: target });
  }
  await Promise.all(sampel.map(async (s) => {
    try {
      const v = await nilaiDi(...s.titik);
      s.v = v;
      s.elev = v?.elev ?? (await sampelTitik(...s.titik)).elev;
      s.lv = v ? level(v) : 0;
    } catch {
      s.elev = NaN;
      s.lv = 0;
    }
  }));

  const asli = sampel.filter((s) => Number.isFinite(s.elev));
  // DEM punya derau ±2–5 m (bangunan, pohon): haluskan dengan rata-rata bergerak 5 sampel (±250 m)
  const el = asli.map((s, i) => {
    const w = asli.slice(Math.max(0, i - 2), i + 3);
    return { km: s.km, elev: w.reduce((a, x) => a + x.elev, 0) / w.length };
  });
  let naik = 0;
  let turun = 0;
  let menitDatar = 0;
  let menitTobler = 0;
  let tanjakanMaks = 0;
  // Naik/turun dihitung dengan ambang 3 m agar riak kecil tidak terakumulasi
  let jangkar = el[0]?.elev;
  for (let i = 1; i < el.length; i++) {
    const dh = el[i].elev - el[i - 1].elev;
    const dx = Math.max(0.005, el[i].km - el[i - 1].km);
    if (Math.abs(el[i].elev - jangkar) >= 3) {
      if (el[i].elev > jangkar) naik += el[i].elev - jangkar; else turun += jangkar - el[i].elev;
      jangkar = el[i].elev;
    }
    // Batasi kemiringan agar sisa derau tidak membuat tanjakan mustahil
    const g = Math.max(-0.5, Math.min(0.5, dh / (dx * 1000)));
    menitDatar += (dx / kecepatanTobler(0)) * 60;
    menitTobler += (dx / kecepatanTobler(g)) * 60;
  }
  // Tanjakan tercuram diukur pada jendela ±150 m (bukan antarsampel) agar tidak terpengaruh derau DEM
  for (let i = 0; i < el.length; i++) {
    for (let j = i + 1; j < el.length; j++) {
      const dx = el[j].km - el[i].km;
      if (dx < 0.15) continue;
      tanjakanMaks = Math.max(tanjakanMaks, Math.abs(el[j].elev - el[i].elev) / (dx * 1000));
      break;
    }
  }

  if (asli.length > 1) naik = Math.max(naik, asli[asli.length - 1].elev - asli[0].elev);
  const langkah = total / Math.max(1, nSampel - 1);
  const kmBila = (f) => sampel.filter((s) => s.v && f(s.v)).length * langkah;
  return {
    sampel, naik, turun, tanjakanMaks,
    faktorMedan: menitDatar ? menitTobler / menitDatar : 1,
    bahayaKm: sampel.filter((s) => s.lv >= 3).length * langkah,
    zona: {
      sesar: kmBila((v) => v.gempa >= 2),
      lereng: kmBila((v) => v.longsor >= 2),
      sungai: kmBila((v) => v.banjir >= 2),
      tsunami: kmBila((v) => v.tsunami >= 2),
    },
    jembatan: hitungPenyeberangan(garis, opsi.sungai),
    elevAwal: asli[0]?.elev, elevAkhir: asli[asli.length - 1]?.elev,
  };
}

export function grafikElevasi(sampel) {
  const pts = sampel.filter((s) => Number.isFinite(s.elev));
  if (pts.length < 2) return '';
  const W = 300;
  const H = 60;
  const maxKm = pts[pts.length - 1].km || 1;
  const min = Math.min(...pts.map((p) => p.elev));
  const max = Math.max(...pts.map((p) => p.elev), min + 10);
  const x = (km) => (km / maxKm) * W;
  const y = (e) => H - 4 - ((e - min) / (max - min)) * (H - 10);
  const garis = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.km).toFixed(1)},${y(p.elev).toFixed(1)}`).join('');
  const area = `${garis}L${W},${H}L0,${H}Z`;
  return `<svg class="profil" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Profil elevasi rute dari ${Math.round(pts[0].elev)} m ke ${Math.round(pts[pts.length - 1].elev)} m">
    <path d="${area}" class="profil-area"/><path d="${garis}" class="profil-garis"/>
    ${pts.map((p) => (p.lv >= 2 ? `<rect x="${x(p.km) - 2}" y="${H - 4}" width="5" height="4" fill="${WARNA_CSS[p.lv]}"/>` : '')).join('')}
  </svg>
  <div class="profil-label"><span>${Math.round(pts[0].elev)} m</span><span>elevasi sepanjang rute</span><span>${Math.round(pts[pts.length - 1].elev)} m</span></div>`;
}

/**
 * Lengkapi hasil OSRM: sisa jarak di luar jalan (mis. mendaki ke area aman), analisis medan, dan
 * koreksi waktu jalan kaki terhadap tanjakan.
 */
export async function lengkapiRute(r, moda, opsi) {
  const akhir = r.garis[r.garis.length - 1];
  r.sisaKm = jarakKm(...akhir, r.tujuan.lat, r.tujuan.lon);
  r.garisPenuh = r.sisaKm > 0.03 ? [...r.garis, [r.tujuan.lat, r.tujuan.lon]] : r.garis;
  Object.assign(r, await analisisRute(r.garisPenuh, opsi));
  // Laporan banjir warga (24 jam) & area banjir resmi yang dilewati rute
  r.banjir = banjirDiRute(r.garisPenuh);
  r.menitOsrm = r.menit;
  // OSRM jalan kaki memakai kecepatan tetap; koreksi dengan tanjakan/turunan dari DEM.
  if (moda === 'foot') r.menit *= Math.max(0.9, Math.min(2.5, r.faktorMedan));
  if (r.sisaKm > 0.03) {
    // ±3 km/jam di medan tanpa jalan + 1 menit per 10 m naik
    const naikSisa = Math.max(0, (r.tujuan.elev ?? 0) - (r.sampel[r.sampel.length - 2]?.elev ?? r.tujuan.elev ?? 0));
    r.menitSisa = (r.sisaKm / 3) * 60 + naikSisa / 10;
    r.menit += r.menitSisa;
    r.jarakKm += r.sisaKm;
  }
  return r;
}
