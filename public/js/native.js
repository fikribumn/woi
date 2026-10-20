// Penyesuaian saat berjalan sebagai aplikasi Android (Capacitor).
// Endpoint /api/* dijalankan di perangkat lewat sumber.js, dan permintaannya memakai HTTP native
// (plugin CapacitorHttp) sehingga tidak terhalang CORS. Dengan begitu aplikasi tidak butuh server.

const cap = window.Capacitor;
export const diAplikasi = !!(cap?.isNativePlatform?.() ?? ['android', 'ios'].includes(cap?.getPlatform?.()));

const httpNative = (opsi) => (cap.Plugins?.CapacitorHttp?.request
  ? cap.Plugins.CapacitorHttp.request(opsi)
  : cap.nativePromise('CapacitorHttp', 'request', opsi));

async function permintaanNative(url, { method = 'GET', body, timeout = 30000 }) {
  const res = await httpNative({
    url,
    method,
    data: body,
    headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
    connectTimeout: timeout,
    readTimeout: timeout,
    responseType: 'text',
  });
  // Respons berjenis JSON sudah di-parse oleh plugin, jadi dikembalikan ke teks agar seragam.
  return { status: res.status, text: typeof res.data === 'string' ? res.data : JSON.stringify(res.data) };
}

// Data Overpass disimpan di Cache Storage (tahan lama, tidak dibatasi ±5 MB seperti localStorage).
const NAMA_CACHE = 'terra-woi-osm';
const simpananPerangkat = {
  async baca(kunci, umurMs) {
    const res = await (await caches.open(NAMA_CACHE)).match(`/__simpanan/${kunci}`);
    if (!res || Date.now() - Number(res.headers.get('x-waktu')) >= umurMs) return null;
    return res.json();
  },
  async tulis(kunci, nilai) {
    const res = new Response(JSON.stringify(nilai), { headers: { 'Content-Type': 'application/json', 'x-waktu': String(Date.now()) } });
    await (await caches.open(NAMA_CACHE)).put(`/__simpanan/${kunci}`, res);
  },
};

let rute = null;
async function siapkanRute() {
  const sumber = await import('./sumber.js');
  sumber.aturPermintaan(permintaanNative);
  sumber.aturSimpanan(simpananPerangkat);
  return sumber.RUTE;
}

/** Menjalankan endpoint /api/... di perangkat; hasilnya sama dengan respons server versi web. */
export async function apiLokal(url) {
  rute ??= siapkanRute();
  const u = new URL(url, location.href);
  const handler = (await rute)[u.pathname];
  if (!handler) throw new Error(`Endpoint tidak dikenal: ${u.pathname}`);
  return handler(u.searchParams);
}
