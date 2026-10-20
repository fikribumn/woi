// Utilitas bersama: DOM, geometri bumi, format, dan pengambilan data.

export const $ = (sel, root = document) => root.querySelector(sel);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Geometri ----------
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

export function jarakKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** Arah (derajat dari utara) dari titik 1 ke titik 2. */
export function bearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const MATA_ANGIN = ['Utara', 'Timur Laut', 'Timur', 'Tenggara', 'Selatan', 'Barat Daya', 'Barat', 'Barat Laut'];
export const namaArah = (deg) => MATA_ANGIN[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
export const arahKe = (lat1, lon1, lat2, lon2) => namaArah(bearing(lat1, lon1, lat2, lon2));

/** Selisih sudut terkecil (0–180). */
export const selisihSudut = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/** Titik tujuan dari (lat, lon) sejauh km ke arah bearing. */
export function tujuan(lat, lon, brg, km) {
  const d = km / 6371;
  const b = toRad(brg);
  const p1 = toRad(lat);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = toRad(lon) + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [toDeg(p2), toDeg(l2)];
}

/**
 * Jarak terdekat dari titik ke kumpulan garis ([[lat,lon],...]).
 * Memakai proyeksi lokal (cukup akurat untuk < ~500 km). Mengembalikan { km, titik: [lat,lon] }.
 */
export function jarakKeGaris(lat, lon, daftarGaris) {
  const kx = 111.32 * Math.cos(toRad(lat));
  const ky = 110.57;
  const proj = ([a, b]) => [(b - lon) * kx, (a - lat) * ky];
  let terbaik = { km: Infinity, titik: null };
  for (const garis of daftarGaris) {
    for (let i = 0; i < garis.length; i++) {
      const A = proj(garis[i]);
      const B = i + 1 < garis.length ? proj(garis[i + 1]) : A;
      const dx = B[0] - A[0];
      const dy = B[1] - A[1];
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(A[0] * dx + A[1] * dy) / len2)) : 0;
      const px = A[0] + t * dx;
      const py = A[1] + t * dy;
      const d = Math.hypot(px, py);
      if (d < terbaik.km) terbaik = { km: d, titik: [lat + py / ky, lon + px / kx] };
    }
  }
  return terbaik;
}

// ---------- Format ----------
export function waktuRelatif(ms) {
  const menit = Math.round((Date.now() - ms) / 60000);
  if (menit < 60) return `${Math.max(menit, 0)} menit lalu`;
  const jam = Math.round(menit / 60);
  if (jam < 48) return `${jam} jam lalu`;
  return `${Math.round(jam / 24)} hari lalu`;
}

export function fmtTanggal(ms) {
  return new Date(ms).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtKm(km) {
  if (!Number.isFinite(km)) return '—';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

// ---------- Jaringan ----------
export async function getJson(url, opts = {}) {
  const { timeout = 25000, ...rest } = opts;
  const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) {
    let pesan = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      pesan = j.reason || (typeof j.error === 'string' ? j.error : pesan);
    } catch { /* abaikan */ }
    throw new Error(`${pesan} (${new URL(url, location.href).host})`);
  }
  return res.json();
}

// ---------- Kartu UI ----------
// level: 'rendah' | 'sedang' | 'tinggi' | 'bahaya' | '' (netral)
export const URUTAN_LEVEL = { '': 0, rendah: 1, sedang: 2, tinggi: 3, bahaya: 4 };
export const levelMaks = (...lv) => lv.reduce((a, b) => (URUTAN_LEVEL[b] > URUTAN_LEVEL[a] ? b : a), '');

export function setCard(id, { badge, level, summary, detail, radius }) {
  const card = document.getElementById(id);
  const b = $('[data-badge]', card);
  b.textContent = badge;
  b.dataset.level = level || '';
  $('[data-summary]', card).innerHTML = summary;
  $('[data-detail]', card).innerHTML = detail || '';
  const r = $('[data-radius]', card);
  if (r) r.textContent = radius || '';
}

// Galat jaringan dari browser/WebView ("Failed to fetch", "NetworkError", "ERR_INTERNET_DISCONNECTED", ...)
const GALAT_JARINGAN = /failed to fetch|fetch failed|networkerror|load failed|err_|network request failed/i;

export function setCardError(id, err) {
  const offline = !navigator.onLine || GALAT_JARINGAN.test(err.message);
  const sibuk = /overpass|HTTP 5\d\d|HTTP 429|timeout|aborted/i.test(err.message);
  const coba = '<button type="button" class="btn-coba" data-coba-lagi><i data-lucide="rotate-cw"></i>Coba lagi</button>';
  setCard(id, {
    badge: offline ? 'Offline' : 'Tidak tersedia',
    level: '',
    summary: offline
      ? `Tidak ada koneksi internet. Periksa data seluler atau Wi-Fi, lalu coba lagi. ${coba}`
      : sibuk
        ? `Server data sedang sibuk. Coba lagi beberapa saat lagi. ${coba}<span class="meta galat-teknis">${esc(err.message)}</span>`
        : `Data belum bisa dimuat. ${coba}<span class="meta galat-teknis">${esc(err.message)}</span>`,
    detail: '',
  });
  document.dispatchEvent(new CustomEvent('kartu:galat', { detail: { id } }));
}

export const fakta = (k, v, sub = '') => `<div class="fact"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="meta">${sub}</div>` : ''}</div>`;

export const catatanGagal = (nama, hasil) => (hasil && hasil.error
  ? `<p class="meta muted">${esc(nama)} tidak tersedia: ${esc(hasil.error)}</p>` : '');
