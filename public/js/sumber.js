// Pengambil data dari sumber yang tidak bisa diakses langsung oleh browser biasa (CORS, HTML perlu di-parse,
// CSV besar perlu disaring). Modul ini dipakai di dua tempat:
//   - server.js (Node) untuk endpoint /api/* versi web;
//   - aplikasi Android (Capacitor), memakai HTTP native sehingga tidak butuh server sama sekali.
//
//   /api/gunung     status gunung api (MAGMA Indonesia)
//   /api/geologi    data titik dari Geoportal ESDM/Badan Geologi (litologi, KRB, gerakan tanah, likuefaksi)
//   /api/sesar      patahan aktif di sekitar titik (Badan Geologi)
//   /api/titik-api  titik panas/kebakaran 48 jam terakhir di sekitar titik (NASA FIRMS VIIRS)
//   /api/osm        data OpenStreetMap sekitar titik (Overpass; di-cache & dicoba ulang karena server publik sering sibuk)
//   /api/laporan    laporan warga (banjir, kebakaran, asap, dll.) & area banjir Jakarta dari PetaBencana.id
//   /api/gedung     bentuk & tinggi gedung sekitar titik untuk tampilan 3D (Overpass, di-cache)
//   /api/evakuasi-resmi  titik kumpul / TES / TEA resmi BNPB (InaRISK) bila tersedia di area itu

const UA = 'TerraWoi/0.3 (aplikasi pemantau lokal)';
const DI_NODE = typeof window === 'undefined';

// ---------- Pengambil HTTP (bisa diganti, mis. HTTP native di Android) ----------
/** fn(url, { method, body (objek form), timeout }) -> Promise<{ status, text }> */
let permintaan = async (url, { method = 'GET', body, timeout }) => {
  const res = await fetch(url, {
    method,
    body: body ? new URLSearchParams(body) : undefined,
    headers: DI_NODE ? { 'User-Agent': UA } : undefined, // browser melarang mengubah User-Agent
    signal: AbortSignal.timeout(timeout),
  });
  return { status: res.status, text: await res.text() };
};
export const aturPermintaan = (fn) => { permintaan = fn; };

async function ambil(url, { timeout = 30000, json = false, method, body } = {}) {
  const { status, text } = await permintaan(url, { method, body, timeout });
  if (status < 200 || status >= 300) throw new Error(`HTTP ${status} dari ${new URL(url).host}`);
  if (!json) return text;
  // Server yang sedang maintenance (mis. Geoportal ESDM) menjawab HTTP 200 berisi halaman HTML.
  if (/^\s*</.test(text)) {
    const judul = text.match(/<title>\s*([^<]*?)\s*<\/title>/i)?.[1];
    throw new Error(`${new URL(url).host} tidak mengirim data${/maintenance/i.test(judul || '') ? ' (sedang maintenance)' : ''}`);
  }
  return JSON.parse(text);
}

// ---------- Cache ----------
// Memori untuk semua; simpanan tahan lama (disk di server, Cache Storage di aplikasi) untuk data Overpass.
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < ttlMs) return hit.value;
  // Promise disimpan langsung agar permintaan serentak untuk kunci yang sama tidak mengambil ulang.
  const value = fn();
  cache.set(key, { time: Date.now(), value });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
  return value;
}

/** { baca(kunci, umurMs) -> Promise<nilai|null>, tulis(kunci, nilai) -> Promise } */
let simpanan = { baca: async () => null, tulis: async () => {} };
export const aturSimpanan = (s) => { simpanan = s; };

async function denganSimpanan(kunci, umurMs, fn) {
  try {
    const ada = await simpanan.baca(kunci, umurMs);
    if (ada) return ada;
  } catch { /* belum ada */ }
  const hasil = await fn();
  try {
    await simpanan.tulis(kunci, hasil);
  } catch (e) {
    console.warn(`[${kunci}] gagal menyimpan cache:`, e.message);
  }
  return hasil;
}

// ---------- MAGMA: status gunung api ----------
const MAGMA_URL = 'https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas';
const LEVELS = { I: 1, II: 2, III: 3, IV: 4 };

