// Rekomendasi tempat paling aman per jenis bahaya, berdasarkan kondisi lokasi:
// titik kumpul & ruang terbuka (OSM), dataran tinggi (grid elevasi), gedung tinggi, arah menjauh dari sumber.
import { esc, bearing, arahKe, namaArah, tujuan, jarakKm, jarakKeGaris, fmtKm, URUTAN_LEVEL, $ } from './util.js';
import { RADIUS, RADIUS_BAHAYA_GUNUNG, LEVEL_GUNUNG } from './config.js';
import { lapisan, map, ikonTitik } from './peta.js';
import { pilihBahaya, bahayaTerpilih, nilaiDi, diLaut, layakTujuan, NAMA_LEVEL, WARNA_CSS } from './zona.js';
import { titikKumpul, namaTitik, JENIS } from './titikkumpul.js';
import { rute } from './rute.js';
import { banjirDiRute } from './laporan.js';

const L = window.L;

let giliranTampil = 0;
// Urutkan titik grid per 250 m jarak, lalu elevasi tertinggi, agar GPS yang bergeser sedikit tidak
// menukar tujuan yang jaraknya hampir sama.
const urutStabil = (a, b) => Math.round(a.jarak * 4) - Math.round(b.jarak * 4) || b.elev - a.elev;
// Tujuan jauh (gunung api, kebakaran) ditempuh dengan kendaraan, sisanya jalan kaki.
const modaUntuk = (t) => (t.jarak > 4 ? 'car' : 'foot');

const nilai = (r) => (r.status === 'fulfilled' ? r.value : null);
// Titik kumpul resmi/pribadi/OSM (tanpa kandidat potensial)
const tkUtama = () => titikKumpul().filter((t) => t.jenis !== 'potensial');
const alasanTk = (t, tambahan = '') => `${JENIS[t.jenis].label}${tambahan}`;

function namaTempat(t, cadangan) {
  if (t.jenis && JENIS[t.jenis]) return namaTitik(t);
  if (t.nama) return t.nama;
  const tg = t.tags || {};
  if (tg.emergency) return 'Titik kumpul evakuasi';
  if (tg.amenity === 'shelter') return 'Shelter';
  if (tg.leisure === 'park') return 'Taman';
  if (tg.leisure === 'pitch' || tg.leisure === 'stadium') return 'Lapangan';
  return cadangan;
}

function opsiGempa(ctx, osm, gempa) {
  // Di dekat sesar aktif, tujuan pertama adalah keluar dari zona sesar (≥ 5,5 km dari jalurnya).
  const keluarSesar = [];
  const sesar = gempa?.sesarTerdekat;
  if (sesar && sesar.km < 5) {
    const menjauh = bearing(...sesar.titik, ctx.lat, ctx.lon);
    const km = 5.5 - sesar.km;
    keluarSesar.push(titikArah(ctx, menjauh, km, sesar.titik, `Luar zona ${sesar.nama}`,
      (a) => `Menjauhi jalur sesar ke arah ${namaArah(a)} (untuk mengungsi/tinggal sementara setelah gempa)`));
  }
  const kandidat = [
    ...tkUtama().filter((t) => t.jarak <= RADIUS.aman.km).map((t) => ({ ...t, bobot: t.jarak * 0.7 })),
    ...(osm?.ruangTerbuka || []).map((t) => ({ ...t, bobot: t.jarak })),
  ].sort((a, b) => a.bobot - b.bobot);
  if (!kandidat.length && !osm) return { arahan: 'Data OpenStreetMap tidak tersedia.', tempat: keluarSesar };
  return {
    arahan: 'Saat guncangan: <b>merunduk, lindungi kepala, bertahan</b>. Setelah berhenti, keluar ke <b>ruang terbuka</b> yang jauh dari gedung, tiang listrik, papan reklame, dan tebing. Waspadai gempa susulan.',
    tempat: [...kandidat.slice(0, 4).map((t) => ({
      ...t, judul: namaTempat(t, 'Ruang terbuka'),
      alasan: t.jenis ? alasanTk(t) : 'Ruang terbuka, minim reruntuhan',
    })), ...keluarSesar],
  };
}

