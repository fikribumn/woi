// Orkestrasi: menentukan lokasi, membuat konteks data bersama, menjalankan semua modul.
// platform.js diimpor paling awal: di aplikasi Android ia memasang penangan /api/* sebelum modul lain mengambil data.
import { diAplikasi, aturLokasiLatar, daftarKembali, tanganiKembali, mintaIzinNotifikasi, izinNotifikasi, mulaiSesiData, dataTersimpanTertua, daftarAksi, notifikasi } from './platform.js';
import { bahasa, aturBahasa } from './bahasa.js';
import { $, esc, getJson, setCardError, jarakKm } from './util.js';
import { DEFAULT_LOC, AUTO_REFRESH_MS } from './config.js';
import { map, setPusat, bersihkanLapisan } from './peta.js';
import { buatKonteks } from './konteks.js';
import { muatGempa } from './gempa.js';
import { muatTsunami } from './tsunami.js';
import { muatHujan } from './hujan.js';
import { muatGunung } from './gunung.js';
import { muatKebakaran } from './kebakaran.js';
import { muatUdara } from './udara.js';
import { muatGeologi } from './geologi.js';
import { muatBangunan } from './bangunan.js';
import { muatJarak } from './jarak.js';
import { muatAman } from './aman.js';
import { setDataZona, kosongkanZona, nilaiDi, htmlPopup, pilihBahaya } from './zona.js';
import { pasangDarurat, resetDarurat, aturKonteksDarurat, jalankanDarurat, tutupDarurat } from './evakuasi.js';
import { pasangUI, setMemuat, bukaHalaman, renderIkon, kembaliUI, aturPembukaSos, bukaPanelTema } from './ui.js';
import { muatTitikKumpul, bersihkanTitik, tambahPribadi } from './titikkumpul.js';
import { muatGedung3D } from './gedung3d.js';
import { catatGps } from './posisi.js';
import { mulaiPantau, aturLokasiPantau } from './pantau.js';
import { mulaiLaporan, aturLokasiLaporan } from './laporan.js';
import { pasangPindahPosisi } from './pindah.js';
import { pasangSiaga, aturFaskes, kabari } from './siaga.js';
import { pasangLokasiTersimpan, perbaruiLokasiTersimpan } from './lokasi.js';
import { bukaSos } from './sos.js';
import { pasangPanduan } from './panduan.js';
import { pasangRencana, perbaruiRencana } from './rencana.js';
import { pasangOffline, perbaruiOffline } from './offline.js';
import { pasangPengaturan } from './pengaturan.js';

const L = window.L;

const MODUL = {
  gempa: ['card-gempa', muatGempa],
  tsunami: ['card-tsunami', muatTsunami],
  hujan: ['card-hujan', muatHujan],
  gunung: ['card-gunung', muatGunung],
  kebakaran: ['card-kebakaran', muatKebakaran],
  udara: ['card-udara', muatUdara],
  geologi: ['card-geologi', muatGeologi],
  bangunan: ['card-bangunan', muatBangunan],
  titik: ['card-titik', muatTitikKumpul],
};

let lokasi = { ...DEFAULT_LOC };
let aktif = null;

function setLoading() {
  // Kartu data-statis (kontak, tas siaga) tidak bergantung pada data lokasi, jadi tidak dikosongkan.
  document.querySelectorAll('.card:not([data-statis])').forEach((c) => {
    $('[data-badge]', c).textContent = '…';
    $('[data-badge]', c).dataset.level = '';
    $('[data-summary]', c).innerHTML = '<span class="muted">Memuat…</span>';
    $('[data-detail]', c).innerHTML = '';
  });
}

// Lokasi terakhir yang berhasil dianalisis: dipakai saat GPS gagal, dan saat offline agar data tersimpan cocok.
const KUNCI_LOKASI = 'woi-lokasi-terakhir';
function lokasiTerakhir() {
  try { return JSON.parse(localStorage.getItem(KUNCI_LOKASI)); } catch { return null; }
}
function simpanLokasiTerakhir() {
  try { localStorage.setItem(KUNCI_LOKASI, JSON.stringify({ ...lokasi, waktu: Date.now() })); } catch { /* abaikan */ }
}

