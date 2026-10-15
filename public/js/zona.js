// Peta zona bahaya berwarna: tiap piksel di sekitar lokasi diberi tingkat 0–3 untuk tiap bencana
// (hijau = aman, kuning = waspada, oranye = rawan, merah = bahaya), dihitung di browser dari:
//   - DEM Terrarium (elevasi & kemiringan) → longsor, banjir, tsunami
//   - sungai & garis pantai (OSM), sesar aktif (Badan Geologi)
//   - gunung api berstatus ≥ Waspada (MAGMA) + arah angin → zona kawah & abu
//   - titik api (FIRMS) + arah angin → zona api & asap
import { RADIUS, RADIUS_BAHAYA_GUNUNG } from './config.js';
import { esc, fmtKm, jarakKm, bearing, selisihSudut, $ } from './util.js';
import { map, kontrolLapisan } from './peta.js';
import { tileElevasi, dariPiksel, keTile, ukuranPiksel, lerengDi, sampelTitik, DEM_MAKS_ZOOM } from './dem.js';
import { IndeksTitik, rapatkan } from './indeks.js';
import { temaAktif, gelapAktif } from './tema.js';

const L = window.L;

export const BAHAYA = [
  { id: 'gabungan', label: 'Semua', ikon: 'layers' },
  { id: 'gempa', label: 'Sesar gempa', ikon: 'activity' },
  { id: 'tsunami', label: 'Tsunami', ikon: 'waves' },
  { id: 'banjir', label: 'Banjir', ikon: 'droplets' },
  { id: 'longsor', label: 'Longsor', ikon: 'mountain' },
  { id: 'gunung', label: 'Gunung api', ikon: 'triangle' },
  { id: 'kebakaran', label: 'Kebakaran', ikon: 'flame' },
];
const ID_BAHAYA = BAHAYA.slice(1).map((b) => b.id);
export const NAMA_LEVEL = ['Aman', 'Waspada', 'Rawan', 'Bahaya'];
// Hijau, kuning, oranye, merah per tema [r, g, b, alpha]. Artinya sama di semua tema; hanya nuansanya
// yang berbeda (Mochi lebih pastel, Stiker lebih pekat). Zona dihaluskan dengan blur CSS (.lapisan-zona).
const PALET = {
  awan: [[72, 199, 142, 0.3], [255, 200, 70, 0.42], [255, 140, 80, 0.5], [255, 72, 72, 0.56]],
  mochi: [[110, 205, 150, 0.36], [255, 205, 90, 0.48], [255, 160, 110, 0.54], [255, 100, 112, 0.6]],
  stiker: [[100, 200, 100, 0.42], [255, 196, 40, 0.52], [255, 130, 70, 0.58], [240, 60, 90, 0.64]],
};
let WARNA;
export let WARNA_CSS;
function hitungWarna() {
  const gelap = gelapAktif();
  WARNA = (PALET[temaAktif()] || PALET.awan)
    .map(([r, g, b, a]) => [r, g, b, gelap ? Math.min(0.72, a * 1.25) : a]); // lebih pekat di atas peta gelap
  WARNA_CSS = WARNA.map(([r, g, b]) => `rgb(${r} ${g} ${b})`);
}
hitungWarna();

const PENJELASAN = {
  gabungan: 'Tingkat tertinggi dari semua bencana di tiap titik.',
  gempa: 'Jarak ke sesar aktif: ≤ 0,5 km bahaya (rekahan permukaan), ≤ 2 km rawan, ≤ 5 km waspada. Guncangan gempa besar tetap dapat terasa di seluruh area.',
  tsunami: 'Elevasi rendah dekat pantai: < 5 m dan ≤ 3 km dari pantai = bahaya; aman bila ≥ 20 m atau > 10 km dari pantai.',
  banjir: 'Dekat sungai dan tidak lebih tinggi dari sungai (≤ 300 m & ≤ 2 m = bahaya; ≤ 1,5 km & ≤ 7 m = waspada), serta dataran pesisir sangat rendah; naik satu tingkat saat hujan lebat.',
  longsor: 'Kemiringan lereng: ≥ 35° bahaya, ≥ 25° rawan, ≥ 15° waspada; naik satu tingkat saat hujan lebat.',
  gunung: 'Radius bahaya kawah sesuai status gunung (Waspada/Siaga/Awas) dan sebaran abu searah angin untuk status ≥ Siaga.',
  kebakaran: 'Jarak ke titik api 48 jam terakhir (≤ 1/3/5 km) dan jalur asap searah angin hingga 30 km.',
};

