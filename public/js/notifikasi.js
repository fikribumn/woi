// Notifikasi sistem untuk peringatan. Di browser memakai Notification API (hanya saat tab tidak dilihat);
// di aplikasi Android memakai plugin LocalNotifications, plus pemantau latar belakang (runners/pantau-gempa.js)
// yang tetap memeriksa BMKG ±15 menit sekali walau aplikasi ditutup.
import { diAplikasi, panggilNative } from './native.js';

const KANAL = 'peringatan';
const RUNNER = 'id.terrawoi.app.pantau';

/** 'granted' | 'denied' | 'default' | 'unsupported' */
export let izinNotifikasi = !diAplikasi && 'Notification' in window ? Notification.permission : diAplikasi ? 'default' : 'unsupported';

const dariNative = (s) => (s === 'granted' ? 'granted' : s === 'denied' ? 'denied' : 'default');

/** Dipanggil sekali saat aplikasi dimuat: buat kanal prioritas tinggi & baca status izin. */
export async function siapkanNotifikasi() {
  if (!diAplikasi) return izinNotifikasi;
  try {
    await panggilNative('LocalNotifications', 'createChannel', {
      id: KANAL, name: 'Peringatan bencana', description: 'Gempa terasa, potensi tsunami, laporan banjir di dekat Anda', importance: 5, visibility: 1, vibration: true,
    });
    izinNotifikasi = dariNative((await panggilNative('LocalNotifications', 'checkPermissions')).display);
  } catch (e) {
    console.warn('[notifikasi]', e.message);
  }
  return izinNotifikasi;
}

export async function mintaIzinNotifikasi() {
  if (diAplikasi) {
    izinNotifikasi = dariNative((await panggilNative('LocalNotifications', 'requestPermissions')).display);
  } else if ('Notification' in window) {
    izinNotifikasi = await Notification.requestPermission();
  }
  return izinNotifikasi;
}

// ID notifikasi Android harus bilangan bulat 32-bit; diturunkan dari tag agar kejadian sama tidak dobel.
function idDariTag(tag) {
  let h = 0;
  for (const c of tag) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return h;
}

/** Tampilkan notifikasi bila pengguna sedang tidak melihat aplikasi. */
export function kirimNotifikasi({ judul, isi, tag, penting = false }) {
  if (izinNotifikasi !== 'granted' || document.visibilityState === 'visible') return;
  try {
    if (diAplikasi) {
      panggilNative('LocalNotifications', 'schedule', {
        notifications: [{ id: idDariTag(tag), title: judul, body: isi, largeBody: isi, channelId: KANAL, autoCancel: !penting, ongoing: false }],
      }).catch((e) => console.warn('[notifikasi]', e.message));
    } else {
      new Notification(judul, { body: isi, tag, requireInteraction: penting });
    }
  } catch { /* notifikasi tidak didukung */ }
}

// ---------- Pemantau latar belakang (hanya aplikasi) ----------
const kirimKeRunner = (event, details) => {
  if (!diAplikasi) return;
  panggilNative('BackgroundRunner', 'dispatchEvent', { label: RUNNER, event, details })
    .catch((e) => console.warn('[runner]', e.message));
};

/** Simpan lokasi agar pemantau latar belakang tahu titik yang harus dinilai. */
export const lokasiKeLatar = ({ lat, lon, label, pesisir }) => kirimKeRunner('aturLokasi', { lat, lon, label: label || '', pesisir: pesisir !== false });

/** Kejadian yang sudah diperingatkan di layar tidak perlu dinotifikasi ulang oleh pemantau latar belakang. */
export const tandaiDiLatar = (id) => kirimKeRunner('tandai', { id });
