// Laporan warga dari PetaBencana.id (banjir, kebakaran, asap, gunung api, dll.) dan area banjir resmi
// Jakarta: lapisan peta, peringatan bila ada laporan banjir baru di dekat lokasi, dan data untuk
// menghindari titik banjir saat menyusun rute evakuasi.
// Lisensi data: CC BY-NC 4.0, atribusi ditampilkan di setiap popup dan kartu.
import { esc, jarakKm, arahKe, fmtKm, getJson, waktuRelatif } from './util.js';
import { map, kontrolLapisan } from './peta.js';
import { renderIkon } from './ui.js';

const L = window.L;
const INTERVAL = 5 * 60e3;
const RADIUS_PERINGATAN_KM = 5;
const UMUR_PERINGATAN = 6 * 3600e3;
const UMUR_TAMPIL = 48 * 3600e3;
const UMUR_RUTE = 24 * 3600e3;
const KUNCI = 'woi-laporan-dilihat';
export const ATRIBUSI = 'Data: <a href="https://petabencana.id" target="_blank" rel="noopener">PetaBencana.id</a>, CC BY-NC 4.0';

export const JENIS_LAPORAN = {
  flood: { label: 'Banjir', ikon: 'droplets', warna: '#2f6bff' },
  fire: { label: 'Kebakaran', ikon: 'flame', warna: '#ff3b30' },
  haze: { label: 'Asap', ikon: 'haze', warna: '#8e8e93' },
  volcano: { label: 'Gunung api', ikon: 'mountain', warna: '#ff9500' },
  earthquake: { label: 'Gempa', ikon: 'activity', warna: '#af52de' },
  wind: { label: 'Angin kencang', ikon: 'wind', warna: '#30b0c7' },
};
const TINGKAT_AREA = { 1: ['tidak diketahui', '#ffcc00'], 2: ['10–70 cm', '#ff9500'], 3: ['71–150 cm', '#ff3b30'], 4: ['lebih dari 150 cm', '#a50f1e'] };

let data = { laporan: [], areaBanjir: [] };
let lokasi = null;
let siapResolve;
/** Terpenuhi setelah pemuatan pertama (berhasil atau gagal). */
export const siapLaporan = new Promise((r) => { siapResolve = r; });

export const lapisanLaporan = L.layerGroup().addTo(map);
kontrolLapisan.addOverlay(lapisanLaporan, 'Laporan warga (PetaBencana.id)');

const umur = (l) => Date.now() - Date.parse(l.waktu);
const fotoAman = (u) => (typeof u === 'string' && u.startsWith('https://images.petabencana.id/') ? u : null);

/** Laporan di sekitar titik. Opsi: km, umurMs, jenis ('flood', ...). */
export function laporanDekat(lat, lon, { km = RADIUS_PERINGATAN_KM, umurMs = UMUR_RUTE, jenis = null } = {}) {
  return data.laporan
    .filter((l) => (!jenis || l.jenis === jenis) && umur(l) <= umurMs)
    .map((l) => ({ ...l, jarak: jarakKm(lat, lon, l.lat, l.lon) }))
    .filter((l) => l.jarak <= km)
    .sort((a, b) => a.jarak - b.jarak);
}