function opsiTsunami(ctx, ts, grids, bangunan, osm) {
  if (!ts) return { arahan: 'Data pantai tidak tersedia.', tempat: [] };
  if (!ts.pesisir) {
    return { arahan: `Lokasi ${ts.pantai ? `${fmtKm(ts.pantai.km)} dari pantai pada elevasi ±${Math.round(ts.elev ?? 0)} m` : 'jauh dari pantai'} — tidak termasuk zona evakuasi tsunami. Tetap ikuti peringatan BMKG bila sedang berada di pantai.`, tempat: [] };
  }
  const titik = grids.flatMap((g) => g.titik);
  const tinggiAman = Math.max(20, (ts.elev ?? 0) + 15);
  const darat = titik
    .filter((t) => t.elev >= tinggiAman && t.lereng < 25 && (!ts.pantai || jarakKeGaris(t.lat, t.lon, [[ts.pantai.titik]]).km >= ts.pantai.km))
    .sort(urutStabil)
    .slice(0, 2)
    .map((t) => ({ ...t, judul: `Dataran tinggi ±${Math.round(t.elev)} m`, alasan: `Lebih tinggi ${Math.round(t.elev - (ts.elev ?? 0))} m dari lokasi, menjauhi pantai` }));
  const vertikal = (bangunan?.tinggi || []).slice().sort((a, b) => a.jarak - b.jarak).slice(0, 2)
    .map((t) => ({ ...t, judul: t.nama || `Gedung ${t.lantai} lantai`, alasan: `Evakuasi vertikal: naik ke lantai ≥ 3 (${t.lantai} lantai)` }));
  const tk = tkUtama().filter((t) => t.jarak <= 5).slice(0, 2).map((t) => ({ ...t, judul: namaTempat(t, 'Titik kumpul'), alasan: alasanTk(t, ' — pastikan berada di tempat tinggi') }));
  const jauhPantai = ts.pantai ? namaArah(bearing(...ts.pantai.titik, ctx.lat, ctx.lon)) : null;
  return {
    arahan: `Bila gempa kuat atau air laut surut: <b>segera menjauh dari pantai${jauhPantai ? ` ke arah ${jauhPantai}` : ''}</b> menuju tanah setinggi ≥ ${tinggiAman} m. Bila tidak sempat (&lt; 15 menit), naik ke lantai atas gedung beton yang kokoh.`,
    tempat: [...darat, ...vertikal, ...tk],
  };
}

function opsiGunung(ctx, gn, osm) {
  const v = gn?.gunungKrb && gn.gunungKrb.level >= 2 ? gn.gunungKrb : gn?.terdekatAktif;
  if (!v || v.jarak > 60) {
    return { arahan: 'Tidak ada gunung api berstatus Waspada atau lebih dalam radius 60 km. Bila terjadi hujan abu, tetap di dalam ruangan dan gunakan masker.', tempat: [] };
  }
  const menjauh = bearing(v.lat, v.lon, ctx.lat, ctx.lon);
  const target = Math.max(RADIUS_BAHAYA_GUNUNG[v.level] + 5, gn.krb ? 15 : 0);
  const tempat = [];
  if (v.jarak < target) {
    tempat.push(titikArah(ctx, menjauh, target - v.jarak, [v.lat, v.lon], `±${target} km dari ${v.nama}`,
      (a) => `Menjauh ke arah ${namaArah(a)}, di luar radius bahaya Level ${v.level}`));
  }
  const tk = tkUtama()
    .filter((t) => jarakKm(t.lat, t.lon, v.lat, v.lon) > Math.max(v.jarak, target))
    .slice(0, 2)
    .map((t) => ({ ...t, judul: namaTempat(t, 'Titik kumpul'), alasan: alasanTk(t, ', lebih jauh dari gunung') }));
  return {
    arahan: `Sumber bahaya: <b>${esc(v.nama)}</b> (Level ${v.level} – ${LEVEL_GUNUNG[v.level].nama}), ${fmtKm(v.jarak)} ke arah ${arahKe(ctx.lat, ctx.lon, v.lat, v.lon)}. `
      + `Bila diperintahkan evakuasi, <b>bergerak ke arah ${namaArah(menjauh)}</b> (menjauhi kawah) dan <b>hindari lembah sungai</b> yang berhulu di gunung (jalur awan panas & lahar). Ikuti jalur evakuasi BPBD.`,
    tempat: [...tempat, ...tk],
  };
}

