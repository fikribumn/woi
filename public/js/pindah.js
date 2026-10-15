// Pindah posisi: seret pin lokasi, geser beberapa ratus meter, atau lompat ke kota uji dengan bahaya
// yang berbeda-beda. Berguna untuk mencoba bagaimana aplikasi bekerja bila pengguna berpindah tempat
// atau dipakai orang lain di daerah lain.
import { $, esc, tujuan } from './util.js';
import { map } from './peta.js';
import { renderIkon } from './ui.js';

const L = window.L;
const LANGKAH_KM = 0.25;

// Kota uji, dipilih agar setiap bahaya punya contoh yang menonjol
const KOTA_UJI = [
  { nama: 'Padang, Sumatera Barat', ket: 'pesisir: tsunami & megathrust', lat: -0.9471, lon: 100.3543 },
  { nama: 'Palu, Sulawesi Tengah', ket: 'sesar aktif & likuefaksi', lat: -0.8917, lon: 119.8707 },
  { nama: 'Jakarta Timur', ket: 'banjir (data area banjir resmi)', lat: -6.2925, lon: 106.9006 },
  { nama: 'Sleman, Yogyakarta', ket: 'Gunung Merapi', lat: -7.6614, lon: 110.4214 },
  { nama: 'Banda Aceh', ket: 'tsunami', lat: 5.5483, lon: 95.3238 },
  { nama: 'Lembang, Bandung Barat', ket: 'Sesar Lembang & longsor', lat: -6.8117, lon: 107.6178 },
  { nama: 'Palangka Raya, Kalteng', ket: 'kebakaran hutan & asap', lat: -2.2136, lon: 113.9108 },
  { nama: 'Karo, Sumatera Utara', ket: 'Gunung Sinabung', lat: 3.1052, lon: 98.4932 },
];

export function pasangPindahPosisi({ setLokasi, lokasiKini }) {
  // Tombol di kelompok tombol peta
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'btn-pindah';
  btn.title = 'Pindah posisi / coba lokasi lain';
  btn.setAttribute('aria-label', 'Pindah posisi');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<i data-lucide="move"></i>';
  $('.map-buttons').insertBefore(btn, $('#btn-lapisan'));

  const panel = document.createElement('div');
  panel.id = 'panel-pindah';
  panel.className = 'panel-pindah glass';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Pindah posisi');
  panel.hidden = true;
  panel.innerHTML = `
    <p class="pt-judul">Pindah posisi</p>
    <p class="pp-ket">Seret <b>pin biru</b> di peta, ketuk peta lalu pilih "Analisis lokasi ini", atau pakai tombol di bawah.</p>
    <div class="pp-geser" role="group" aria-label="Geser ${LANGKAH_KM * 1000} meter">
      <span></span><button type="button" data-arah="0" aria-label="Geser ke utara">↑</button><span></span>
      <button type="button" data-arah="270" aria-label="Geser ke barat">←</button><span class="pp-tengah">${LANGKAH_KM * 1000} m</span><button type="button" data-arah="90" aria-label="Geser ke timur">→</button>
      <span></span><button type="button" data-arah="180" aria-label="Geser ke selatan">↓</button><span></span>
    </div>
    <p class="pt-judul">Coba kota lain</p>
    <div class="pp-kota">${KOTA_UJI.map((k, i) => `<button type="button" data-kota="${i}"><b>${esc(k.nama)}</b><span>${esc(k.ket)}</span></button>`).join('')}</div>
    <button type="button" class="pp-gps" data-gps><i data-lucide="locate-fixed"></i>Kembali ke lokasi GPS saya</button>`;
  document.getElementById('app').appendChild(panel);
  L.DomEvent.disableClickPropagation(panel);
  L.DomEvent.disableScrollPropagation(panel);
  renderIkon(btn);
  renderIkon(panel);

  const tutup = () => {
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const buka = panel.hidden;
    panel.hidden = !buka;
    btn.setAttribute('aria-expanded', String(buka));
  });
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !e.target.closest('#panel-pindah')) tutup();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) tutup();
  });

  panel.addEventListener('click', (e) => {
    const geser = e.target.closest('[data-arah]');
    const kota = e.target.closest('[data-kota]');
    if (geser) {
      const { lat, lon } = lokasiKini();
      const [la, lo] = tujuan(lat, lon, +geser.dataset.arah, LANGKAH_KM);
      setLokasi(la, lo);
    } else if (kota) {
      const k = KOTA_UJI[+kota.dataset.kota];
      setLokasi(k.lat, k.lon, k.nama);
      map.setView([k.lat, k.lon], 13);
      tutup();
    } else if (e.target.closest('[data-gps]')) {
      tutup();
      $('#btn-gps').click();
    }
  });

  document.addEventListener('lokasi:seret', (e) => setLokasi(e.detail.lat, e.detail.lon));
  pasangReposisi(lokasiKini);
}

/**
 * Tombol "Kembali ke posisi": muncul saat lokasi yang dianalisis sudah di luar layar (peta digeser jauh),
 * lalu memusatkan peta kembali tanpa menganalisis ulang. Untuk memakai GPS terbaru, pakai tombol GPS.
 */
function pasangReposisi(lokasiKini) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-reposisi glass';
  btn.hidden = true;
  btn.innerHTML = '<i data-lucide="locate"></i>Kembali ke posisi';
  document.getElementById('app').appendChild(btn);
  renderIkon(btn);
  L.DomEvent.disableClickPropagation(btn);

  const perbarui = () => {
    const l = lokasiKini();
    if (!l) return;
    // Sisakan tepi 15% agar tombol tidak muncul hanya karena pin sedikit di pinggir layar
    btn.hidden = map.getBounds().pad(-0.15).contains([l.lat, l.lon]);
  };
  map.on('moveend', perbarui);
  btn.addEventListener('click', () => {
    const l = lokasiKini();
    map.flyTo([l.lat, l.lon], Math.max(map.getZoom(), 14));
  });
}