// ---------- Banjir di sepanjang rute ----------
function dalamCincin([x, y], cincin) {
  let dalam = false;
  for (let i = 0, j = cincin.length - 1; i < cincin.length; j = i++) {
    const [xi, yi] = cincin[i];
    const [xj, yj] = cincin[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dalam = !dalam;
  }
  return dalam;
}
function dalamArea(lat, lon, geom) {
  const poligon = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  return poligon.some((p) => dalamCincin([lon, lat], p[0]) && !p.slice(1).some((lubang) => dalamCincin([lon, lat], lubang)));
}

/**
 * Laporan banjir (24 jam) dalam radiusKm dari garis rute, dan area banjir resmi yang dilalui.
 * Mengembalikan [{ lat, lon, label }] untuk penalti & peringatan rute.
 */
export function banjirDiRute(garis, radiusKm = 0.1) {
  if (!garis?.length) return [];
  const hasil = [];
  for (const l of data.laporan) {
    if (l.jenis !== 'flood' || umur(l) > UMUR_RUTE) continue;
    if (garis.some(([la, lo]) => jarakKm(la, lo, l.lat, l.lon) <= radiusKm)) {
      hasil.push({ lat: l.lat, lon: l.lon, label: `Laporan banjir${l.kedalaman ? ` ±${l.kedalaman} cm` : ''}, ${waktuRelatif(Date.parse(l.waktu))}` });
    }
  }
  for (const a of data.areaBanjir) {
    const titik = garis.find(([la, lo]) => dalamArea(la, lo, a.geometry));
    if (titik) hasil.push({ lat: titik[0], lon: titik[1], label: `Area banjir ${a.nama} (${TINGKAT_AREA[a.tingkat]?.[0] || ''})` });
  }
  return hasil;
}

/** Peringatan bila rute melewati titik/area yang dilaporkan banjir (r.banjir dari lengkapiRute). */
export function htmlBanjirRute(r) {
  if (!r.banjir?.length) return '';
  return `<div class="hd-warn">Rute melewati ${r.banjir.length > 1 ? `${r.banjir.length} titik` : 'titik'} yang dilaporkan banjir: ${esc(r.banjir[0].label)}. Hindari bila air masih tinggi; coba rute lain bila ada. <span class="meta">${ATRIBUSI}</span></div>`;
}

/** Tandai titik banjir di sepanjang rute pada lapisan peta. */
export function tandaiBanjirRute(r, grup) {
  for (const b of r.banjir || []) {
    L.circleMarker([b.lat, b.lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#2f6bff', fillOpacity: 1 }).bindTooltip(esc(b.label)).addTo(grup);
  }
}

// ---------- Peta ----------
function ikonLaporan(j) {
  return L.divIcon({ className: '', html: `<div class="pin pin-laporan" style="--c:${j.warna}"><i data-lucide="${j.ikon}"></i></div>`, iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12] });
}

function render() {
  lapisanLaporan.clearLayers();
  for (const a of data.areaBanjir) {
    const [teks, warna] = TINGKAT_AREA[a.tingkat] || TINGKAT_AREA[1];
    L.geoJSON(a.geometry, { style: { color: warna, weight: 1.5, fillColor: warna, fillOpacity: 0.35 } })
      .bindPopup(`<b>Area banjir</b> · ${esc(a.nama)}, ${esc(a.kota)}<br>Genangan ${teks}<br><span class="meta">Diperbarui ${waktuRelatif(Date.parse(a.waktu))} · ${ATRIBUSI}</span>`)
      .addTo(lapisanLaporan);
  }
  for (const l of data.laporan) {
    if (umur(l) > UMUR_TAMPIL) continue;
    const j = JENIS_LAPORAN[l.jenis] || { label: l.jenis, ikon: 'message-circle-warning', warna: '#8e8e93' };
    const foto = fotoAman(l.foto);
    const jarak = lokasi ? ` · ${fmtKm(jarakKm(lokasi.lat, lokasi.lon, l.lat, l.lon))} dari lokasi` : '';
    const m = L.marker([l.lat, l.lon], { icon: ikonLaporan(j), zIndexOffset: 300 })
      .bindPopup(`<div class="lap-popup"><b>${esc(j.label)}</b>${l.kedalaman ? ` · ±${esc(l.kedalaman)} cm` : ''}
        <div class="meta">${waktuRelatif(Date.parse(l.waktu))}${jarak}${l.kota ? ` · ${esc(l.kota)}` : ''}</div>
        ${l.teks ? `<p>${esc(l.teks)}</p>` : ''}
        ${foto ? `<img src="${esc(foto)}" alt="Foto laporan ${esc(j.label.toLowerCase())}" loading="lazy">` : ''}
        <div class="meta">Laporan warga, belum tentu terverifikasi petugas. ${ATRIBUSI}</div></div>`, { maxWidth: 260 });
    m.on('add', () => renderIkon(m.getElement()));
    m.addTo(lapisanLaporan);
  }
}

// ---------- Peringatan banjir di dekat lokasi ----------
function sudahDilihat() {
  try { return new Set(JSON.parse(localStorage.getItem(KUNCI) || '[]')); } catch { return new Set(); }
}
function tandai(id) {
  try { localStorage.setItem(KUNCI, JSON.stringify([...sudahDilihat(), id].slice(-100))); } catch { /* cukup sesi ini */ }
}

function cekPeringatan() {
  if (!lokasi) return;
  const dilihat = sudahDilihat();
  const baru = laporanDekat(lokasi.lat, lokasi.lon, { jenis: 'flood', umurMs: UMUR_PERINGATAN }).filter((l) => !dilihat.has(String(l.id)));
  if (!baru.length) return;
  baru.forEach((l) => tandai(String(l.id)));
  const l = baru[0];
  const pesan = `Laporan banjir ${fmtKm(l.jarak)} ke arah ${arahKe(lokasi.lat, lokasi.lon, l.lat, l.lon)}${l.kedalaman ? `, ±${l.kedalaman} cm` : ''} · ${waktuRelatif(Date.parse(l.waktu))}`;
  tampilkanToast(`${baru.length > 1 ? `${baru.length} laporan banjir baru di sekitar Anda. Terdekat: ` : ''}${pesan}`, l);
  if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
    new Notification('Laporan banjir di dekat Anda', { body: pesan, tag: `banjir-${l.id}` });
  }
}

function tampilkanToast(teks, l) {
  document.querySelector('.toast-laporan')?.remove();
  const el = document.createElement('div');
  el.className = 'toast-laporan glass';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="tl-ikon"><i data-lucide="droplets"></i></span><div class="tl-teks">${esc(teks)}<div class="meta">${ATRIBUSI}</div></div>
    <div class="tl-aksi"><button type="button" data-lihat>Lihat</button><button type="button" data-tutup aria-label="Tutup">✕</button></div>`;
  document.body.appendChild(el);
  renderIkon(el);
  el.querySelector('[data-lihat]').onclick = () => {
    map.flyTo([l.lat, l.lon], 16);
    el.remove();
  };
  el.querySelector('[data-tutup]').onclick = () => el.remove();
  setTimeout(() => el.remove(), 30000);
}

// ---------- Pemuatan ----------
async function muat() {
  try {
    data = await getJson('/api/laporan', { timeout: 40000 });
  } catch (err) {
    console.warn('laporan PetaBencana', err);
    siapResolve();
    return;
  }
  render();
  cekPeringatan();
  siapResolve();
}

/** Dipanggil main.js sekali saat aplikasi dimuat. */
export function mulaiLaporan() {
  muat();
  setInterval(muat, INTERVAL);
}

/** Dipanggil main.js setiap lokasi berganti. */
export function aturLokasiLaporan(lat, lon) {
  lokasi = { lat, lon };
  render();
  cekPeringatan();
}
