// Penghubung ke platform: browser biasa atau aplikasi Android (android/, objek window.WoiAndroid).
// Di aplikasi Android tidak ada server Node, jadi permintaan /api/* dijalankan di halaman ini memakai
// logika yang sama dengan server (api-inti.mjs). Sumber yang memblokir CORS diambil lewat proxy native
// di /__proxy, yang dilayani langsung oleh WebView. Fitur yang tidak ada di WebView (notifikasi, berbagi,
// tombol kembali, layar tetap menyala, pemantauan latar) diteruskan ke kode native.
import { buatApi } from './api-inti.mjs';

const asli = window.WoiAndroid || null;
export const diAplikasi = !!asli;

// ---------- Panggilan native yang berbalasan (izin, dsb.) ----------
let nomor = 0;
const menunggu = new Map();
window.woiBalasan = (id, hasil) => {
  menunggu.get(id)?.(hasil);
  menunggu.delete(id);
};
function panggilAsli(nama, ...arg) {
  return new Promise((ok) => {
    const id = ++nomor;
    menunggu.set(id, ok);
    asli[nama](id, ...arg);
  });
}

// ---------- /api/* di dalam aplikasi ----------
if (diAplikasi) {
  const ambil = async (url, { timeout = 30000, json = false } = {}) => {
    const res = await fetch(`/__proxy?u=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) throw new Error(`HTTP ${res.status} dari ${new URL(url).host}`);
    return json ? res.json() : res.text();
  };
  // Cache Overpass 7 hari di Cache Storage (bertahan setelah aplikasi ditutup).
  const disk = {
    async baca(kunci, umurMs) {
      const res = await (await caches.open('woi-api')).match(`/__cache/${kunci}`);
      if (!res || Date.now() - Number(res.headers.get('x-waktu')) >= umurMs) return null;
      return res.json();
    },
    async tulis(kunci, nilai) {
      const res = new Response(JSON.stringify(nilai), { headers: { 'content-type': 'application/json', 'x-waktu': String(Date.now()) } });
      await (await caches.open('woi-api')).put(`/__cache/${kunci}`, res);
    },
  };
  const api = buatApi({ ambil, disk });
  const fetchAsli = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const u = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (u.origin !== location.origin || !api.punya(u.pathname)) return fetchAsli(input, init);
    const { status, body } = await api.tangani(u);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
}

// ---------- Data tersimpan untuk offline ----------
// Setiap respons data yang berhasil disimpan di Cache Storage. Bila jaringan gagal (sinyal hilang, server
// mati, waktu habis), versi tersimpan dipakai sehingga analisis terakhir tetap tampil. Permintaan dengan
// { cache: 'no-store' } (mis. pemantauan live BMKG) tidak pernah memakai data lama.
const KACHE_DATA = 'woi-data';
const DATA_UTAMAKAN_JARINGAN = /^https:\/\/(data\.bmkg\.go\.id|earthquake\.usgs\.gov|(api|air-quality-api|flood-api)\.open-meteo\.com|macrostrat\.org|nominatim\.openstreetmap\.org|routing\.openstreetmap\.de)\//;
const DATA_UTAMAKAN_CACHE = /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\//; // tile elevasi tidak pernah berubah
const UMUR_DATA_MAKS = 14 * 24 * 3600e3;
let dataTertua = null; // waktu (ms) data tersimpan tertua yang dipakai sejak mulaiSesiData()

/** Dipanggil setiap analisis dimulai; dataTersimpanTertua() lalu memberi tahu apakah ada data lama yang dipakai. */
export function mulaiSesiData() { dataTertua = null; }
export const dataTersimpanTertua = () => dataTertua;

if ('caches' in window) {
  const fetchDasar = window.fetch.bind(window);
  const jenisKache = (u) => {
    if (u.origin === location.origin) return u.pathname.startsWith('/api/') ? 'jaringan' : null;
    if (DATA_UTAMAKAN_JARINGAN.test(u.href)) return 'jaringan';
    if (DATA_UTAMAKAN_CACHE.test(u.href)) return 'cache';
    return null;
  };
  const simpan = async (kunci, res) => {
    try {
      const salinan = new Response(await res.clone().blob(), {
        status: res.status,
        headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream', 'x-waktu': String(Date.now()) },
      });
      await (await caches.open(KACHE_DATA)).put(kunci, salinan);
    } catch { /* kuota penuh: abaikan */ }
  };
  const tersimpan = async (kunci) => {
    try { return await (await caches.open(KACHE_DATA)).match(kunci); } catch { return null; }
  };
  window.fetch = async (input, init = {}) => {
    const metode = (init.method || (typeof input === 'string' ? 'GET' : input.method) || 'GET').toUpperCase();
    const u = new URL(typeof input === 'string' ? input : input.url, location.href);
    const jenis = metode === 'GET' && init.cache !== 'no-store' ? jenisKache(u) : null;
    if (!jenis) return fetchDasar(input, init);
    const kunci = u.href;
    if (jenis === 'cache') {
      const ada = await tersimpan(kunci);
      if (ada) return ada;
      const res = await fetchDasar(input, init);
      if (res.ok) simpan(kunci, res);
      return res;
    }
    const pakaiLama = async (galat) => {
      const ada = await tersimpan(kunci);
      if (!ada) throw galat;
      const waktu = Number(ada.headers.get('x-waktu')) || Date.now();
      dataTertua = Math.min(dataTertua ?? waktu, waktu);
      document.dispatchEvent(new CustomEvent('data:tersimpan', { detail: { waktu } }));
      return ada;
    };
    try {
      const res = await fetchDasar(input, init);
      if (res.ok) {
        await simpan(kunci, res);
        return res;
      }
      if (res.status >= 500 || res.status === 429) return pakaiLama(new Error(`HTTP ${res.status}`)).catch(() => res);
      return res;
    } catch (e) {
      return pakaiLama(e);
    }
  };
  // Buang data yang terlalu lama (sekali per pemuatan, di latar)
  setTimeout(async () => {
    try {
      const c = await caches.open(KACHE_DATA);
      for (const req of await c.keys()) {
        const res = await c.match(req);
        if (Date.now() - Number(res?.headers.get('x-waktu') || 0) > UMUR_DATA_MAKS) await c.delete(req);
      }
    } catch { /* abaikan */ }
  }, 20000);
}

// ---------- Notifikasi ----------
/** 'granted' | 'denied' | 'default' | 'unsupported' */
export function izinNotifikasi() {
  if (diAplikasi) return asli.izinNotifikasi();
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

export async function mintaIzinNotifikasi() {
  if (diAplikasi) return panggilAsli('mintaIzinNotifikasi');
  if (!('Notification' in window)) return 'unsupported';
  return Notification.requestPermission();
}

/** Tampilkan notifikasi sistem bila diizinkan. Di browser hanya saat tab tidak sedang dilihat. */
export function notifikasi(judul, isi, { tag = '', penting = false } = {}) {
  try {
    if (izinNotifikasi() !== 'granted') return;
    if (diAplikasi) return asli.notifikasi(judul, isi, tag, penting);
    if (document.visibilityState === 'visible') return;
    new Notification(judul, { body: isi, tag, requireInteraction: penting });
  } catch { /* notifikasi tidak didukung */ }
}

// ---------- Berbagi ----------
/** Bagikan teks (dan tautan) lewat lembar berbagi sistem; cadangan: salin ke papan klip. Mengembalikan 'dibagikan' | 'disalin' | 'batal'. */
export async function bagikan({ judul, teks, url }) {
  const lengkap = url ? `${teks}\n${url}` : teks;
  if (diAplikasi) {
    asli.bagikan(judul || '', lengkap);
    return 'dibagikan';
  }
  if (navigator.share) {
    try {
      await navigator.share({ title: judul, text: teks, url });
      return 'dibagikan';
    } catch (e) {
      if (e.name === 'AbortError') return 'batal';
    }
  }
  try {
    await navigator.clipboard.writeText(lengkap);
    return 'disalin';
  } catch {
    window.prompt('Salin teks ini:', lengkap);
    return 'disalin';
  }
}

// ---------- Lain-lain ----------
/** Cegah layar mati (mis. selama mode darurat menampilkan rute). */
let kunciLayar = null;
export async function layarTetapNyala(nyala) {
  if (diAplikasi) return asli.layarNyala(!!nyala);
  try {
    if (nyala && !kunciLayar && navigator.wakeLock) kunciLayar = await navigator.wakeLock.request('screen');
    if (!nyala && kunciLayar) {
      await kunciLayar.release();
      kunciLayar = null;
    }
  } catch { /* tidak didukung */ }
}

/** Lokasi untuk pemantauan gempa di latar belakang (hanya aplikasi Android). */
export function aturLokasiLatar({ lat, lon, label, pesisir }) {
  if (diAplikasi) asli.aturLokasiPantau(lat, lon, label || '', !!pesisir);
}

export const pantauLatarAktif = () => (diAplikasi ? asli.pantauLatarAktif() : false);
export function aturPantauLatar(aktif) {
  if (diAplikasi) asli.aturPantauLatar(!!aktif);
}

/** Warna bilah status & navigasi Android mengikuti tema. */
export function warnaBilahSistem(warna, gelap) {
  if (diAplikasi) asli.warnaBilah(warna, !!gelap);
}

export const versiAplikasi = () => (diAplikasi ? asli.versi() : null);

// ---------- SOS: senter, SMS massal ----------
export const adaSenter = () => (diAplikasi ? asli.adaSenter() : false);
export function senter(nyala) {
  if (diAplikasi) asli.senter(!!nyala);
}

/** Buka aplikasi SMS dengan beberapa penerima sekaligus dan isi pesan. */
export function smsKeSemua(nomor, teks) {
  if (!nomor.length) return;
  if (diAplikasi) return asli.smsKeSemua(JSON.stringify(nomor), teks);
  location.href = `sms:${nomor.join(',')}?body=${encodeURIComponent(teks)}`;
}

// ---------- Suara (bacakan peringatan) ----------
// WebView Android tidak punya speechSynthesis, jadi aplikasi memakai TextToSpeech native.
export function bicara(teks, bahasa = 'id') {
  if (diAplikasi) return asli.bicara(teks, bahasa);
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(teks);
  u.lang = bahasa === 'en' ? 'en-US' : 'id-ID';
  u.rate = 0.95;
  speechSynthesis.speak(u);
}
export function hentikanBicara() {
  if (diAplikasi) return asli.hentikanBicara();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
export const bisaBicara = () => diAplikasi || 'speechSynthesis' in window;

// ---------- Lokasi tersimpan & siaga tinggi (aplikasi Android) ----------
/** Daftar lokasi tersimpan untuk pemantauan latar: [{ nama, lat, lon, pesisir }]. */
export function aturLokasiTersimpanLatar(daftar) {
  if (diAplikasi) asli.aturLokasiTersimpan(JSON.stringify(daftar));
}
export const siagaTinggiAktif = () => (diAplikasi ? asli.siagaTinggiAktif() : false);
export function aturSiagaTinggi(aktif) {
  if (diAplikasi) asli.aturSiagaTinggi(!!aktif);
}
/** true bila aplikasi sudah dikecualikan dari optimasi baterai (pemantauan latar lebih andal). */
export const bebasHematBaterai = () => (diAplikasi ? asli.bebasHematBaterai() : true);
export function bukaPengaturanBaterai() {
  if (diAplikasi) asli.bukaPengaturanBaterai();
}

// ---------- Aksi dari luar halaman (pintasan layar utama, ?aksi= di URL) ----------
const aksi = {};
const aksiTertunda = [];
/** Daftarkan penangan aksi bernama (mis. 'sos', 'darurat', 'aman'). */
export function daftarAksi(nama, fn) {
  aksi[nama] = fn;
  for (let i = aksiTertunda.length - 1; i >= 0; i--) {
    if (aksiTertunda[i] === nama) {
      aksiTertunda.splice(i, 1);
      fn();
    }
  }
}
window.woiAksi = (nama) => {
  if (aksi[nama]) aksi[nama]();
  else aksiTertunda.push(nama);
};

// ---------- Tombol kembali (Android) ----------
// Penutup yang didaftarkan modul (panel, lembar) dicoba dari yang terakhir dibuka. Native memanggil
// window.woiKembali(); bila mengembalikan false, aplikasi diminimalkan.
const penutup = [];
/** Daftarkan fungsi penutup yang mengembalikan true bila ada yang ditutup. Mengembalikan fungsi untuk melepasnya. */
export function daftarKembali(fn) {
  penutup.push(fn);
  return () => {
    const i = penutup.indexOf(fn);
    if (i >= 0) penutup.splice(i, 1);
  };
}
export function tanganiKembali(cadangan) {
  for (let i = penutup.length - 1; i >= 0; i--) {
    if (penutup[i]()) return true;
  }
  return cadangan ? cadangan() : false;
}

if (diAplikasi) document.documentElement.classList.add('di-aplikasi');