let data = null;
let pilihan = 'gabungan';

// ---------- Perhitungan tingkat bahaya ----------
function kmCepat(lat1, lon1, lat2, lon2) {
  const dx = (lon2 - lon1) * 111.32 * Math.cos((lat1 * Math.PI) / 180);
  const dy = (lat2 - lat1) * 110.57;
  return Math.sqrt(dx * dx + dy * dy);
}

/** q = { dc: km ke pantai, dr: km ke sungai, er: elevasi sungai, df: km ke sesar } */
function hitungLevel(d, la, lo, e, s, q) {
  const o = { gempa: 0, tsunami: 0, banjir: 0, longsor: 0, gunung: 0, kebakaran: 0 };

  let l = s >= 35 ? 3 : s >= 25 ? 2 : s >= 15 ? 1 : 0;
  if (l && d.hujan >= 2) l = Math.min(3, l + 1);
  o.longsor = l;

  // Banjir: makin dekat & makin rendah terhadap sungai, makin rawan (DEM punya galat ±2–5 m).
  let b = 0;
  if (Number.isFinite(q.er)) {
    const h = e - q.er;
    if ((q.dr <= 0.3 && h <= 2) || (q.dr <= 1 && h <= 0)) b = 3;
    else if (q.dr <= 0.8 && h <= 4) b = 2;
    else if (q.dr <= 1.5 && h <= 7) b = 1;
  }
  if (q.dc <= 5 && e <= 3) b = Math.max(b, 2);
  if (b && d.hujan >= 2) b = Math.min(3, b + 1);
  if (s >= 15) b = Math.min(b, 1);
  o.banjir = b;

  if (q.dc <= 10) o.tsunami = e < 5 ? (q.dc <= 3 ? 3 : 2) : e < 10 ? (q.dc <= 3 ? 2 : 1) : e < 20 && q.dc <= 5 ? 1 : 0;

  o.gempa = q.df <= 0.5 ? 3 : q.df <= 2 ? 2 : q.df <= 5 ? 1 : 0;

  for (const v of d.gunung) {
    const km = kmCepat(la, lo, v.lat, v.lon);
    const rb = RADIUS_BAHAYA_GUNUNG[v.level];
    let g = km <= rb ? 3 : km <= rb + (v.level >= 3 ? 5 : 2) ? 2 : 0;
    if (!g && v.level >= 3 && d.angin && km <= 30 && selisihSudut(d.angin.ke, bearing(v.lat, v.lon, la, lo)) <= 25) g = km <= 15 ? 2 : 1;
    if (g > o.gunung) o.gunung = g;
  }

  for (const t of d.api) {
    const km = kmCepat(la, lo, t.lat, t.lon);
    let a = km <= 1 ? 3 : km <= 3 ? 2 : km <= 5 ? 1 : 0;
    if (!a && d.angin && km <= 30 && selisihSudut(d.angin.ke, bearing(t.lat, t.lon, la, lo)) <= 15) a = 1;
    if (a > o.kebakaran) o.kebakaran = a;
    if (o.kebakaran === 3) break;
  }

  o.gabungan = Math.max(o.gempa, o.tsunami, o.banjir, o.longsor, o.gunung, o.kebakaran);
  return o;
}

/**
 * Laut atau darat? Utamakan sisi garis pantai OSM (DEM pesisir sering bernilai sedikit negatif di daratan,
 * misalnya tambak, rawa, atau daerah yang mengalami penurunan tanah). Jauh dari garis pantai yang diketahui:
 * hanya laut dalam. Bila data garis pantai sama sekali tidak termuat (Overpass gagal), laut dangkal bisa
 * terbaca sebagai darat, jadi semua elevasi di bawah 0 m dianggap laut.
 */
function adalahLaut(elev, sdc, d = data) {
  if (sdc < 0 && elev < 10) return true;
  const adaPantai = d?.pantai?.jumlah > 0;
  return sdc >= 99 && elev < (adaPantai ? -5 : 0);
}

/** Titik di laut (v = hasil nilaiDi)? */
export const diLaut = (v) => adalahLaut(v.elev, v.q.sdc);

