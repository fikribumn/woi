// Rencana darurat keluarga: dua titik kumpul (dekat rumah & di luar lingkungan) yang ditandai di peta,
// penjemput anak, kontak di luar kota, dan kebutuhan khusus. Disimpan di perangkat, bisa dibagikan ke keluarga.
import { $, esc, setCard } from './util.js';
import { map } from './peta.js';
import { renderIkon } from './ui.js';
import { bagikan } from './platform.js';

const L = window.L;
const KUNCI = 'woi-rencana';
const lapisan = L.layerGroup().addTo(map);
let lokasiKini = () => null;

const TITIK = [
  { k: 'dekat', judul: 'Titik kumpul dekat rumah', ket: 'Tempat bertemu bila harus keluar rumah mendadak, mis. lapangan atau halaman masjid.' },
  { k: 'jauh', judul: 'Titik kumpul di luar lingkungan', ket: 'Bila lingkungan tidak aman (banjir, tsunami, kebakaran), mis. rumah saudara di dataran tinggi.' },
];
const ISIAN = [
  { k: 'penjemput', judul: 'Penjemput anak', ph: 'mis. Ayah menjemput dari SD 3; bila tidak bisa, Tante Rina' },
  { k: 'luarKota', judul: 'Kontak di luar kota', ph: 'mis. Om Budi (Bandung) 0812…, semua anggota melapor ke beliau' },
  { k: 'khusus', judul: 'Kebutuhan khusus', ph: 'Obat rutin, alergi, kursi roda, bayi, hewan peliharaan…' },
];

function baca() {
  try { return JSON.parse(localStorage.getItem(KUNCI)) || {}; } catch { return {}; }
}
function tulis(r) {
  try { localStorage.setItem(KUNCI, JSON.stringify(r)); } catch { /* abaikan */ }
}

const tautanPeta = (t) => `https://maps.google.com/?q=${t.lat.toFixed(5)},${t.lon.toFixed(5)}`;
const terisi = (r) => TITIK.filter((t) => r[t.k]).length + ISIAN.filter((i) => (r[i.k] || '').trim()).length;

function gambarPeta(r) {
  lapisan.clearLayers();
  for (const t of TITIK) {
    const p = r[t.k];
    if (!p) continue;
    L.marker([p.lat, p.lon], {
      icon: L.divIcon({ className: '', html: '<div class="pin pin-keluarga">K</div>', iconSize: [24, 24], iconAnchor: [12, 12] }),
      title: t.judul,
    }).bindPopup(`<b>${esc(t.judul)}</b><br>${esc(p.nama)}`).addTo(lapisan);
  }
}

function perbaruiLencana() {
  const r = baca();
  const n = terisi(r);
  const card = document.getElementById('card-rencana');
  const total = TITIK.length + ISIAN.length;
  const b = $('[data-badge]', card);
  b.textContent = n ? `${n}/${total} terisi` : 'Belum dibuat';
  b.dataset.level = n === total ? 'rendah' : '';
}

function render() {
  const r = baca();
  const kini = lokasiKini();
  setCard('card-rencana', {
    badge: '…',
    level: '',
    summary: 'Saat bencana, telepon sering putus dan keluarga bisa terpisah. Sepakati rencana ini bersama, lalu bagikan ke semua anggota keluarga.',
    detail: `
      ${TITIK.map((t) => {
        const p = r[t.k];
        return `<h3 class="sub">${esc(t.judul)}</h3>
          <p class="meta">${esc(t.ket)}</p>
          ${p ? `<div class="rk-titik"><i data-lucide="flag"></i><div><b>${esc(p.nama)}</b><div class="meta">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</div></div>
            <button type="button" data-rk-hapus="${t.k}" aria-label="Hapus ${esc(t.judul)}"><i data-lucide="trash-2"></i></button></div>` : ''}
          ${kini ? `<button type="button" class="btn-coba" data-rk-atur="${t.k}"><i data-lucide="map-pinned"></i>${p ? 'Ganti dengan' : 'Pakai'} lokasi yang sedang diperiksa</button>
          <p class="meta rk-bantu">${esc(kini.label)}. Seret pin biru di peta untuk memilih titik lain.</p>` : ''}`;
      }).join('')}
      ${ISIAN.map((i) => `
        <h3 class="sub"><label for="rk-${i.k}">${esc(i.judul)}</label></h3>
        <textarea id="rk-${i.k}" class="rk-isian" data-rk-isian="${i.k}" rows="2" maxlength="300" placeholder="${esc(i.ph)}">${esc(r[i.k] || '')}</textarea>`).join('')}
      <div class="hd-aksi" style="margin-top:14px">
        <button type="button" class="btn-utama" data-rk-bagikan><i data-lucide="share-2"></i>Bagikan rencana ke keluarga</button>
      </div>
      <p class="meta">Disimpan otomatis, hanya di perangkat ini.</p>`,
  });
  perbaruiLencana();
  renderIkon(document.getElementById('card-rencana'));
}

function teksRencana(r) {
  const baris = ['RENCANA DARURAT KELUARGA (TERRA WOI)'];
  for (const t of TITIK) if (r[t.k]) baris.push(`${t.judul}: ${r[t.k].nama} ${tautanPeta(r[t.k])}`);
  for (const i of ISIAN) if ((r[i.k] || '').trim()) baris.push(`${i.judul}: ${r[i.k].trim()}`);
  baris.push('Darurat: 112');
  return baris.join('\n');
}

export function pasangRencana({ lokasi }) {
  lokasiKini = lokasi;
  const card = document.getElementById('card-rencana');
  card.addEventListener('click', (e) => {
    const a = e.target.closest('[data-rk-atur]');
    if (a) {
      const kini = lokasiKini();
      const nama = window.prompt('Nama titik kumpul (mis. "Lapangan RW 05"):', kini.label);
      if (nama === null) return;
      const r = baca();
      r[a.dataset.rkAtur] = { nama: nama.trim() || kini.label, lat: kini.lat, lon: kini.lon };
      tulis(r);
      gambarPeta(r);
      return render();
    }
    const h = e.target.closest('[data-rk-hapus]');
    if (h) {
      const r = baca();
      delete r[h.dataset.rkHapus];
      tulis(r);
      gambarPeta(r);
      return render();
    }
    if (e.target.closest('[data-rk-bagikan]')) {
      const r = baca();
      if (!terisi(r)) return window.alert('Isi rencana terlebih dahulu.');
      bagikan({ judul: 'Rencana darurat keluarga', teks: teksRencana(r) });
    }
  });
  // Isian teks disimpan saat diketik tanpa menggambar ulang (fokus & kursor tetap)
  card.addEventListener('input', (e) => {
    const t = e.target.closest('[data-rk-isian]');
    if (!t) return;
    const r = baca();
    r[t.dataset.rkIsian] = t.value;
    tulis(r);
    perbaruiLencana();
  });
  gambarPeta(baca());
  render();
}

/** Lokasi yang diperiksa berubah: perbarui tombol "pakai lokasi ini". */
export function perbaruiRencana() {
  if (document.activeElement?.closest?.('#card-rencana')) return; // jangan ganggu yang sedang mengetik
  render();
}

/** Titik kumpul keluarga, untuk ditampilkan di tempat lain (mis. mode darurat). */
export function titikKumpulKeluarga() {
  const r = baca();
  return TITIK.filter((t) => r[t.k]).map((t) => ({ ...r[t.k], jenis: t.k, judul: t.judul }));
}
