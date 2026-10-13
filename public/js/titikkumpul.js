// Titik kumpul & tempat evakuasi dari beberapa sumber, diurutkan menurut keandalan:
//   resmi    : rencana evakuasi BNPB/InaRISK (baru tersedia di daerah percontohan)
//   pribadi  : titik kumpul yang ditandai pengguna sendiri (disimpan di perangkat)
//   osm      : emergency=assembly_point/evacuation_point/shelter atau evacuation_center=yes (OpenStreetMap)
//   shelter  : amenity=shelter (OSM) — bisa sekadar gazebo
//   potensial: sekolah, tempat ibadah, kantor pemerintah — BUKAN titik resmi, hanya kandidat
import { esc, fmtKm, getJson, jarakKm, arahKe, setCard, fakta } from './util.js';
import { map } from './peta.js';

const L = window.L;
const KUNCI = 'wb_titik_kumpul_saya';

export const JENIS = {
  resmi: { label: 'Resmi BNPB', warna: '#34c759', bonus: 6, huruf: 'R', urut: 0 },
  pribadi: { label: 'Ditandai Anda', warna: '#007aff', bonus: 6, huruf: '★', urut: 1 },
  osm: { label: 'Titik kumpul (OSM)', warna: '#30b0c7', bonus: 4, huruf: 'K', urut: 2 },
  shelter: { label: 'Shelter (OSM)', warna: '#5856d6', bonus: 1, huruf: 'S', urut: 3 },
  potensial: { label: 'Potensial, tidak resmi', warna: '#8e8e93', bonus: 0, huruf: '', urut: 4 },
};

const lapisanUtama = L.layerGroup().addTo(map);
const lapisanPotensial = L.layerGroup();
map.on('zoomend', () => {
  if (map.getZoom() >= 14) lapisanPotensial.addTo(map);
  else lapisanPotensial.remove();
});

let daftar = [];
let pusat = null;

// ---------- Titik pribadi (localStorage) ----------
export function bacaPribadi() {
  try {
    return JSON.parse(localStorage.getItem(KUNCI)) || [];
  } catch {
    return [];
  }
}
function simpanPribadi(list) {
  try {
    localStorage.setItem(KUNCI, JSON.stringify(list));
  } catch { /* penyimpanan tidak tersedia */ }
}

export function tambahPribadi(lat, lon, nama) {
  const list = bacaPribadi();
  list.push({ lat, lon, nama: nama || 'Titik kumpul saya', waktu: Date.now() });
  simpanPribadi(list);
  if (pusat) susun(pusat, sumberTerakhir);
}

function hapusPribadi(lat, lon) {
  simpanPribadi(bacaPribadi().filter((p) => !(Math.abs(p.lat - lat) < 1e-7 && Math.abs(p.lon - lon) < 1e-7)));
  map.closePopup();
  if (pusat) susun(pusat, sumberTerakhir);
}

// ---------- Penggabungan ----------
let sumberTerakhir = { resmi: [], osm: null, galatResmi: null };

function susun({ lat, lon }, sumber) {
  sumberTerakhir = sumber;
  const semua = [
    ...sumber.resmi.map((t) => ({ ...t, jenis: 'resmi', jenisResmi: t.jenis, keterangan: [t.jenis, t.keterangan].filter(Boolean).join(' · ') })),
    ...bacaPribadi().map((t) => ({ ...t, jenis: 'pribadi' })),
    ...(sumber.osm?.titikKumpul || []).map((t) => ({ lat: t.lat, lon: t.lon, nama: t.nama, jenis: t.jenis, keterangan: ketOsm(t.tags) })),
    ...(sumber.osm?.potensial || []).map((t) => ({ lat: t.lat, lon: t.lon, nama: t.nama, jenis: 'potensial', keterangan: ketOsm(t.tags) })),
  ]
    .map((t) => ({ ...t, jarak: jarakKm(lat, lon, t.lat, t.lon) }))
    .filter((t) => t.jarak <= (t.jenis === 'potensial' ? 3 : 15))
    .sort((a, b) => JENIS[a.jenis].urut - JENIS[b.jenis].urut || a.jarak - b.jarak);

  // Buang duplikat (< 40 m), pertahankan sumber yang lebih andal
  daftar = [];
  for (const t of semua) {
    if (!daftar.some((d) => jarakKm(d.lat, d.lon, t.lat, t.lon) < 0.04)) daftar.push(t);
  }
  daftar.sort((a, b) => a.jarak - b.jarak);
  gambar();
  renderKartu();
}