async function muatSemua() {
  mulaiSesiData();
  const ctx = buatKonteks(lokasi.lat, lokasi.lon);
  aktif = ctx;
  ctx.batal = () => aktif !== ctx;
  bersihkanLapisan();
  kosongkanZona();
  setLoading();
  setMemuat(true);

  const entri = Object.entries(MODUL);
  const hasil = await Promise.allSettled(entri.map(([, [cardId, fn]]) => fn(ctx).catch((err) => {
    if (!ctx.batal()) setCardError(cardId, err);
    console.error(cardId, err);
    throw err;
  })));
  if (ctx.batal()) return;
  const peta = Object.fromEntries(entri.map(([k], i) => [k, hasil[i]]));
  const nilai = (r) => (r.status === 'fulfilled' ? r.value : null);
  const [osm, cuaca] = await Promise.all([ctx.osm.catch(() => null), ctx.cuaca.catch(() => null)]);
  if (ctx.batal()) return;
  aturFaskes(osm);
  try {
    await setDataZona({
      lat: ctx.lat,
      lon: ctx.lon,
      osm,
      sesar: nilai(peta.gempa)?.sesarList,
      gunung: nilai(peta.gunung)?.daftar,
      api: nilai(peta.kebakaran)?.titik,
      cuaca,
      skorHujan: nilai(peta.hujan)?.skorHujan,
    });
  } catch (err) {
    console.error('zona', err);
  }
  if (ctx.batal()) return;
  aturKonteksDarurat(ctx, peta);
  const sub = nilai(peta.gempa)?.subduksiTerdekat;
  const pesisir = !!nilai(peta.tsunami)?.pesisir;
  lokasi.pesisir = pesisir;
  aturLokasiPantau({
    lat: ctx.lat, lon: ctx.lon, label: lokasi.label,
    pesisir, sub, tinggiAman: sub && sub.km < 300 ? 30 : 20,
  });
  aturLokasiLatar({ lat: ctx.lat, lon: ctx.lon, label: lokasi.label, pesisir });
  muatCuacaEkstrem(ctx);
  await Promise.allSettled([muatJarak(ctx, peta), muatAman(ctx, peta)]);
  renderIkon();
  if (ctx.batal()) return;
  setMemuat(false);
  simpanLokasiTerakhir();
  perbaruiLokasiTersimpan();
  perbaruiOffline();
  const lama = dataTersimpanTertua();
  const el = $('#diperbarui');
  el.classList.toggle('lama', !!lama);
  el.textContent = lama
    ? `Menampilkan data tersimpan dari ${new Date(lama).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
    : `Diperbarui ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`;
}

function setLokasi(lat, lon, label) {
  lokasi = { lat, lon, label: label || `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
  $('#lokasi-label').textContent = lokasi.label;
  // Simpan lokasi di URL agar bisa dibagikan / dimuat ulang
  const zona = new URLSearchParams(location.search).get('zona');
  history.replaceState(null, '', `?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}${zona ? `&zona=${encodeURIComponent(zona)}` : ''}`);
  setPusat(lat, lon);
  resetDarurat();
  bersihkanTitik();
  bukaHalaman(null);
  if (!label) cariNamaTempat(lat, lon);
  muatGedung3D(lat, lon);
  aturLokasiLaporan(lat, lon);
  perbaruiRencana();
  perbaruiLokasiTersimpan();
  muatSemua();
}

