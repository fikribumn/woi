// Orkestrasi: menentukan lokasi, membuat konteks data bersama, menjalankan semua modul.
import { $, esc, getJson, setCardError } from './util.js';
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
import { pasangDarurat, resetDarurat, aturKonteksDarurat, jalankanDarurat } from './evakuasi.js';
import { pasangUI, setMemuat, bukaHalaman, renderIkon } from './ui.js';
import { muatTitikKumpul, bersihkanTitik, tambahPribadi } from './titikkumpul.js';
import { catatGps } from './posisi.js';

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
  document.querySelectorAll('.card').forEach((c) => {
    $('[data-badge]', c).textContent = '…';
    $('[data-badge]', c).dataset.level = '';
    $('[data-summary]', c).innerHTML = '<span class="muted">Memuat…</span>';
    $('[data-detail]', c).innerHTML = '';
  });
}

async function muatSemua() {
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
  await Promise.allSettled([muatJarak(ctx, peta), muatAman(ctx, peta)]);
  renderIkon();
  if (!ctx.batal()) setMemuat(false);
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
  muatSemua();
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
  $('#lokasi-label').textContent = 'Meminta izin lokasi…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      catatGps(pos.coords);
      setLokasi(pos.coords.latitude, pos.coords.longitude);
    },
    () => setLokasi(DEFAULT_LOC.lat, DEFAULT_LOC.lon, `${DEFAULT_LOC.label} — izin lokasi ditolak`),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 },
  );
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

setInterval(muatSemua, AUTO_REFRESH_MS);

const qs = new URLSearchParams(location.search);
if (qs.get('zona')) pilihBahaya(qs.get('zona'));
const qLat = parseFloat(qs.get('lat'));
const qLon = parseFloat(qs.get('lon'));
if (Number.isFinite(qLat) && Number.isFinite(qLon)) setLokasi(qLat, qLon);
else pakaiGps();
if (qs.get('darurat')) jalankanDarurat(qs.get('darurat'));