/**
 * Boleh dijadikan tujuan evakuasi? Harus di darat dan di atas permukaan laut. Daratan ≤ 0 m (tambak, rawa)
 * tidak pernah menjadi tempat aman, dan aturan ini juga menahan laut dangkal yang lolos dari deteksi.
 */
export const layakTujuan = (v) => !!v && !diLaut(v) && v.elev > 0;

/** Jarak bertanda ke pantai: positif = darat, negatif = laut (sisi kanan arah garis pantai). */
function jarakPantai(d, la, lo) {
  const c = d.pantai.terdekat(la, lo, 12);
  if (!c) return 99;
  const vx = (lo - c.lon) * Math.cos((la * Math.PI) / 180);
  const vy = la - c.lat;
  const silang = c.data.timur * vy - c.data.utara * vx;
  return silang >= 0 ? c.km : -c.km;
}

function jarakSumber(d, la, lo) {
  const sdc = jarakPantai(d, la, lo);
  const r = d.sungai.terdekat(la, lo, 1.6);
  const f = d.sesar.terdekat(la, lo, 5.5);
  return { dc: Math.abs(sdc), laut: sdc < 0, sdc, dr: r ? r.km : 99, er: r ? r.data.elev : NaN, df: f ? f.km : 99, sungai: r, sesar: f };
}

// ---------- Lapisan raster ----------
const SUB = 16; // grid jarak 17×17 per tile, diinterpolasi
const SEL = 4; // satu sel warna = 4×4 piksel

async function gambarTile(kanvas, { x, y, z }) {
  const d = data;
  if (!d) return;
  const n0 = dariPiksel(x * 256, y * 256, z);
  const s0 = dariPiksel(x * 256 + 256, y * 256 + 256, z);
  const dLat = d.radiusKm / 110.57;
  const dLon = d.radiusKm / (111.32 * Math.cos((d.lat * Math.PI) / 180));
  if (s0.lat > d.lat + dLat || n0.lat < d.lat - dLat || n0.lon > d.lon + dLon || s0.lon < d.lon - dLon) return;

  const e = await tileElevasi(z, x, y);
  if (d !== data) return;

  // Lintang/bujur per baris/kolom sel
  const latBaris = [];
  const lonKolom = [];
  for (let i = 0; i < 256 / SEL; i++) {
    latBaris.push(dariPiksel(0, y * 256 + i * SEL + SEL / 2, z).lat);
    lonKolom.push(dariPiksel(x * 256 + i * SEL + SEL / 2, 0, z).lon);
  }

  // Jarak ke pantai/sungai/sesar pada grid kasar, lalu interpolasi bilinear
  const N = SUB + 1;
  const dc = new Float32Array(N * N); // jarak bertanda ke pantai
  const dr = new Float32Array(N * N);
  const er = new Float32Array(N * N);
  const df = new Float32Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const ll = dariPiksel(x * 256 + j * SUB, y * 256 + i * SUB, z);
      const q = jarakSumber(d, ll.lat, ll.lon);
      const k = i * N + j;
      dc[k] = q.sdc;
      dr[k] = q.dr;
      er[k] = q.er;
      df[k] = q.df;
    }
  }
  const bilinear = (G, px, py) => {
    const gx = Math.min(SUB - 1e-6, px / SUB);
    const gy = Math.min(SUB - 1e-6, py / SUB);
    const j = Math.floor(gx);
    const i = Math.floor(gy);
    const fx = gx - j;
    const fy = gy - i;
    const a = G[i * N + j];
    const b = G[i * N + j + 1];
    const c = G[(i + 1) * N + j];
    const dd = G[(i + 1) * N + j + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + dd * fx) * fy;
  };
  const terdekatGrid = (G, px, py) => G[Math.round(py / SUB) * N + Math.round(px / SUB)];

  const mPerPx = ukuranPiksel((n0.lat + s0.lat) / 2, z);
  const jarakLereng = z >= 13 ? 2 : 1;
  const g = kanvas.getContext('2d');
  const img = g.createImageData(256, 256);
  const px4 = img.data;
  const dLonKm = 111.32 * Math.cos((d.lat * Math.PI) / 180);

  for (let cy = 0; cy < 256 / SEL; cy++) {
    const la = latBaris[cy];
    const py = cy * SEL + SEL / 2;
    for (let cx = 0; cx < 256 / SEL; cx++) {
      const lo = lonKolom[cx];
      const ddx = (lo - d.lon) * dLonKm;
      const ddy = (la - d.lat) * 110.57;
      if (ddx * ddx + ddy * ddy > d.radiusKm * d.radiusKm) continue;
      const px = cx * SEL + SEL / 2;
      const elev = e[py * 256 + px];
      const sdc = bilinear(dc, px, py);
      if (adalahLaut(elev, sdc, d)) continue;
      const s = lerengDi(e, px, py, mPerPx, jarakLereng);
      const q = { dc: Math.abs(sdc), dr: bilinear(dr, px, py), er: terdekatGrid(er, px, py), df: bilinear(df, px, py) };
      const lv = hitungLevel(d, la, lo, elev, s, q)[pilihan];
      const [r, gg, b, a] = WARNA[lv];
      const alpha = Math.round(a * 255);
      for (let yy = cy * SEL; yy < cy * SEL + SEL; yy++) {
        for (let xx = cx * SEL; xx < cx * SEL + SEL; xx++) {
          const k = (yy * 256 + xx) * 4;
          px4[k] = r;
          px4[k + 1] = gg;
          px4[k + 2] = b;
          px4[k + 3] = alpha;
        }
      }
    }
  }
  g.putImageData(img, 0, 0);
}