// ----- Peringatan dini cuaca BMKG untuk lokasi ini (hanya tampil bila ada) -----
async function muatCuacaEkstrem(ctx) {
  const el = $('#alert-cuaca');
  try {
    const d = await getJson(`/api/cuaca-ekstrem?lat=${ctx.lat.toFixed(4)}&lon=${ctx.lon.toFixed(4)}`, { timeout: 90000 });
    if (ctx.batal()) return;
    const daftar = d.peringatan || [];
    el.hidden = !daftar.length;
    if (!daftar.length) return;
    const jam = (iso) => new Date(iso).toLocaleString('id-ID', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    el.innerHTML = daftar.slice(0, 2).map((p) => `<div><b>Peringatan dini BMKG: ${esc(p.kejadian || p.judul)}</b>${esc(p.judul !== p.kejadian ? p.judul : p.isi).slice(0, 240)}${p.berakhir ? `<span class="meta">Berlaku sampai ${jam(p.berakhir)}</span>` : ''}</div>`).join('');
    let dilihat = [];
    try { dilihat = JSON.parse(localStorage.getItem('woi-cuaca-dilihat')) || []; } catch { /* abaikan */ }
    for (const p of daftar) {
      const id = `${p.judul}|${p.berlaku}`;
      if (dilihat.includes(id)) continue;
      notifikasi(`Peringatan dini BMKG: ${p.kejadian || 'cuaca ekstrem'}`, p.judul || p.isi, { tag: `cuaca-${p.berlaku}` });
      dilihat = [...dilihat, id].slice(-30);
    }
    try { localStorage.setItem('woi-cuaca-dilihat', JSON.stringify(dilihat)); } catch { /* abaikan */ }
  } catch {
    el.hidden = true; // tidak ada peringatan yang bisa dipastikan
  }
}

async function cariNamaTempat(lat, lon) {
  try {
    const d = await getJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=id&lat=${lat}&lon=${lon}`);
    const a = d.address || {};
    const nama = [a.village || a.suburb || a.town || a.city_district, a.city || a.county || a.regency, a.state].filter(Boolean).join(', ');
    if (nama && lokasi.lat === lat && lokasi.lon === lon) {
      lokasi.label = nama;
      $('#lokasi-label').textContent = nama;
    }
  } catch { /* label koordinat sudah cukup */ }
}

function pakaiGps() {
  if (!navigator.geolocation) return setLokasi(DEFAULT_LOC.lat, DEFAULT_LOC.lon, DEFAULT_LOC.label);
  $('#lokasi-label').textContent = 'Mencari lokasi Anda…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      catatGps(pos.coords);
      const { latitude: lat, longitude: lon } = pos.coords;
      // Offline: pakai lokasi terakhir bila masih dekat, agar data tersimpan untuk lokasi itu bisa dipakai.
      const t = lokasiTerakhir();
      if (!navigator.onLine && t && jarakKm(lat, lon, t.lat, t.lon) < 3) return setLokasi(t.lat, t.lon, t.label);
      setLokasi(lat, lon);
    },
    (err) => {
      const t = lokasiTerakhir();
      if (t) return setLokasi(t.lat, t.lon, `${t.label} (lokasi terakhir)`);
      setLokasi(DEFAULT_LOC.lat, DEFAULT_LOC.lon, `${DEFAULT_LOC.label} — ${err.code === 1 ? 'izin lokasi ditolak' : 'GPS tidak merespons'}`);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 },
  );
}

// ----- Sambutan pertama kali: jelaskan izin sebelum dialog izin sistem muncul -----
function sudahDisambut() {
  try { return localStorage.getItem('woi-sambut') === '1'; } catch { return true; }
}
function sambut() {
  const d = $('#dialog-sambut');
  if (bahasa() === 'en') {
    $('#sambut-judul', d).textContent = 'Know the hazards around you';
    const poin = d.querySelectorAll('.sb-poin li > span:last-child');
    poin[0].innerHTML = '<b>Location</b> is used to assess earthquakes, tsunamis, floods, landslides, and volcanoes where you are. It is not sent to our servers.';
    poin[1].innerHTML = '<b>Notifications</b> alert you when an earthquake is felt or a tsunami may reach you.';
    poin[2].innerHTML = 'The <b>Emergency</b> button finds the nearest safe place and a route.';
    $('.sb-isi > .meta', d).textContent = 'An information aid, not an official warning system. Follow BMKG and local authorities.';
    $('[data-sambut="izinkan"]', d).textContent = 'Allow location & start';
    $('[data-sambut="lewati"]', d).textContent = 'Not now, choose a location manually';
    $('[data-sambut-bahasa]', d).textContent = 'Bahasa Indonesia';
  }
  $('[data-sambut-bahasa]', d).addEventListener('click', () => aturBahasa(bahasa() === 'en' ? 'id' : 'en'));
  renderIkon(d);
  d.addEventListener('cancel', (e) => e.preventDefault()); // wajib memilih salah satu tombol
  d.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sambut]');
    if (!b) return;
    try { localStorage.setItem('woi-sambut', '1'); } catch { /* tampil lagi lain kali */ }
    d.close();
    if (b.dataset.sambut === 'izinkan') {
      pakaiGps();
      if (izinNotifikasi() === 'default' && diAplikasi) await mintaIzinNotifikasi();
    } else {
      setLokasi(DEFAULT_LOC.lat, DEFAULT_LOC.lon, DEFAULT_LOC.label);
      $('#input-cari').focus();
    }
  });
  d.showModal();
}

// ----- Koneksi: penanda offline & muat ulang otomatis saat tersambung lagi -----
function pasangKoneksi() {
  const banner = $('#banner-offline');
  const perbarui = () => { banner.hidden = navigator.onLine; };
  window.addEventListener('offline', perbarui);
  window.addEventListener('online', () => {
    perbarui();
    muatSemua();
  });
  document.addEventListener('kartu:galat', perbarui);
  perbarui();
  // Tombol "Coba lagi" di kartu yang gagal dimuat
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-coba-lagi]')) muatSemua();
  });
}

// ----- Pencarian lokasi (Open-Meteo Geocoding) -----
const hasilCari = $('#hasil-cari');
$('#form-cari').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#input-cari').value.trim();
  if (q.length < 2) return;
  hasilCari.hidden = false;
  hasilCari.innerHTML = '<li class="muted">Mencari…</li>';
  try {
    const d = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=id&countryCode=ID`);
    const list = d.results || [];
    hasilCari.innerHTML = list.length
      ? list.map((r, i) => `<li data-i="${i}">${esc([r.name, r.admin2, r.admin1].filter(Boolean).join(', '))}</li>`).join('')
      : '<li class="muted">Tidak ditemukan</li>';
    hasilCari.onclick = (ev) => {
      const li = ev.target.closest('li[data-i]');
      if (!li) return;
      const r = list[+li.dataset.i];
      hasilCari.hidden = true;
      setLokasi(r.latitude, r.longitude, [r.name, r.admin2, r.admin1].filter(Boolean).join(', '));
    };
  } catch (err) {
    hasilCari.innerHTML = `<li class="muted">Gagal mencari: ${esc(err.message)}</li>`;
  }
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#form-cari')) hasilCari.hidden = true;
});

