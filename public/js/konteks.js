// Data bersama untuk satu lokasi. Tiap sumber diambil sekali (sebagai Promise) lalu dipakai banyak modul.
import { getJson, jarakKm } from './util.js';
import { RADIUS } from './config.js';
import { sampelTitik } from './dem.js';

// Data yang jarang berubah (geologi, OSM, elevasi) dipakai ulang saat lokasi sama (mis. refresh otomatis).
let statis = null;

export function buatKonteks(lat, lon) {
  const ctx = { lat, lon };
  ctx.cuaca = ambilCuaca(lat, lon);
  if (!statis || statis.lat !== lat || statis.lon !== lon || statis.gagal) {
    statis = {
      lat, lon, gagal: false,
      geologi: getJson(`/api/geologi?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`, { timeout: 60000 }),
      osm: ambilOsm(lat, lon),
      gridLokal: gridElevasi(lat, lon, RADIUS.aman.km, 9), // ±3 km, jarak antartitik 750 m
      gridLuas: gridElevasi(lat, lon, 10, 9), // ±10 km untuk evakuasi tsunami
    };
    const s = statis;
    for (const k of ['geologi', 'osm', 'gridLokal', 'gridLuas']) s[k].catch(() => { s.gagal = true; });
  }
  Object.assign(ctx, { geologi: statis.geologi, osm: statis.osm, gridLokal: statis.gridLokal, gridLuas: statis.gridLuas });
  // Hindari "unhandled rejection" — setiap modul menangani galatnya sendiri.
  for (const k of ['cuaca', 'geologi', 'osm', 'gridLokal', 'gridLuas']) ctx[k].catch(() => {});
  return ctx;
}

function ambilCuaca(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + '&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m'
    + '&hourly=precipitation,precipitation_probability'
    + '&daily=precipitation_sum,precipitation_probability_max'
    + '&past_days=7&forecast_days=4&timezone=auto';
  return getJson(url);
}

/**
 * Grid elevasi n×n di sekitar titik, dengan kemiringan (derajat) tiap titik dari beda tinggi tetangganya.
 * Grid dikunci ke kisi tetap agar GPS yang bergeser beberapa meter tidak mengubah titik-titiknya (dan
 * tujuan "dataran tinggi" yang diusulkan). Elevasi lokasi persis disimpan di `pusat`.
 */
export async function gridElevasi(lat, lon, radiusKm, n = 9) {
  const kx = 111.32 * Math.cos(((Math.round(lat * 10) / 10) * Math.PI) / 180);
  const ky = 110.57;
  const langkah = (2 * radiusKm) / (n - 1);
  const lat0 = (Math.round((lat * ky) / langkah) * langkah) / ky;
  const lon0 = (Math.round((lon * kx) / langkah) * langkah) / kx;
  const titik = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dy = radiusKm - i * langkah; // baris 0 = utara
      const dx = -radiusKm + j * langkah;
      titik.push({ i, j, lat: lat0 + dy / ky, lon: lon0 + dx / kx });
    }
  }
  // Elevasi dari tile DEM Terrarium (AWS Open Data, di-cache di browser), bukan API elevasi Open-Meteo:
  // grid ini butuh ±80 titik per lokasi dan menghabiskan kuota harian Open-Meteo dengan cepat.
  // Zoom tile disesuaikan jarak antartitik (z12 ±38 m/piksel untuk grid lokal, z11 untuk grid luas).
  const z = langkah > 1.5 ? 11 : 12;
  const semua = [...titik, { lat, lon }];
  const elev = await Promise.all(semua.map((t) => sampelTitik(t.lat, t.lon, z).then((s) => s.elev)));
  titik.forEach((t, k) => { t.elev = elev[k]; });
  const at = (i, j) => titik[Math.max(0, Math.min(n - 1, i)) * n + Math.max(0, Math.min(n - 1, j))].elev;
  const m = langkah * 1000;
  for (const t of titik) {
    const ns = (at(t.i - 1, t.j) - at(t.i + 1, t.j)) / ((t.i > 0 && t.i < n - 1 ? 2 : 1) * m);
    const ew = (at(t.i, t.j + 1) - at(t.i, t.j - 1)) / ((t.j > 0 && t.j < n - 1 ? 2 : 1) * m);
    t.lereng = (Math.atan(Math.hypot(ns, ew)) * 180) / Math.PI;
    t.jarak = jarakKm(lat, lon, t.lat, t.lon);
  }
  const tengah = Math.floor(n / 2);
  const pusat = { lat, lon, jarak: 0, elev: elev[titik.length], lereng: titik[tengah * n + tengah].lereng };
  return { titik, pusat, langkahKm: langkah };
}