const LapisanZona = L.GridLayer.extend({
  createTile(coords, done) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    gambarTile(c, coords).then(() => done(null, c), (err) => {
      console.warn('zona tile', err);
      done(null, c);
    });
    return c;
  },
});

export const lapisanZona = new LapisanZona({
  minZoom: 10, minNativeZoom: 10, maxNativeZoom: DEM_MAKS_ZOOM, zIndex: 250, keepBuffer: 1, updateWhenIdle: true, className: 'lapisan-zona',
}).addTo(map);
kontrolLapisan.addOverlay(lapisanZona, '<b>Zona bahaya berwarna</b>');

// ---------- Kontrol: chip pemilih bencana + legenda (mengambang di atas peta) ----------
const bar = document.getElementById('zona-bar');
bar.innerHTML = `
  <div class="zona-chips">${BAHAYA.map((b) => `<button type="button" data-z="${b.id}" title="${esc(PENJELASAN[b.id])}"><i data-lucide="${b.ikon}"></i>${b.label}</button>`).join('')}</div>
  <div class="zona-legenda glass">${NAMA_LEVEL.map((n, i) => `<span><i data-lv="${i}" style="background:${WARNA_CSS[i]}"></i>${n}</span>`).join('')}<span class="zl-status" data-status></span></div>
  <div class="zona-ket glass" data-ket></div>`;
document.addEventListener('tema:ganti', () => {
  hitungWarna();
  bar.querySelectorAll('[data-lv]').forEach((i) => { i.style.background = WARNA_CSS[+i.dataset.lv]; });
  lapisanZona.redraw();
});
L.DomEvent.disableClickPropagation(bar);
L.DomEvent.disableScrollPropagation(bar);
bar.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => pilihBahaya(b.dataset.z)));