// Klik peta: tampilkan tingkat bahaya di titik itu, dengan tombol untuk menganalisisnya.
map.on('click', async (e) => {
  const { lat, lng } = e.latlng;
  const popup = L.popup({ maxWidth: 280 }).setLatLng(e.latlng).setContent('<span class="muted">Memeriksa zona…</span>').openOn(map);
  let html;
  try {
    const v = await nilaiDi(lat, lng);
    html = v ? htmlPopup(v) : '<p>Zona belum siap.</p><button type="button" class="pz-btn" data-analisis>Analisis lokasi ini</button>';
  } catch (err) {
    html = `<p class="muted">Gagal membaca zona: ${esc(err.message)}</p><button type="button" class="pz-btn" data-analisis>Analisis lokasi ini</button>`;
  }
  if (!popup.isOpen()) return;
  popup.setContent(html);
  popup.getElement()?.querySelector('[data-analisis]')?.addEventListener('click', () => {
    map.closePopup();
    setLokasi(lat, lng);
  });
  popup.getElement()?.querySelector('[data-tandai]')?.addEventListener('click', () => {
    const nama = window.prompt('Nama titik kumpul (mis. "TES Masjid Raya" atau "Lapangan RW 05"):', 'Titik kumpul saya');
    if (nama === null) return;
    map.closePopup();
    tambahPribadi(lat, lng, nama.trim());
  });
});
$('#btn-gps').addEventListener('click', pakaiGps);
$('#btn-refresh').addEventListener('click', muatSemua);
pasangUI();
pasangDarurat();
mulaiPantau({ jalankanDarurat });
mulaiLaporan();
pasangPindahPosisi({ setLokasi, lokasiKini: () => lokasi });
pasangSiaga({ lokasi: () => lokasi });
pasangLokasiTersimpan({ setLokasi, lokasiKini: () => lokasi });
pasangRencana({ lokasi: () => lokasi });
pasangPanduan();
pasangOffline({ lokasi: () => lokasi });
pasangPengaturan({ bukaTema: bukaPanelTema });
aturPembukaSos(bukaSos);
pasangKoneksi();

// Aksi dari pintasan layar utama Android atau ?aksi= di URL
daftarAksi('sos', bukaSos);
daftarAksi('darurat', () => $('#dialog-darurat').showModal());
daftarAksi('aman', () => kabari('aman'));
daftarAksi('kontak', () => bukaHalaman('card-kontak'));
daftarAksi('panduan', () => bukaHalaman('card-panduan'));
$('#dialog-darurat [data-buka-sos]').addEventListener('click', () => {
  $('#dialog-darurat').close();
  bukaSos();
});
// Tombol kembali Android: penutup modul (mode darurat, dsb.) dulu, lalu panel & halaman UI.
window.woiKembali = () => tanganiKembali(kembaliUI);
daftarKembali(() => {
  if ($('#hasil-darurat').hidden) return false;
  tutupDarurat();
  return true;
});
daftarKembali(() => {
  if (!$('.lv-overlay')) return false;
  $('.lv-overlay [data-lv-aman]').click();
  return true;
});

setInterval(muatSemua, AUTO_REFRESH_MS);

const qs = new URLSearchParams(location.search);
if (qs.get('zona')) pilihBahaya(qs.get('zona'));
const qLat = parseFloat(qs.get('lat'));
const qLon = parseFloat(qs.get('lon'));
if (Number.isFinite(qLat) && Number.isFinite(qLon)) setLokasi(qLat, qLon);
else if (!sudahDisambut()) sambut();
else pakaiGps();
if (qs.get('darurat')) jalankanDarurat(qs.get('darurat'));
if (qs.get('aksi')) window.woiAksi(qs.get('aksi'));