function opsiBanjirLongsor(ctx, grid, osm, hj) {
  if (!grid) return { arahan: 'Data elevasi tidak tersedia.', tempat: [] };
  const sungai = (osm?.sungai || []).map((s) => s.garis);
  const pusat = grid.pusat;
  const kandidat = grid.titik
    .filter((t) => t !== pusat && t.elev > 0 && t.elev >= pusat.elev + 5 && t.lereng < 10)
    .map((t) => ({ ...t, keSungai: sungai.length ? jarakKeGaris(t.lat, t.lon, sungai).km : Infinity }))
    .filter((t) => t.keSungai >= 0.3)
    .sort(urutStabil)
    .slice(0, 3)
    .map((t) => ({
      ...t, judul: `Area landai ±${Math.round(t.elev)} m`,
      alasan: `+${Math.round(t.elev - pusat.elev)} m dari lokasi, lereng ${t.lereng.toFixed(0)}°, ${Number.isFinite(t.keSungai) ? `${fmtKm(t.keSungai)} dari sungai` : 'jauh dari sungai'}`,
    }));
  return {
    arahan: 'Banjir: pindah ke <b>tempat lebih tinggi</b> yang jauh dari sungai; matikan listrik; jangan menyeberangi arus. '
      + 'Longsor: menjauh dari <b>tebing dan kaki lereng</b>, pilih area landai; jangan berlindung di lembah atau alur sungai kecil.'
      + (hj?.sungai && hj.sungai.km < 0.3 ? ` Lokasi Anda hanya ${fmtKm(hj.sungai.km)} dari sungai.` : ''),
    // Titik kumpul ikut diusulkan; yang berada di zona rawan banjir/longsor akan disaring oleh saringDenganZona.
    tempat: [...kandidat, ...tkUtama().filter((t) => t.jarak <= RADIUS.aman.km).slice(0, 3)
      .map((t) => ({ ...t, judul: namaTempat(t, 'Titik kumpul'), alasan: alasanTk(t) }))],
  };
}

function opsiKebakaran(ctx, kb, cuaca) {
  const kini = cuaca?.current;
  const t = kb?.terdekat;
  const tempat = [];
  let arahan = 'Saat asap: tetap di dalam ruangan, tutup jendela, gunakan masker N95 dan penyaring udara.';
  if (t && t.jarak <= 20) {
    const menjauh = bearing(t.lat, t.lon, ctx.lat, ctx.lon);
    tempat.push(titikArah(ctx, menjauh, Math.max(2, 10 - t.jarak), [t.lat, t.lon], 'Arah menjauhi titik api',
      (a) => `Ke arah ${namaArah(a)}, ≥ 10 km dari titik api terdekat`));
    arahan = `Titik api terdekat ${fmtKm(t.jarak)} ke arah ${arahKe(ctx.lat, ctx.lon, t.lat, t.lon)}. Bila api mendekat, menjauh ke arah <b>${namaArah(menjauh)}</b>`
      + (kini ? `; hindari arah ${namaArah(kini.wind_direction_10m + 180)} karena angin membawa api dan asap ke sana` : '')
      + '. ' + arahan;
  }
  return { arahan, tempat };
}