/**
 * Data OpenStreetMap lewat server (/api/osm): titik kumpul/evakuasi, ruang terbuka, fasilitas darurat,
 * bangunan bertingkat, jumlah bangunan, sungai, dan garis pantai.
 */
async function ambilOsm(lat, lon) {
  const d = await getJson(`/api/osm?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, { timeout: 150000 });
  return klasifikasiOsm(d.elements, lat, lon);
}

function klasifikasiOsm(elements, lat, lon) {
  const hasil = { titikKumpul: [], potensial: [], ruangTerbuka: [], faskes: [], bangunan: [], totalBangunan: null, sungai: [], pantai: [] };
  const pos = (e) => (e.lat != null ? [e.lat, e.lon] : e.center ? [e.center.lat, e.center.lon] : null);
  for (const e of elements) {
    const t = e.tags || {};
    if (e.type === 'count') {
      hasil.totalBangunan = Number(t.ways ?? t.total ?? 0);
      continue;
    }
    if (t.natural === 'coastline' && e.geometry) {
      hasil.pantai.push(e.geometry.filter(Boolean).map((g) => [g.lat, g.lon]));
      continue;
    }
    if (t.waterway && e.geometry) {
      hasil.sungai.push({ nama: t.name || null, garis: e.geometry.filter(Boolean).map((g) => [g.lat, g.lon]) });
      continue;
    }
    const xy = pos(e);
    if (!xy) continue;
    const item = { lat: xy[0], lon: xy[1], nama: t.name || null, tags: t, jarak: jarakKm(lat, lon, xy[0], xy[1]) };
    if (t.building && (t['building:levels'] || t.height)) {
      const lantai = parseFloat(t['building:levels']);
      const tinggi = parseFloat(t.height);
      item.lantai = Number.isFinite(lantai) ? lantai : Number.isFinite(tinggi) ? Math.max(1, Math.round(tinggi / 3.2)) : null;
      item.tinggi = Number.isFinite(tinggi) ? tinggi : item.lantai ? item.lantai * 3.2 : null;
      if (item.lantai) hasil.bangunan.push(item);
      if (!t.amenity && !t.emergency) continue;
    }
    const evakuasi = t.evacuation_center === 'yes' || t.evacuation_centre === 'yes';
    if (['assembly_point', 'evacuation_point', 'shelter'].includes(t.emergency) || evakuasi) {
      hasil.titikKumpul.push({ ...item, jenis: 'osm' });
    } else if (t.amenity === 'shelter') {
      hasil.titikKumpul.push({ ...item, jenis: 'shelter' });
    } else if (['hospital', 'fire_station', 'police'].includes(t.amenity)) {
      hasil.faskes.push(item);
    } else if (['school', 'college', 'university', 'place_of_worship', 'townhall', 'community_centre'].includes(t.amenity)) {
      if (t.evacuation_center !== 'no') hasil.potensial.push({ ...item, jenis: 'potensial' });
    } else if (t.leisure || t.landuse || t.place === 'square') {
      hasil.ruangTerbuka.push(item);
    }
  }
  for (const k of ['titikKumpul', 'potensial', 'ruangTerbuka', 'faskes', 'bangunan']) hasil[k].sort((a, b) => a.jarak - b.jarak);
  return hasil;
}
