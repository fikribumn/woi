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
