// Logika endpoint /api/* yang dipakai bersama oleh server Node (server.js) dan aplikasi Android.
// Sumber-sumber ini memblokir CORS sehingga tidak bisa diambil langsung dari halaman web:
//   /api/gunung     status gunung api (MAGMA Indonesia)
//   /api/geologi    data titik dari Geoportal ESDM/Badan Geologi (litologi, KRB, gerakan tanah, likuefaksi)
//   /api/sesar      patahan aktif di sekitar titik (Badan Geologi)
//   /api/titik-api  titik panas/kebakaran 48 jam terakhir di sekitar titik (NASA FIRMS VIIRS)
//   /api/osm        data OpenStreetMap sekitar titik (Overpass; di-cache & dicoba ulang karena server publik sering sibuk)
//   /api/laporan    laporan warga (banjir, kebakaran, asap, dll.) & area banjir Jakarta dari PetaBencana.id
//   /api/gedung     bentuk & tinggi gedung sekitar titik untuk tampilan 3D (Overpass, di-cache)
//   /api/evakuasi-resmi  titik kumpul / TES / TEA resmi BNPB (InaRISK) bila tersedia di area itu
//
// Pemanggil menyediakan dua hal:
//   ambil(url, { timeout, json }) -> teks atau JSON; melempar galat bila HTTP tidak OK
//   disk (opsional) -> { baca(kunci, umurMs), tulis(kunci, nilai) } untuk cache yang bertahan setelah restart
// Server Node memakai fetch + berkas di .cache/, aplikasi Android memakai proxy native + Cache Storage.

const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ---------- OpenStreetMap (Overpass) ----------
// Kueri dikirim dengan GET (didukung Overpass) agar bisa lewat proxy native aplikasi Android.
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UMUR_OSM = 7 * 24 * 3600e3;