function perbaruiKontrol() {
  bar.querySelectorAll('[data-z]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.z === pilihan)));
  let status = '';
  if (!data) status = 'menghitung…';
  else if (map.getZoom() < 10) status = 'perbesar peta';
  else status = `radius ${data.radiusKm} km`;
  $('[data-status]', bar).textContent = status;
  const ket = `${PENJELASAN[pilihan]} Ketuk peta untuk cek titik mana pun.`;
  $('[data-ket]', bar).textContent = ket;
  $('.zona-legenda', bar).title = ket;
}
map.on('zoomend', perbaruiKontrol);

export const bahayaTerpilih = () => pilihan;

/** Pilih bencana yang diwarnai. opsi.diam = jangan kirim event (mencegah putaran sinkronisasi). */
export function pilihBahaya(id, opsi = {}) {
  if (!BAHAYA.some((b) => b.id === id)) return;
  if (id !== pilihan) {
    pilihan = id;
    lapisanZona.redraw();
  }
  perbaruiKontrol();
  const u = new URL(location.href);
  if (id === 'gabungan') u.searchParams.delete('zona');
  else u.searchParams.set('zona', id);
  history.replaceState(null, '', u);
  if (!opsi.diam) document.dispatchEvent(new CustomEvent('zona:pilih', { detail: id }));
}

// ---------- Data ----------
export function kosongkanZona() {
  data = null;
  lapisanZona.redraw();
  perbaruiKontrol();
}

export async function setDataZona({ lat, lon, osm, sesar, gunung, api, cuaca, skorHujan }) {
  const d = { lat, lon, radiusKm: RADIUS.zona.km, hujan: skorHujan ?? 0 };

  // Garis pantai OSM selalu berarah dengan daratan di sisi kiri; simpan arah segmen untuk menentukan sisi laut.
  d.pantai = new IndeksTitik(0.02);
  for (const g of osm?.pantai || []) {
    const p = rapatkan(g, 0.15);
    for (let i = 0; i < p.length; i++) {
      const [a1, b1] = p[Math.max(0, i - 1)];
      const [a2, b2] = p[Math.min(p.length - 1, i + 1)];
      d.pantai.tambah(p[i][0], p[i][1], { utara: a2 - a1, timur: (b2 - b1) * Math.cos((a1 * Math.PI) / 180) });
    }
  }

  d.sesar = new IndeksTitik(0.02);
  for (const f of sesar || []) for (const g of f.garis) for (const [a, b] of rapatkan(g, 0.2)) d.sesar.tambah(a, b, f.nama);

  // Titik sungai tiap ±100 m beserta elevasinya (untuk ketinggian relatif terhadap sungai)
  const titikSungai = [];
  for (const s of osm?.sungai || []) for (const p of rapatkan(s.garis, 0.1)) titikSungai.push([p[0], p[1], s.nama]);
  const elev = await Promise.all(titikSungai.map(([a, b]) => sampelTitik(a, b, 12).then((r) => r.elev, () => NaN)));
  d.sungai = new IndeksTitik(0.01);
  titikSungai.forEach(([a, b, nama], i) => {
    if (Number.isFinite(elev[i])) d.sungai.tambah(a, b, { elev: elev[i], nama });
  });

  d.gunung = (gunung || []).filter((v) => v.level >= 2 && jarakKm(lat, lon, v.lat, v.lon) <= d.radiusKm + 40);
  d.api = (api || []).filter((t) => jarakKm(lat, lon, t.lat, t.lon) <= d.radiusKm + 35);
  const c = cuaca?.current;
  d.angin = c && c.wind_speed_10m >= 3 ? { ke: (c.wind_direction_10m + 180) % 360 } : null;

  data = d;
  lapisanZona.redraw();
  perbaruiKontrol();
}

/** Tingkat bahaya semua bencana di satu titik (untuk popup klik & penyaringan tempat aman). */
export async function nilaiDi(lat, lon) {
  const d = data;
  if (!d) return null;
  const { elev, lereng } = await sampelTitik(lat, lon, 13);
  const q = jarakSumber(d, lat, lon);
  return {
    ...hitungLevel(d, lat, lon, elev, lereng, q),
    elev, lereng, q,
    dalamArea: jarakKm(lat, lon, d.lat, d.lon) <= d.radiusKm,
  };
}

/**
 * Menilai grid titik di sekitar (lat, lon): elevasi, lereng, dan tingkat semua bencana per titik.
 * Dipakai mode darurat untuk mencari area aman terdekat. Hasil: { sel: [...], ambil(i, j) }.
 */
export async function evaluasiArea(lat, lon, radiusKm, langkahKm) {
  const d = data;
  if (!d) throw new Error('Zona bahaya belum selesai dihitung');
  const z = radiusKm > 8 ? 11 : 13;
  const ky = 110.57;
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  const a = keTile(lat + radiusKm / ky, lon - radiusKm / kx, z);
  const b = keTile(lat - radiusKm / ky, lon + radiusKm / kx, z);
  const tiles = new Map();
  const muat = [];
  for (let tx = Math.floor(a.x / 256); tx <= Math.floor(b.x / 256); tx++) {
    for (let ty = Math.floor(a.y / 256); ty <= Math.floor(b.y / 256); ty++) {
      muat.push(tileElevasi(z, tx, ty).then((e) => tiles.set(`${tx},${ty}`, e)));
    }
  }
  await Promise.all(muat);
  if (d !== data) throw new Error('Lokasi berubah');

  const mPerPx = ukuranPiksel(lat, z);
  // Sel grid dikunci ke kisi tetap (bukan berpusat di lokasi) agar GPS yang bergeser beberapa meter tidak
  // menggeser semua sel dan mengubah area aman yang terpilih. Sel (0,0) adalah sel yang memuat lokasi.
  const { lat0, lon0, kxK, indeks } = kisi(lat, lon, langkahKm);
  const n = Math.ceil(radiusKm / langkahKm) + 1;
  const peta = new Map();
  const sel = [];
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const la = lat0 + (i * langkahKm) / ky;
      const lo = lon0 + (j * langkahKm) / kxK;
      const jarak = jarakKm(lat, lon, la, lo);
      if (jarak > radiusKm) continue;
      const p = keTile(la, lo, z);
      const tx = Math.floor(p.x / 256);
      const ty = Math.floor(p.y / 256);
      const e = tiles.get(`${tx},${ty}`);
      if (!e) continue;
      const px = Math.floor(p.x - tx * 256);
      const py = Math.floor(p.y - ty * 256);
      const elev = e[py * 256 + px];
      const q = jarakSumber(d, la, lo);
      // Sel laut tidak pernah masuk grid. Pemilih area aman juga menolak sel ≤ 0 m (lihat layakTujuan).
      if (adalahLaut(elev, q.sdc, d)) continue;
      const lereng = lerengDi(e, px, py, mPerPx, 2);
      const c = { i, j, lat: la, lon: lo, elev, lereng, jarak, q, lv: hitungLevel(d, la, lo, elev, lereng, q) };
      peta.set(`${i},${j}`, c);
      sel.push(c);
    }
  }
  const ambil = (i, j) => peta.get(`${i},${j}`);
  return { sel, langkahKm, ambil, ambilDi: (la, lo) => ambil(...indeks(la, lo)) };
}