// Tab rekomendasi <-> jenis zona di peta
const TAB_KE_ZONA = { gempa: 'gempa', tsunami: 'tsunami', gunung: 'gunung', banjir: 'banjir', kebakaran: 'kebakaran' };
const ZONA_KE_TAB = { gempa: 'gempa', tsunami: 'tsunami', gunung: 'gunung', banjir: 'banjir', longsor: 'banjir', kebakaran: 'kebakaran' };
let pendengarZona = null;

/**
 * Tujuan berupa "maju km ke arah tertentu" dari lokasi, menjauhi sumber bahaya. Posisinya diperiksa
 * (dan digeser bila jatuh di laut) oleh keDarat di saringDenganZona.
 */
function titikArah(ctx, arah, km, sumber, judul, alasanArah) {
  const [lat, lon] = tujuan(ctx.lat, ctx.lon, arah, km);
  return { lat, lon, jarak: km, judul, alasan: alasanArah(arah), arah, sumber, alasanArah };
}

const SIMPANGAN = [0, 20, -20, 40, -40, 60, -60, 90, -90];
/**
 * Pastikan titik arah berada di daratan. Bila jatuh di laut, coba arah yang sedikit menyimpang dan jarak
 * yang lebih pendek/panjang, dengan syarat tetap sejauh semula dari sumber bahaya. null bila tidak ada.
 */
async function keDarat(ctx, t) {
  const jauhSemula = jarakKm(t.lat, t.lon, ...t.sumber);
  for (const f of [1, 0.8, 1.3, 0.6]) {
    const coba = SIMPANGAN.map((s) => {
      const arah = (t.arah + s + 360) % 360;
      const [lat, lon] = tujuan(ctx.lat, ctx.lon, arah, t.jarak * f);
      return { lat, lon, arah, jarak: t.jarak * f };
    }).filter((p) => jarakKm(p.lat, p.lon, ...t.sumber) >= jauhSemula * 0.9);
    const nilai = await Promise.all(coba.map((p) => nilaiDi(p.lat, p.lon).catch(() => null)));
    const i = nilai.findIndex(layakTujuan);
    if (i >= 0) return { ...coba[i], alasan: t.alasanArah(coba[i].arah) };
  }
  return null;
}

/**
 * Beri tiap tujuan tingkat zona untuk bahayanya; buang yang rawan/bahaya bila masih ada alternatif.
 * Tujuan di laut selalu dibuang (titik arah digeser dulu ke daratan bila bisa).
 */
async function saringDenganZona(ctx, id, o) {
  o.tempat = (await Promise.all(o.tempat.map(async (t) => {
    if (t.arah == null) return t;
    const p = await keDarat(ctx, t);
    return p ? { ...t, ...p } : null;
  }))).filter(Boolean);
  await Promise.all(o.tempat.map(async (t) => {
    try {
      const v = await nilaiDi(t.lat, t.lon);
      if (!v) return;
      if (diLaut(v)) t.laut = true;
      else t.zona = id === 'banjir' ? Math.max(v.banjir, v.longsor) : v[id];
    } catch { /* biarkan tanpa zona */ }
  }));
  o.tempat = o.tempat.filter((t) => !t.laut);
  const aman = o.tempat.filter((t) => !(t.zona >= 2));
  if (aman.length) o.tempat = aman;
  else if (o.tempat.length) o.arahan += ' <br><b>Catatan:</b> semua tujuan terdekat masih berada di zona rawan; pilih yang paling dekat untuk keadaan darurat, lalu menjauh ke zona hijau di peta.';
  o.tempat.sort((a, b) => ((a.zona ?? 1) - (b.zona ?? 1)) || (a.jarak - b.jarak));
}

const TAB = [
  { id: 'gempa', label: 'Gempa' },
  { id: 'tsunami', label: 'Tsunami' },
  { id: 'gunung', label: 'Gunung api' },
  { id: 'banjir', label: 'Banjir & longsor' },
  { id: 'kebakaran', label: 'Kebakaran' },
];