export function parseMagma(html) {
  // Halaman berisi tabel berurutan: judul "Level X (...)" lalu daftar "Nama - Wilayah <a href=laporan>".
  const re = /Level (IV|III|II|I) \(|<td>\s*([^<>]+?)\s+-\s+([^<>]+?)\s*<a href="([^"]*laporan[^"]*)"/g;
  const items = [];
  let level = null;
  for (const m of html.matchAll(re)) {
    if (m[1]) {
      level = LEVELS[m[1]];
    } else if (level) {
      items.push({ nama: m[2].trim(), wilayah: m[3].trim(), level, laporan: m[4].replace(/&amp;/g, '&') });
    }
  }
  return items;
}

function getGunung() {
  return cached('gunung', 30 * 60e3, async () => {
    const items = parseMagma(await ambil(MAGMA_URL));
    if (items.length === 0) throw new Error('Format halaman MAGMA berubah, tidak ada data terbaca');
    return { sumber: MAGMA_URL, diperbarui: new Date().toISOString(), items };
  });
}

// ---------- Geoportal ESDM (Badan Geologi) ----------
const ESDM = 'https://geoportal.esdm.go.id/gis4/rest/services';
const ESDM_LAYER = {
  litologi: { svc: 'BGS_PM/Geologi_Litologi', fields: 'simobj,namobj,remark,umurobj' },
  gerakan_tanah: { svc: 'BGV_GT/Zona_Kerentanan_Gerakan_Tanah', fields: 'unsur,tahun' },
  prakiraan_gt: { svc: 'BGV_GT/Prakiraan_Gerakan_Tanah_Bulanan', fields: 'unsur,zona_perki,keterangan,wilayah' },
  krb_gempa: { svc: 'BGV_GT/KRB_Gempa_Bumi', fields: 'kelas,namobj' },
  krb_tsunami: { svc: 'BGV_GT/KRB_Tsunami', fields: 'unsur,keterangan,provinsi' },
  likuefaksi: { svc: 'BGE_GT/Kerentanan_Likuefaksi', fields: 'kerentanan,keterangan' },
  krb_gunung: { svc: 'BGV_GA/KRB_Gunung_Api_Area', fields: 'namobj,lcode,remark' },
};

async function esdmTitik(key, lat, lon) {
  const { svc, fields } = ESDM_LAYER[key];
  const url = `${ESDM}/${svc}/MapServer/0/query?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326`
    + `&spatialRel=esriSpatialRelIntersects&outFields=${fields}&returnGeometry=false&f=json`;
  const j = await ambil(url, { json: true, timeout: 30000 });
  if (j.error) throw new Error(j.error.message || 'galat ESDM');
  return j.features.map((f) => f.attributes);
}

async function namaLayerPrakiraan() {
  return cached('nama-prakiraan', 24 * 3600e3, async () => {
    const j = await ambil(`${ESDM}/BGV_GT/Prakiraan_Gerakan_Tanah_Bulanan/MapServer/0?f=json`, { json: true });
    return j.name || null;
  });
}

function getGeologi(lat, lon) {
  return cached(`geo:${lat.toFixed(4)},${lon.toFixed(4)}`, 6 * 3600e3, async () => {
    const keys = Object.keys(ESDM_LAYER);
    const hasil = await Promise.allSettled(keys.map((k) => esdmTitik(k, lat, lon)));
    const out = { sumber: 'Badan Geologi – Geoportal ESDM' };
    keys.forEach((k, i) => {
      out[k] = hasil[i].status === 'fulfilled' ? hasil[i].value : { error: hasil[i].reason.message };
    });
    out.prakiraan_gt_judul = await namaLayerPrakiraan().catch(() => null);
    return out;
  });
}

// Salinan tersimpan dipakai bila server sumber mati (mis. Geoportal ESDM maintenance).
// Data dianggap segar selama `segarMs`; setelah itu diunduh ulang, tetapi salinan lama tetap jadi cadangan.
async function denganCadangan(kunci, segarMs, fn) {
  try {
    const ada = await simpanan.baca(kunci, segarMs);
    if (ada) return ada;
  } catch { /* belum ada */ }
  try {
    const hasil = { ...(await fn()), disimpan: new Date().toISOString() };
    simpanan.tulis(kunci, hasil).catch((e) => console.warn(`[${kunci}] gagal menyimpan cache:`, e.message));
    return hasil;
  } catch (galat) {
    const lama = await simpanan.baca(kunci, Infinity).catch(() => null);
    if (lama) return { ...lama, cadangan: true, galat: galat.message };
    throw galat;
  }
}

function getSesar(lat, lon, radiusKm) {
  const dLat = radiusKm / 110.57;
  const dLon = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  // Kotak dibulatkan keluar ke kisi 0,1° (±11 km) agar lokasi berdekatan memakai salinan yang sama.
  const bawah = (n) => (Math.floor(n * 10) / 10).toFixed(1);
  const atas = (n) => (Math.ceil(n * 10) / 10).toFixed(1);
  const env = [bawah(lon - dLon), bawah(lat - dLat), atas(lon + dLon), atas(lat + dLat)].join(',');
  const q = (svc, fields) => `${ESDM}/${svc}/MapServer/0/query?geometry=${env}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326`
    + `&spatialRel=esriSpatialRelIntersects&outFields=${fields}&returnGeometry=true&geometryPrecision=4&f=json`;

  return cached(`sesar:${env}`, 24 * 3600e3, () => denganCadangan(`sesar_${env.replace(/,/g, '_')}`, 30 * 24 * 3600e3, async () => {
    const [besar, kecil] = await Promise.allSettled([
      ambil(q('BGS_PM/Patahan_Aktif_Skala_Besar', 'simobj,namobj,klspthn,pjgpthn,lokasi,sjrhgempa'), { json: true, timeout: 40000 }),
      ambil(q('BGS_PM/Patahan_Aktif_Skala_Kecil', 'nama_patah'), { json: true, timeout: 40000 }),
    ]);
    const fitur = [];
    // Esri: geometry.paths = [[[lon,lat],...],...] -> ubah ke [[lat,lon],...]
    const garis = (g) => (g?.paths || []).map((p) => p.map(([x, y]) => [y, x]));
    if (besar.status === 'fulfilled' && !besar.value.error) {
      for (const f of besar.value.features) {
        const a = f.attributes;
        fitur.push({
          nama: (a.namobj || '').trim() || 'Patahan tanpa nama',
          kode: a.simobj || null,
          status: a.klspthn || null,
          panjangKm: a.pjgpthn || null,
          lokasi: a.lokasi || null,
          sejarah: a.sjrhgempa && a.sjrhgempa !== 'No Record' ? a.sjrhgempa : null,
          skala: 'detail',
          garis: garis(f.geometry),
        });
      }
    }
    if (kecil.status === 'fulfilled' && !kecil.value.error) {
      for (const f of kecil.value.features) {
        fitur.push({
          nama: (f.attributes.nama_patah || '').replace(/\s+/g, ' ').trim() || 'Patahan tanpa nama',
          skala: 'regional',
          garis: garis(f.geometry),
        });
      }
    }
    if (besar.status === 'rejected' && kecil.status === 'rejected') throw besar.reason;
    return { sumber: 'Badan Geologi – Peta Patahan Aktif', fitur };
  }));
}

// ---------- NASA FIRMS: titik panas ----------
const FIRMS = [
  'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_SouthEast_Asia_48h.csv',
  'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_SouthEast_Asia_48h.csv',
];
const BBOX_ID = { minLat: -12, maxLat: 7, minLon: 94, maxLon: 142 };

export function parseFirms(csv) {
  const baris = csv.trim().split('\n');
  const kolom = baris.shift().split(',');
  const ix = (n) => kolom.indexOf(n);
  const [iLat, iLon, iFrp, iConf, iTgl, iJam, iSat] = ['latitude', 'longitude', 'frp', 'confidence', 'acq_date', 'acq_time', 'satellite'].map(ix);
  const out = [];
  for (const b of baris) {
    const c = b.split(',');
    const lat = +c[iLat];
    const lon = +c[iLon];
    if (lat < BBOX_ID.minLat || lat > BBOX_ID.maxLat || lon < BBOX_ID.minLon || lon > BBOX_ID.maxLon) continue;
    const jam = c[iJam].padStart(4, '0');
    const waktu = Date.parse(`${c[iTgl]}T${jam.slice(0, 2)}:${jam.slice(2)}:00Z`);
    out.push([lat, lon, +c[iFrp], c[iConf], waktu, c[iSat]]);
  }
  return out;
}

function getTitikApi() {
  return cached('firms', 30 * 60e3, async () => {
    const hasil = await Promise.allSettled(FIRMS.map((u) => ambil(u, { timeout: 60000 })));
    const titik = hasil.filter((h) => h.status === 'fulfilled').flatMap((h) => parseFirms(h.value));
    if (hasil.every((h) => h.status === 'rejected')) throw hasil[0].reason;
    return {
      sumber: 'NASA FIRMS (VIIRS S-NPP & NOAA-20), 48 jam',
      diperbarui: new Date().toISOString(),
      kolom: ['lat', 'lon', 'frp', 'confidence', 'waktu', 'satelit'],
      titik,
    };
  });
}

// ---------- OpenStreetMap (Overpass) ----------
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

// Kueri dipecah dua dan dijalankan bersamaan: titik/bangunan (kecil) dan garis sungai/pantai (besar).
// Keduanya masing-masing ±40 detik di Overpass publik; digabung jadi satu kueri berurutan ±56 detik.
function kueriTitik(lat, lon, rBangunanM) {
  const p = `${lat},${lon}`;
  return `[out:json][timeout:90];
(
  nwr(around:10000,${p})[emergency~"^(assembly_point|evacuation_point|shelter)$"];
  nwr(around:10000,${p})[evacuation_center=yes];
  nwr(around:10000,${p})[evacuation_centre=yes];
  nwr(around:5000,${p})[amenity=shelter];
  nwr(around:3000,${p})[amenity~"^(school|college|university|place_of_worship|townhall|community_centre)$"];
  nwr(around:8000,${p})[amenity~"^(hospital|fire_station|police)$"];
  nwr(around:2000,${p})[leisure~"^(park|pitch|stadium|common|recreation_ground)$"];
  way(around:2000,${p})[landuse~"^(grass|recreation_ground|village_green|meadow)$"];
  nwr(around:2000,${p})[place=square];
);
out center tags;
way(around:${rBangunanM},${p})[building][~"^(building:levels|height)$"~"."];
out center tags;
way(around:${rBangunanM},${p})[building];
out count;`;
}

function kueriAir(lat, lon, { rSungaiKm, rPantaiKm }) {
  const p = `${lat},${lon}`;
  const kotak = (km) => {
    const dLat = km / 110.57;
    const dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
    return [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((n) => n.toFixed(5)).join(',');
  };
  return `[out:json][timeout:90];
(
  way(around:${rSungaiKm * 1000},${p})[waterway=river];
  way(around:3000,${p})[waterway=canal];
);
out geom(${kotak(rSungaiKm + 1)});
way(around:${rPantaiKm * 1000},${p})[natural=coastline];
out geom(${kotak(rPantaiKm + 1)});`;
}

// Hasil Overpass juga disimpan tahan lama (7 hari) karena server publik sering sibuk dan cache memori hilang saat restart.
const UMUR_OSM = 7 * 24 * 3600e3;

async function getOsm(lat, lon) {
  // Titik dibulatkan ±10 m. Sungai/pantai (radius belasan km) dibulatkan ±1 km dan radiusnya ditambah
  // 1 km, sehingga lokasi berdekatan memakai cache yang sama tanpa kehilangan cakupan.
  const la = +lat.toFixed(4);
  const lo = +lon.toFixed(4);
  const la2 = +lat.toFixed(2);
  const lo2 = +lon.toFixed(2);
  const [titik, air] = await Promise.all([
    cached(`osmt:${la},${lo}`, 24 * 3600e3, () => denganSimpanan(`t_${la}_${lo}_v3`, UMUR_OSM,
      () => ambilOverpass(kueriTitik(la, lo, 600)))),
    cached(`osma:${la2},${lo2}`, 24 * 3600e3, () => denganSimpanan(`a_${la2}_${lo2}_v3`, UMUR_OSM,
      () => ambilOverpass(kueriAir(la2, lo2, { rSungaiKm: 17, rPantaiKm: 26 })))),
  ]);
  return { sumber: 'OpenStreetMap (Overpass)', elements: [...titik.elements, ...air.elements] };
}

async function ambilOverpass(kueri) {
  const body = { data: kueri };
  let galat;
  for (let coba = 0; coba < 3; coba++) {
    for (const url of OVERPASS) {
      try {
        const { status, text } = await permintaan(url, { method: 'POST', body, timeout: 100000 });
        if (status === 200) return { sumber: 'OpenStreetMap (Overpass)', elements: JSON.parse(text).elements };
        galat = new Error(`Overpass HTTP ${status}${status === 429 || status === 504 ? ' (server sibuk)' : ''}`);
      } catch (e) {
        galat = e;
      }
    }
    await tunggu(4000 * (coba + 1));
  }
  throw galat;
}

// ---------- PetaBencana.id: laporan warga & area banjir ----------
// Lisensi data: CC BY-NC 4.0 (non-komersial), atribusi wajib ditampilkan di aplikasi.
const PETABENCANA = 'https://api.petabencana.id';
const UMUR_AREA_BANJIR = 12 * 3600e3; // data area banjir yang lebih lama dianggap sudah surut

function getLaporan() {
  return cached('petabencana', 5 * 60e3, async () => {
    const [lapR, areaR] = await Promise.allSettled([
      ambil(`${PETABENCANA}/reports?timeperiod=604800&geoformat=geojson&format=json`, { json: true, timeout: 30000 }),
      ambil(`${PETABENCANA}/floods?admin=ID-JK&minimum_state=1&geoformat=geojson&format=json`, { json: true, timeout: 30000 }),
    ]);
    if (lapR.status === 'rejected') throw lapR.reason;
    const laporan = (lapR.value.result?.features || []).filter((f) => f.geometry?.type === 'Point' && !f.properties.is_training).map((f) => {
      const p = f.properties;
      return {
        id: p.pkey,
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        waktu: p.created_at,
        jenis: p.disaster_type,
        kedalaman: p.report_data?.flood_depth ?? null,
        foto: p.image_url || null,
        teks: (p.text || '').slice(0, 280),
        kota: p.tags?.city || null,
      };
    });
    const kini = Date.now();
    const areaBanjir = areaR.status === 'fulfilled'
      ? (areaR.value.result?.features || [])
        .filter((f) => kini - Date.parse(f.properties.last_updated) < UMUR_AREA_BANJIR)
        .map((f) => ({ geometry: f.geometry, nama: `${f.properties.area_name}, ${f.properties.parent_name}`, kota: f.properties.city_name, tingkat: f.properties.state, waktu: f.properties.last_updated }))
      : [];
    return {
      sumber: 'PetaBencana.id',
      atribusi: 'Data disediakan oleh PetaBencana.id, dilisensikan di bawah CC BY-NC 4.0.',
      diperbarui: new Date().toISOString(),
      laporan,
      areaBanjir,
    };
  });
}

// ---------- Bentuk gedung untuk tampilan 3D ----------
// Diminta terpisah dari /api/osm karena ukurannya besar dan hanya dibutuhkan peta.
const R_GEDUNG_M = 800;

function getGedung(lat, lon) {
  const la = +lat.toFixed(3); // ±100 m: geser sedikit tetap memakai cache yang sama
  const lo = +lon.toFixed(3);
  return cached(`gedung:${la},${lo}`, 24 * 3600e3, () => denganSimpanan(`gedung_${la}_${lo}`, UMUR_OSM, async () => {
    const kueri = `[out:json][timeout:90];way(around:${R_GEDUNG_M},${la},${lo})[building][building!=roof];out geom;`;
    let galat;
    for (let coba = 0; coba < 2; coba++) {
      for (const url of OVERPASS) {
        try {
          const { status, text } = await permintaan(url, { method: 'POST', body: { data: kueri }, timeout: 100000 });
          if (status !== 200) throw new Error(`Overpass HTTP ${status}`);
          return ringkasGedung(JSON.parse(text).elements);
        } catch (e) {
          galat = e;
        }
      }
      await tunggu(4000);
    }
    throw galat;
  }));
}

/** Ringkas: g = [lat, lon, lat, lon, ...] (5 desimal), t = tinggi (m) bila diketahui, l = jumlah lantai, n = nama. */
function ringkasGedung(elements) {
  const gedung = [];
  for (const e of elements) {
    if (!e.geometry || e.geometry.length < 4) continue;
    const t = e.tags || {};
    const g = [];
    for (const p of e.geometry) if (p) g.push(+p.lat.toFixed(5), +p.lon.toFixed(5));
    const item = { g };
    const lantai = parseFloat(t['building:levels']);
    const tinggi = parseFloat(t.height);
    if (Number.isFinite(tinggi) && tinggi > 0) item.t = Math.min(tinggi, 600);
    if (Number.isFinite(lantai) && lantai > 0) item.l = Math.min(lantai, 150);
    if (t.name) item.n = t.name;
    gedung.push(item);
  }
  return { sumber: 'OpenStreetMap (Overpass)', radiusM: R_GEDUNG_M, gedung };
}

// ---------- BNPB: tempat evakuasi resmi (InaRISK) ----------
// Data rencana evakuasi BNPB baru tersedia untuk daerah percontohan (mis. Badung, Bali).
const BNPB = 'https://gis.bnpb.go.id/server/rest/services';
const LAYER_EVAKUASI = [
  { svc: 'inarisk/RENEVAK_tsunami/MapServer/10', jenis: 'Titik kumpul' },
  { svc: 'inarisk/RENEVAK_tsunami/MapServer/12', jenis: 'Tempat Evakuasi Sementara (TES)' },
  { svc: 'inarisk/RENEVAK_tsunami/MapServer/11', jenis: 'Tempat Evakuasi Akhir (TEA, usulan)' },
  { svc: 'inarisk/RENEVAK_tsunami/MapServer/7', jenis: 'Evakuasi vertikal' },
  { svc: 'inarisk/RENEVAK_tsunami/MapServer/3', jenis: 'Evakuasi horizontal' },
];

function getEvakuasiResmi(lat, lon) {
  const dLat = 15 / 110.57;
  const dLon = 15 / (111.32 * Math.cos((lat * Math.PI) / 180));
  const env = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((n) => n.toFixed(3)).join(',');
  return cached(`bnpb-evak:${env}`, 24 * 3600e3, async () => {
    const hasil = await Promise.allSettled(LAYER_EVAKUASI.map(async (l) => {
      const url = `${BNPB}/${l.svc}/query?geometry=${env}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326`
        + '&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&f=json';
      const j = await ambil(url, { json: true, timeout: 30000 });
      if (j.error) throw new Error(j.error.message || 'galat BNPB');
      return j.features.filter((f) => f.geometry).map((f) => {
        const a = f.attributes;
        return {
          lat: f.geometry.y,
          lon: f.geometry.x,
          nama: (a.Nama_Obyek || a.NAMA || a.Nama || a.nama || '').toString().trim() || null,
          jenis: l.jenis,
          keterangan: [a.Keterangan, a.T_Evakuasi].filter(Boolean).join(' · ') || null,
          kapasitas: parseInt(String(a.Dy_Tampung || a.KAPASITAS || '').split(/\s/)[0], 10) || null,
        };
      });
    }));
    const titik = hasil.filter((h) => h.status === 'fulfilled').flatMap((h) => h.value);
    if (hasil.every((h) => h.status === 'rejected')) throw hasil[0].reason;
    return { sumber: 'BNPB InaRISK – Rencana Evakuasi', titik };
  });
}

// ---------- Rute /api/* ----------
function koordinat(q) {
  const lat = parseFloat(q.get('lat'));
  const lon = parseFloat(q.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw Object.assign(new Error('Parameter lat/lon tidak valid'), { status: 400 });
  }
  return { lat, lon };
}

export const RUTE = {
  '/api/gunung': () => getGunung(),
  '/api/geologi': (q) => { const { lat, lon } = koordinat(q); return getGeologi(lat, lon); },
  '/api/sesar': (q) => {
    const { lat, lon } = koordinat(q);
    const r = Math.min(150, Math.max(5, parseFloat(q.get('r')) || 100));
    return getSesar(lat, lon, r);
  },
  '/api/osm': (q) => { const { lat, lon } = koordinat(q); return getOsm(lat, lon); },
  '/api/laporan': () => getLaporan(),
  '/api/gedung': (q) => { const { lat, lon } = koordinat(q); return getGedung(lat, lon); },
  '/api/evakuasi-resmi': (q) => { const { lat, lon } = koordinat(q); return getEvakuasiResmi(lat, lon); },
  '/api/titik-api': async (q) => {
    const { lat, lon } = koordinat(q);
    const r = Math.min(500, Math.max(1, parseFloat(q.get('r')) || 100));
    const semua = await getTitikApi();
    // Saring kasar dengan kotak, jarak sebenarnya dihitung di klien.
    const dLat = r / 110.57;
    const dLon = r / (111.32 * Math.cos((lat * Math.PI) / 180));
    const titik = semua.titik.filter(([a, b]) => Math.abs(a - lat) <= dLat && Math.abs(b - lon) <= dLon);
    return { ...semua, titik, totalIndonesia: semua.titik.length };
  },
};