/** Kisi tetap berjarak langkahKm; skala bujur memakai lintang yang dibulatkan agar ikut stabil. */
export function kisi(lat, lon, langkahKm) {
  const ky = 110.57;
  const kxK = 111.32 * Math.cos(((Math.round(lat * 10) / 10) * Math.PI) / 180);
  const lat0 = (Math.round((lat * ky) / langkahKm) * langkahKm) / ky;
  const lon0 = (Math.round((lon * kxK) / langkahKm) * langkahKm) / kxK;
  const indeks = (la, lo) => [Math.round(((la - lat0) * ky) / langkahKm), Math.round(((lo - lon0) * kxK) / langkahKm)];
  return { lat0, lon0, kxK, indeks };
}

export function htmlPopup(v) {
  if (adalahLaut(v.elev, v.q.sdc)) return '<p>Titik ini berada di laut.</p>';
  const baris = ID_BAHAYA.map((id) => {
    const b = BAHAYA.find((x) => x.id === id);
    return `<tr><td>${b.ikon} ${b.label}</td><td><i class="lv-dot" style="background:${WARNA_CSS[v[id]]}"></i>${NAMA_LEVEL[v[id]]}</td></tr>`;
  }).join('');
  const info = [
    `Elevasi ±${Math.round(v.elev)} m · lereng ${v.lereng.toFixed(0)}°`,
    v.q.sesar ? `Sesar ${esc(v.q.sesar.data || '')} ${fmtKm(v.q.sesar.km)}` : null,
    v.q.sungai ? `Sungai ${fmtKm(v.q.sungai.km)}` : null,
    v.q.dc < 99 ? `Pantai ${fmtKm(v.q.dc)}` : null,
  ].filter(Boolean).join('<br>');
  return `<div class="popup-zona">
    <div class="pz-head" style="border-color:${WARNA_CSS[v.gabungan]}"><b>${NAMA_LEVEL[v.gabungan]}</b> <span class="muted">(gabungan)</span></div>
    <table>${baris}</table>
    <p class="meta">${info}</p>
    ${v.dalamArea ? '' : '<p class="meta">⚠ Di luar area analisis; data sungai, pantai &amp; sesar mungkin tidak lengkap.</p>'}
    <button type="button" class="pz-btn" data-analisis>Analisis lokasi ini</button>
    <button type="button" class="pz-btn pz-sekunder" data-tandai>Tandai sebagai titik kumpul</button>
  </div>`;
}

perbaruiKontrol();