function ketOsm(tags = {}) {
  const jenis = {
    assembly_point: 'Titik kumpul', evacuation_point: 'Titik evakuasi', shelter: 'Tempat berlindung',
    school: 'Sekolah', college: 'Kampus', university: 'Kampus', place_of_worship: 'Tempat ibadah',
    townhall: 'Kantor pemerintahan', community_centre: 'Balai warga',
  };
  const bagian = [jenis[tags.emergency] || jenis[tags.amenity]];
  if (tags['assembly_point:tsunami'] === 'yes' || tags.hazard === 'tsunami') bagian.push('tsunami');
  if (tags['building:levels']) bagian.push(`${tags['building:levels']} lantai`);
  return bagian.filter(Boolean).join(' · ') || null;
}

export const titikKumpul = () => daftar;
export const namaTitik = (t) => t.nama || (t.keterangan ? t.keterangan.split(' · ')[0] : JENIS[t.jenis].label);

// ---------- Peta ----------
function ikon(t) {
  const j = JENIS[t.jenis];
  if (t.jenis === 'potensial') {
    return L.divIcon({ className: '', html: `<div class="tk-dot" style="--c:${j.warna}"></div>`, iconSize: [10, 10], iconAnchor: [5, 5] });
  }
  return L.divIcon({ className: '', html: `<div class="tk-pin" style="--c:${j.warna}">${j.huruf}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] });
}

function isiPopup(t) {
  const j = JENIS[t.jenis];
  const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${t.lat.toFixed(6)},${t.lon.toFixed(6)}&travelmode=walking`;
  return `<div class="tk-popup">
    <span class="zchip" style="--c:${j.warna}">${j.label}</span>
    <b>${esc(namaTitik(t))}</b>
    ${t.keterangan ? `<div class="meta">${esc(t.keterangan)}</div>` : ''}
    ${t.kapasitas ? `<div class="meta">Daya tampung ±${t.kapasitas.toLocaleString('id-ID')} orang</div>` : ''}
    <div class="meta">${fmtKm(t.jarak)} dari lokasi</div>
    ${t.jenis === 'potensial' ? '<div class="meta">Bukan titik resmi. Pastikan ke BPBD setempat.</div>' : ''}
    <a class="pz-btn" href="${gmaps}" target="_blank" rel="noopener">Rute jalan kaki</a>
    ${t.jenis === 'pribadi' ? `<button type="button" class="pz-btn pz-sekunder" data-hapus="${t.lat},${t.lon}">Hapus titik ini</button>` : ''}
  </div>`;
}

function gambar() {
  lapisanUtama.clearLayers();
  lapisanPotensial.clearLayers();
  for (const t of daftar) {
    const m = L.marker([t.lat, t.lon], { icon: ikon(t), title: namaTitik(t), zIndexOffset: t.jenis === 'potensial' ? 0 : 400 })
      .bindPopup(isiPopup(t));
    m.on('popupopen', (e) => {
      e.popup.getElement()?.querySelector('[data-hapus]')?.addEventListener('click', () => hapusPribadi(t.lat, t.lon));
    });
    m.addTo(t.jenis === 'potensial' ? lapisanPotensial : lapisanUtama);
  }
}

export function bersihkanTitik() {
  lapisanUtama.clearLayers();
  lapisanPotensial.clearLayers();
  daftar = [];
}

// ---------- Kartu ----------
function renderKartu() {
  if (!pusat) return;
  const hitung = (j) => daftar.filter((t) => t.jenis === j).length;
  const utama = daftar.filter((t) => t.jenis !== 'potensial');
  const terdekat = utama[0];
  const { galatResmi, osm } = sumberTerakhir;

  let summary;
  if (terdekat) {
    summary = `Titik kumpul terdekat: <b>${esc(namaTitik(terdekat))}</b> (${JENIS[terdekat.jenis].label.toLowerCase()}), ${fmtKm(terdekat.jarak)} ke arah ${arahKe(pusat.lat, pusat.lon, terdekat.lat, terdekat.lon)}.`;
  } else {
    summary = 'Belum ada titik kumpul resmi/terpetakan di sekitar lokasi ini.';
  }
  if (!hitung('resmi')) summary += ' <span class="muted">Data resmi BNPB belum mencakup area ini; tanyakan lokasi titik kumpul ke BPBD/RT setempat lalu tandai di peta.</span>';

  const baris = utama.slice(0, 8).map((t) => `
    <li data-ll="${t.lat},${t.lon}"><div><span class="dot" style="background:${JENIS[t.jenis].warna}"></span><b>${esc(namaTitik(t))}</b>
      <div class="meta">${JENIS[t.jenis].label}${t.keterangan ? ` · ${esc(t.keterangan)}` : ''}</div></div>
      <div class="right">${fmtKm(t.jarak)}<div class="meta">${arahKe(pusat.lat, pusat.lon, t.lat, t.lon)}</div></div></li>`).join('');

  setCard('card-titik', {
    badge: utama.length ? `${utama.length} titik` : 'Data minim',
    level: '',
    radius: 'Radius 15 km (kandidat potensial 3 km)',
    summary,
    detail: `
      <div class="facts">
        ${fakta('Resmi BNPB', hitung('resmi'), 'TES / TEA / titik kumpul')}
        ${fakta('Ditandai Anda', hitung('pribadi'), 'tersimpan di perangkat ini')}
        ${fakta('OpenStreetMap', hitung('osm') + hitung('shelter'), 'titik kumpul & shelter')}
        ${fakta('Potensial', hitung('potensial'), 'sekolah, ibadah, kantor')}
      </div>
      ${baris ? `<ul class="list list-klik">${baris}</ul>` : ''}
      <h3 class="sub">Menandai titik kumpul</h3>
      <p class="meta">Ketuk lokasi di peta, lalu pilih <b>Tandai sebagai titik kumpul</b>. Titik ini dipakai di Tempat Paling Aman dan Mode Darurat (bila berada di zona aman), dan hanya tersimpan di perangkat ini.</p>
      ${galatResmi ? `<p class="meta muted">Data BNPB tidak dapat dihubungi: ${esc(galatResmi)}</p>` : ''}
      ${!osm ? '<p class="meta muted">Data OpenStreetMap belum tersedia (server sibuk).</p>' : ''}
      <p class="meta muted">Titik abu-abu kecil (tampil saat peta diperbesar) adalah bangunan yang <b>berpotensi</b> menjadi tempat evakuasi, bukan titik resmi.</p>`,
  });
  document.querySelectorAll('#card-titik [data-ll]').forEach((li) => li.addEventListener('click', () => {
    const [a, b] = li.dataset.ll.split(',').map(Number);
    map.flyTo([a, b], 17);
  }));
}

export async function muatTitikKumpul(ctx) {
  const [osmR, resmiR] = await Promise.allSettled([
    ctx.osm,
    getJson(`/api/evakuasi-resmi?lat=${ctx.lat.toFixed(4)}&lon=${ctx.lon.toFixed(4)}`, { timeout: 60000 }),
  ]);
  if (ctx.batal()) return null;
  pusat = { lat: ctx.lat, lon: ctx.lon };
  susun(pusat, {
    resmi: resmiR.status === 'fulfilled' ? resmiR.value.titik : [],
    galatResmi: resmiR.status === 'rejected' ? resmiR.reason.message : null,
    osm: osmR.status === 'fulfilled' ? osmR.value : null,
  });
  return { daftar };
}