function kueriOsm(lat, lon, { rBangunanM, rSungaiKm, rPantaiKm }) {
  const p = `${lat},${lon}`;
  const kotak = (km) => {
    const dLat = km / 110.57;
    const dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
    return [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((n) => n.toFixed(5)).join(',');
  };
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
out count;
(
  way(around:${rSungaiKm * 1000},${p})[waterway=river];
  way(around:3000,${p})[waterway=canal];
);
out geom(${kotak(rSungaiKm + 1)});
way(around:${rPantaiKm * 1000},${p})[natural=coastline];
out geom(${kotak(rPantaiKm + 1)});`;
}

/** Ringkas: g = [lat, lon, lat, lon, ...] (5 desimal), t = tinggi (m) bila diketahui, l = jumlah lantai, n = nama. */
const R_GEDUNG_M = 800;
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

// ---------- PetaBencana.id: laporan warga & area banjir ----------
// Lisensi data: CC BY-NC 4.0 (non-komersial), atribusi wajib ditampilkan di aplikasi.
const PETABENCANA = 'https://api.petabencana.id';
const UMUR_AREA_BANJIR = 12 * 3600e3; // data area banjir yang lebih lama dianggap sudah surut

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

/** Kotak (minLon,minLat,maxLon,maxLat) selebar radiusKm di sekitar titik. */
function amplop(lat, lon, radiusKm, desimal) {
  const dLat = radiusKm / 110.57;
  const dLon = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((n) => n.toFixed(desimal)).join(',');
}

function koordinat(u) {
  const lat = parseFloat(u.searchParams.get('lat'));
  const lon = parseFloat(u.searchParams.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw Object.assign(new Error('Parameter lat/lon tidak valid'), { status: 400 });
  }
  return { lat, lon };
}

export function buatApi({ ambil, disk = null }) {
  // ---------- Cache memori (dan disk bila ada) ----------
  const cache = new Map();
  async function cached(key, ttlMs, fn) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.time < ttlMs) return hit.value;
    const value = await fn();
    cache.set(key, { time: Date.now(), value });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return value;
  }
  async function cachedDisk(key, fn) {
    if (disk) {
      try {
        const v = await disk.baca(key, UMUR_OSM);
        if (v) return v;
      } catch { /* belum ada */ }
    }
    const v = await fn();
    if (disk) {
      try { await disk.tulis(key, v); } catch (e) { console.warn('[cache] gagal menyimpan:', e.message); }
    }
    return v;
  }

  async function overpass(kueri, { putaran, jeda }) {
    let galat;
    for (let coba = 0; coba < putaran; coba++) {
      for (const url of OVERPASS) {
        try {
          return await ambil(`${url}?data=${encodeURIComponent(kueri)}`, { json: true, timeout: 100000 });
        } catch (e) {
          galat = /HTTP (429|504)/.test(e.message) ? new Error(`Overpass ${e.message} (server sibuk)`) : e;
        }
      }
      if (coba < putaran - 1) await tunggu(jeda * (coba + 1));
    }
    throw galat;
  }

  function getGunung() {
    return cached('gunung', 30 * 60e3, async () => {
      const items = parseMagma(await ambil(MAGMA_URL));
      if (items.length === 0) throw new Error('Format halaman MAGMA berubah, tidak ada data terbaca');
      return { sumber: MAGMA_URL, diperbarui: new Date().toISOString(), items };
    });
  }

  async function esdmTitik(key, lat, lon) {
    const { svc, fields } = ESDM_LAYER[key];
    const url = `${ESDM}/${svc}/MapServer/0/query?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326`
      + `&spatialRel=esriSpatialRelIntersects&outFields=${fields}&returnGeometry=false&f=json`;
    const j = await ambil(url, { json: true, timeout: 30000 });
    if (j.error) throw new Error(j.error.message || 'galat ESDM');
    return j.features.map((f) => f.attributes);
  }

  function namaLayerPrakiraan() {
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

  function getSesar(lat, lon, radiusKm) {
    const env = amplop(lat, lon, radiusKm, 4);
    const q = (svc, fields) => `${ESDM}/${svc}/MapServer/0/query?geometry=${env}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326`
      + `&spatialRel=esriSpatialRelIntersects&outFields=${fields}&returnGeometry=true&geometryPrecision=4&f=json`;

    return cached(`sesar:${env}`, 24 * 3600e3, async () => {
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
    });
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

  function getOsm(lat, lon) {
    // Dibulatkan ±10 m agar klik berdekatan memakai cache yang sama.
    const la = +lat.toFixed(4);
    const lo = +lon.toFixed(4);
    return cached(`osm2:${la},${lo}`, 24 * 3600e3, () => cachedDisk(`${la}_${lo}_v2`, async () => { // v2: tag evakuasi & bangunan kandidat
      const j = await overpass(kueriOsm(la, lo, { rBangunanM: 600, rSungaiKm: 16, rPantaiKm: 25 }), { putaran: 3, jeda: 4000 });
      return { sumber: 'OpenStreetMap (Overpass)', elements: j.elements };
    }));
  }

  function getGedung(lat, lon) {
    const la = +lat.toFixed(3); // ±100 m: geser sedikit tetap memakai cache yang sama
    const lo = +lon.toFixed(3);
    return cached(`gedung:${la},${lo}`, 24 * 3600e3, () => cachedDisk(`gedung_${la}_${lo}`, async () => {
      const kueri = `[out:json][timeout:90];way(around:${R_GEDUNG_M},${la},${lo})[building][building!=roof];out geom;`;
      return ringkasGedung((await overpass(kueri, { putaran: 2, jeda: 4000 })).elements);
    }));
  }

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

  function getEvakuasiResmi(lat, lon) {
    const env = amplop(lat, lon, 15, 3);
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

  const RUTE = {
    '/api/gunung': () => getGunung(),
    '/api/geologi': (u) => { const { lat, lon } = koordinat(u); return getGeologi(lat, lon); },
    '/api/sesar': (u) => {
      const { lat, lon } = koordinat(u);
      const r = Math.min(150, Math.max(5, parseFloat(u.searchParams.get('r')) || 100));
      return getSesar(lat, lon, r);
    },
    '/api/osm': (u) => { const { lat, lon } = koordinat(u); return getOsm(lat, lon); },
    '/api/laporan': () => getLaporan(),
    '/api/gedung': (u) => { const { lat, lon } = koordinat(u); return getGedung(lat, lon); },
    '/api/evakuasi-resmi': (u) => { const { lat, lon } = koordinat(u); return getEvakuasiResmi(lat, lon); },
    '/api/titik-api': async (u) => {
      const { lat, lon } = koordinat(u);
      const r = Math.min(500, Math.max(1, parseFloat(u.searchParams.get('r')) || 100));
      const semua = await getTitikApi();
      // Saring kasar dengan kotak, jarak sebenarnya dihitung di browser.
      const dLat = r / 110.57;
      const dLon = r / (111.32 * Math.cos((lat * Math.PI) / 180));
      const titik = semua.titik.filter(([a, b]) => Math.abs(a - lat) <= dLat && Math.abs(b - lon) <= dLon);
      return { ...semua, titik, totalIndonesia: semua.titik.length };
    },
  };

  return {
    /** true bila path ini ditangani modul ini. */
    punya: (pathname) => Object.hasOwn(RUTE, pathname),
    /** Jalankan endpoint untuk URL (objek URL). Mengembalikan { status, body }. */
    async tangani(u) {
      try {
        return { status: 200, body: await RUTE[u.pathname](u) };
      } catch (err) {
        console.error(`[${u.pathname}]`, err.message);
        return { status: err.status || 502, body: { error: err.message } };
      }
    },
  };
}