export async function muatAman(ctx, hasil) {
  const [osmR, gridR, gridLuasR, cuacaR] = await Promise.allSettled([ctx.osm, ctx.gridLokal, ctx.gridLuas, ctx.cuaca]);
  if (ctx.batal()) return;
  const osm = nilai(osmR);
  const grid = nilai(gridR);
  const h = Object.fromEntries(Object.entries(hasil).map(([k, r]) => [k, nilai(r)]));

  const opsi = {
    gempa: opsiGempa(ctx, osm, h.gempa),
    tsunami: opsiTsunami(ctx, h.tsunami, [grid, nilai(gridLuasR)].filter(Boolean), h.bangunan, osm),
    gunung: opsiGunung(ctx, h.gunung, osm),
    banjir: opsiBanjirLongsor(ctx, grid, osm, h.hujan),
    kebakaran: opsiKebakaran(ctx, h.kebakaran, nilai(cuacaR)),
  };
  await Promise.all(Object.entries(opsi).map(([id, o]) => saringDenganZona(ctx, id, o)));
  if (ctx.batal()) return;
  const levelTab = {
    gempa: h.gempa?.level, tsunami: h.tsunami?.level, gunung: h.gunung?.level, banjir: h.hujan?.level, kebakaran: h.kebakaran?.level,
  };
  // Ikuti zona yang sedang dipilih di peta; bila 'gabungan', pakai bahaya dengan risiko tertinggi.
  const awal = ZONA_KE_TAB[bahayaTerpilih()] || TAB.slice().sort((a, b) => (URUTAN_LEVEL[levelTab[b.id] || ''] - URUTAN_LEVEL[levelTab[a.id] || '']))[0].id;

  const faskes = (osm?.faskes || []);
  const terdekatJenis = (j) => faskes.find((f) => f.tags.amenity === j);
  const fasilitas = [['hospital', 'Rumah sakit'], ['fire_station', 'Pemadam kebakaran'], ['police', 'Polisi']]
    .map(([j, label]) => ({ label, f: terdekatJenis(j) }))
    .filter((x) => x.f);

  const card = document.getElementById('card-aman');
  $('[data-badge]', card).textContent = 'Rekomendasi';
  $('[data-radius]', card).textContent = `Pencarian ±${RADIUS.aman.km} km (tsunami ±10 km)`;
  $('[data-summary]', card).innerHTML = 'Pilih jenis bahaya. Tab bawaan adalah bahaya dengan tingkat risiko tertinggi di lokasi ini. Titik hijau bernomor di peta menunjukkan tujuan; tab ini selaras dengan pilihan zona berwarna di peta.';
  const detail = $('[data-detail]', card);
  detail.innerHTML = `
    <div class="tabs" role="tablist">${TAB.map((t) => `<button type="button" role="tab" data-tab="${t.id}"><span class="dot lv-${levelTab[t.id] || 'netral'}"></span>${t.label}</button>`).join('')}</div>
    <div data-isi></div>
    ${fasilitas.length ? `<h3 class="sub">Fasilitas darurat terdekat</h3><ul class="list">${fasilitas.map(({ label, f }) => `
      <li><div>${label}<div class="meta">${esc(f.nama || 'tanpa nama')}</div></div><div class="right">${fmtKm(f.jarak)}<div class="meta">${arahKe(ctx.lat, ctx.lon, f.lat, f.lon)}</div></div></li>`).join('')}</ul>` : ''}
    <p class="meta muted">Lokasi tujuan dihitung otomatis dari data terbuka (OSM, DEM ±90 m). Rute mengikuti jalan di OpenStreetMap, tetapi belum memperhitungkan pagar, jalan rusak, atau kondisi lapangan. Utamakan jalur evakuasi resmi BPBD.</p>`;

  const tampilkan = (id) => {
    const giliran = ++giliranTampil;
    const masihAktif = () => giliran === giliranTampil && !ctx.batal();
    detail.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
    const o = opsi[id];
    $('[data-isi]', detail).innerHTML = `<p>${o.arahan}</p>${o.tempat.length ? `<ol class="list list-num">${o.tempat.map((t, i) => `
      <li data-i="${i}"><div><b>${esc(t.judul)}</b>${t.zona != null ? ` <span class="zchip" style="--c:${WARNA_CSS[t.zona]}">zona ${NAMA_LEVEL[t.zona].toLowerCase()}</span>` : ''}<div class="meta">${esc(t.alasan)}</div><div class="meta" data-rute>Mencari rute jalan…</div></div>
      <div class="right">${fmtKm(t.jarak)}<div class="meta">${arahKe(ctx.lat, ctx.lon, t.lat, t.lon)}</div></div></li>`).join('')}</ol>` : ''}`;
    lapisan.aman.clearLayers();
    const garisRute = [];
    o.tempat.forEach((t, i) => {
      // Garis lurus tipis sementara; diganti rute jalan begitu OSRM menjawab.
      const sementara = L.polyline([[ctx.lat, ctx.lon], [t.lat, t.lon]], { color: '#16a34a', weight: 2, opacity: 0.5, dashArray: '4 6' }).addTo(lapisan.aman);
      L.marker([t.lat, t.lon], { icon: ikonTitik('pin-aman', i + 1), zIndexOffset: 500 })
        .bindPopup(`<b>${esc(t.judul)}</b><br>${esc(t.alasan)}<br>${fmtKm(t.jarak)} ke arah ${arahKe(ctx.lat, ctx.lon, t.lat, t.lon)}`)
        .addTo(lapisan.aman);
      const moda = modaUntuk(t);
      const info = detail.querySelector(`[data-i="${i}"] [data-rute]`);
      rute(moda, [ctx.lat, ctx.lon], t).then((r) => {
        if (!masihAktif()) return;
        lapisan.aman.removeLayer(sementara);
        garisRute[i] = r.garis;
        L.polyline(r.garis, { color: '#fff', weight: 7, opacity: 0.85 }).addTo(lapisan.aman);
        L.polyline(r.garis, { color: '#16a34a', weight: 4, opacity: 0.9 })
          .bindTooltip(`${i + 1}. ${esc(t.judul)}`, { sticky: true })
          .addTo(lapisan.aman);
        // Ujung jalan terdekat bisa beberapa puluh meter dari tujuan (mis. di tengah lapangan): sambung putus-putus.
        const akhir = r.garis[r.garis.length - 1];
        if (jarakKm(...akhir, t.lat, t.lon) > 0.03) {
          L.polyline([akhir, [t.lat, t.lon]], { color: '#16a34a', weight: 3, dashArray: '4 6' }).addTo(lapisan.aman);
        }
        const banjir = banjirDiRute(r.garis);
        if (info) {
          info.textContent = `${moda === 'car' ? 'Berkendara' : 'Jalan kaki'} ±${Math.max(1, Math.round(r.menit))} menit, ${fmtKm(r.jarakKm)} lewat jalan`
            + (banjir.length ? ` · ⚠ melewati ${banjir.length} titik laporan banjir` : '');
        }
      }).catch((err) => {
        console.warn('rute tempat aman', err);
        if (masihAktif() && info) info.textContent = 'Rute jalan tidak tersedia, garis putus-putus hanya menunjukkan arah';
      });
    });
    detail.querySelectorAll('[data-i]').forEach((li) => li.addEventListener('click', () => {
      const i = +li.dataset.i;
      const t = o.tempat[i];
      if (garisRute[i]) map.flyToBounds(L.latLngBounds([...garisRute[i], [t.lat, t.lon]]), { padding: [40, 40], maxZoom: 17 });
      else map.flyTo([t.lat, t.lon], 15);
    }));
  };
  detail.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    tampilkan(b.dataset.tab);
    pilihBahaya(TAB_KE_ZONA[b.dataset.tab], { diam: true });
  }));
  if (pendengarZona) document.removeEventListener('zona:pilih', pendengarZona);
  pendengarZona = (e) => {
    const tab = ZONA_KE_TAB[e.detail];
    if (tab) tampilkan(tab);
  };
  document.addEventListener('zona:pilih', pendengarZona);
  tampilkan(awal);
}
