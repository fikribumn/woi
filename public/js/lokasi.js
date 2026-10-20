// Lokasi tersimpan (rumah, kantor, sekolah anak, rumah orang tua): dipilih cepat dari kolom pencarian,
// ditandai di peta, dan ikut dipantau saat ada gempa (di halaman ini maupun di latar aplikasi Android).
import { $, esc, fmtKm, jarakKm, setCard } from './util.js';
import { map } from './peta.js';
import { renderIkon } from './ui.js';
import { aturLokasiTersimpanLatar } from './platform.js';

const L = window.L;
const KUNCI = 'woi-lokasi-tersimpan';
const MAKS = 8;
const USULAN = ['Rumah', 'Kantor', 'Sekolah anak', 'Rumah orang tua'];

let setLokasi = () => {};
let lokasiKini = () => null;
const lapisan = L.layerGroup().addTo(map);

export function daftarLokasiTersimpan() {
  try { return JSON.parse(localStorage.getItem(KUNCI)) || []; } catch { return []; }
}
function simpan(daftar) {
  try { localStorage.setItem(KUNCI, JSON.stringify(daftar)); } catch { /* abaikan */ }
  sinkron();
}

function sinkron() {
  const daftar = daftarLokasiTersimpan();
  aturLokasiTersimpanLatar(daftar.map(({ nama, lat, lon, pesisir }) => ({ nama, lat, lon, pesisir: !!pesisir })));
  lapisan.clearLayers();
  for (const l of daftar) {
    L.marker([l.lat, l.lon], {
      icon: L.divIcon({ className: '', html: `<div class="pin pin-tersimpan">${esc(l.nama.slice(0, 1).toUpperCase())}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
      title: l.nama,
    }).bindPopup(`<b>${esc(l.nama)}</b><br><button type="button" class="pz-btn" data-analisis-simpan="${esc(l.id)}">Analisis lokasi ini</button>`).addTo(lapisan);
  }
  render();
}

function render() {
  const daftar = daftarLokasiTersimpan();
  const kini = lokasiKini();
  const sudahAda = kini && daftar.some((l) => jarakKm(l.lat, l.lon, kini.lat, kini.lon) < 0.05);
  setCard('card-lokasi', {
    badge: daftar.length ? `${daftar.length} lokasi` : 'Kosong',
    level: '',
    summary: 'Simpan tempat penting keluarga. Peringatan gempa juga memeriksa semua lokasi ini, mis. "gempa terasa di dekat Rumah orang tua".',
    detail: `
      ${daftar.length ? `<ul class="list kd-keluarga">${daftar.map((l) => `
        <li>
          <div><b>${esc(l.nama)}</b><div class="meta">${kini ? `${fmtKm(jarakKm(kini.lat, kini.lon, l.lat, l.lon))} dari lokasi diperiksa · ` : ''}${l.pesisir ? 'pesisir' : 'bukan pesisir'}</div></div>
          <div class="kd-aksi">
            <button type="button" data-buka-lokasi="${esc(l.id)}" aria-label="Analisis ${esc(l.nama)}"><i data-lucide="scan-search"></i></button>
            <button type="button" data-hapus-lokasi="${esc(l.id)}" aria-label="Hapus ${esc(l.nama)}"><i data-lucide="trash-2"></i></button>
          </div>
        </li>`).join('')}</ul>` : ''}
      ${!kini ? '' : sudahAda ? '<p class="meta">Lokasi yang sedang diperiksa sudah tersimpan.</p>' : daftar.length >= MAKS ? `<p class="meta">Maksimal ${MAKS} lokasi. Hapus salah satu untuk menambah.</p>` : `
        <h3 class="sub">Simpan lokasi yang sedang diperiksa</h3>
        <p class="meta">${esc(kini.label)}</p>
        <div class="lk-usulan">${USULAN.filter((u) => !daftar.some((l) => l.nama === u)).map((u) => `<button type="button" data-nama-usulan="${esc(u)}">${esc(u)}</button>`).join('')}</div>
        <form class="kd-form" data-form-lokasi>
          <input name="nama" required maxlength="30" placeholder="Nama lain (mis. Kos Adik)" autocomplete="off" aria-label="Nama lokasi">
          <button type="submit" aria-label="Simpan lokasi"><i data-lucide="bookmark-plus"></i></button>
        </form>`}
      <p class="meta">Pindah ke lokasi lain lewat kolom pencarian atau seret pin biru, lalu simpan dari sini. Lokasi hanya disimpan di perangkat ini.</p>`,
  });
  renderIkon(document.getElementById('card-lokasi'));
}

function tambah(nama) {
  const kini = lokasiKini();
  if (!kini || !nama) return;
  const daftar = daftarLokasiTersimpan();
  if (daftar.length >= MAKS) return;
  daftar.push({ id: String(Date.now()), nama: nama.slice(0, 30), lat: +kini.lat.toFixed(5), lon: +kini.lon.toFixed(5), pesisir: !!kini.pesisir, label: kini.label });
  simpan(daftar);
}

function buka(id) {
  const l = daftarLokasiTersimpan().find((x) => x.id === id);
  if (l) setLokasi(l.lat, l.lon, l.nama);
}

// Saran cepat saat kolom pencarian kosong difokuskan
function pasangPencarian() {
  const input = $('#input-cari');
  const hasil = $('#hasil-cari');
  input.addEventListener('focus', () => {
    const daftar = daftarLokasiTersimpan();
    if (input.value.trim() || !daftar.length) return;
    hasil.hidden = false;
    hasil.innerHTML = `<li class="muted lk-judul">Lokasi tersimpan</li>${daftar.map((l) => `<li data-lokasi-simpan="${esc(l.id)}">★ ${esc(l.nama)}</li>`).join('')}`;
  });
  hasil.addEventListener('click', (e) => {
    const li = e.target.closest('[data-lokasi-simpan]');
    if (!li) return;
    hasil.hidden = true;
    input.blur();
    buka(li.dataset.lokasiSimpan);
  });
}

/** Dipanggil main.js sekali. */
export function pasangLokasiTersimpan(opsi) {
  ({ setLokasi, lokasiKini } = opsi);
  const card = document.getElementById('card-lokasi');
  card.addEventListener('click', (e) => {
    const u = e.target.closest('[data-nama-usulan]');
    if (u) return tambah(u.dataset.namaUsulan);
    const b = e.target.closest('[data-buka-lokasi]');
    if (b) return buka(b.dataset.bukaLokasi);
    const h = e.target.closest('[data-hapus-lokasi]');
    if (h) {
      const daftar = daftarLokasiTersimpan();
      const l = daftar.find((x) => x.id === h.dataset.hapusLokasi);
      if (l && window.confirm(`Hapus lokasi "${l.nama}"?`)) simpan(daftar.filter((x) => x !== l));
    }
  });
  card.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-form-lokasi]');
    if (!f) return;
    e.preventDefault();
    tambah(f.nama.value.trim());
  });
  map.on('popupopen', (e) => {
    e.popup.getElement()?.querySelector('[data-analisis-simpan]')?.addEventListener('click', (ev) => {
      map.closePopup();
      buka(ev.currentTarget.dataset.analisisSimpan);
    });
  });
  pasangPencarian();
  sinkron();
}

/** Dipanggil setiap lokasi analisis berubah atau selesai dianalisis (memperbarui status pesisir lokasi tersimpan). */
export function perbaruiLokasiTersimpan() {
  const kini = lokasiKini();
  const daftar = daftarLokasiTersimpan();
  const sama = kini && daftar.find((l) => jarakKm(l.lat, l.lon, kini.lat, kini.lon) < 0.05);
  if (sama && kini.pesisir !== undefined && sama.pesisir !== kini.pesisir) {
    sama.pesisir = kini.pesisir;
    simpan(daftar);
  } else {
    render();
  }
}
