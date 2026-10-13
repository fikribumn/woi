// Antarmuka ala Apple: ubin ringkasan (tersinkron dengan kartu detail), navigasi halaman di dalam sheet,
// sheet bawah yang bisa diseret di layar kecil, dan ikon Lucide.
import { $, esc, URUTAN_LEVEL } from './util.js';
import { map, kontrolLapisan } from './peta.js';

export const KARTU = [
  { id: 'card-gempa', judul: 'Gempa', ikon: 'activity', warna: 'var(--red)' },
  { id: 'card-tsunami', judul: 'Tsunami', ikon: 'waves', warna: 'var(--blue)' },
  { id: 'card-hujan', judul: 'Hujan & Longsor', ikon: 'cloud-rain', warna: 'var(--teal)' },
  { id: 'card-gunung', judul: 'Gunung Api', ikon: 'mountain', warna: 'var(--orange)' },
  { id: 'card-kebakaran', judul: 'Kebakaran', ikon: 'flame', warna: 'var(--red)' },
  { id: 'card-udara', judul: 'Udara', ikon: 'wind', warna: 'var(--indigo)' },
  { id: 'card-geologi', judul: 'Geologi', ikon: 'layers-3', warna: 'var(--brown)' },
  { id: 'card-bangunan', judul: 'Bangunan', ikon: 'building-2', warna: 'var(--gray)' },
];
const BARIS = [
  { id: 'card-titik', judul: 'Titik Kumpul & Evakuasi', ikon: 'flag', warna: 'var(--teal)' },
  { id: 'card-aman', judul: 'Tempat Paling Aman', ikon: 'shield-check', warna: 'var(--green)' },
  { id: 'card-jarak', judul: 'Jarak ke Sumber Bahaya', ikon: 'ruler', warna: 'var(--purple)' },
];
const SEMUA = [...KARTU, ...BARIS];

export const ikon = (nama, kelas = '') => `<i data-lucide="${nama}" class="${kelas}"></i>`;
export function renderIkon(root = document) {
  if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 2 }, nameAttr: 'data-lucide', root });
}

const teksPolos = (html) => {
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
};
const kalimatPertama = (t) => {
  const m = t.match(/^(.{20,160}?[.!?])(\s|$)/);
  return m ? m[1] : t.slice(0, 140);
};

// ---------- Ubin & baris beranda ----------
function bangunBeranda() {
  $('#tiles').innerHTML = KARTU.map((k) => `
    <button type="button" class="tile" data-tile="${k.id}" style="--c:${k.warna}">
      <span class="tile-head">${ikon(k.ikon)}${esc(k.judul)}</span>
      <span class="tile-val" data-tv>…</span>
      <span class="tile-sub" data-ts>Memuat</span>
    </button>`).join('');
  $('#group-baris').innerHTML = BARIS.map((k) => `
    <button type="button" class="row" data-tile="${k.id}" style="--c:${k.warna}">
      <span class="row-ikon">${ikon(k.ikon)}</span>
      <span class="row-body"><span class="row-title">${esc(k.judul)}</span><span class="row-val" data-tv>…</span>${ikon('chevron-right', 'row-chev')}</span>
    </button>`).join('');

  // Judul tiap halaman detail: ikon + tombol kembali
  for (const k of SEMUA) {
    const card = document.getElementById(k.id);
    const h2 = $('h2', card);
    h2.insertAdjacentHTML('afterbegin', `<span class="row-ikon" style="--c:${k.warna}">${ikon(k.ikon)}</span>`);
    card.insertAdjacentHTML('afterbegin', `<button type="button" class="back" data-back>${ikon('chevron-left')}Ringkasan</button>`);
  }

  document.querySelectorAll('[data-tile]').forEach((b) => b.addEventListener('click', () => bukaHalaman(b.dataset.tile)));
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => bukaHalaman(null)));
}

function sinkronUbin(id) {
  const card = document.getElementById(id);
  const tile = document.querySelector(`[data-tile="${id}"]`);
  if (!card || !tile) return;
  const badge = $('[data-badge]', card);
  tile.dataset.level = badge.dataset.level || '';
  if (!badge.dataset.level) tile.removeAttribute('data-level');
  $('[data-tv]', tile).textContent = badge.textContent;
  const sub = $('[data-ts]', tile);
  if (sub) sub.textContent = kalimatPertama(teksPolos($('[data-summary]', card).innerHTML));
  ringkasRisiko();
}

const NAMA_LV = { rendah: 'Rendah', sedang: 'Sedang', tinggi: 'Tinggi', bahaya: 'Sangat tinggi' };
function ringkasRisiko() {
  const daftar = KARTU
    .map((k) => ({ ...k, level: document.getElementById(k.id).querySelector('[data-badge]').dataset.level || '' }))
    .filter((k) => k.level && k.id !== 'card-bangunan');
  const el = $('#ringkas-risiko');
  if (!daftar.length) return;
  const maks = Math.max(...daftar.map((k) => URUTAN_LEVEL[k.level]));
  const teratas = daftar.filter((k) => URUTAN_LEVEL[k.level] === maks);
  const lv = teratas[0].level;
  el.innerHTML = maks <= 1
    ? '<b>Kondisi umumnya aman.</b> <span class="muted">Tidak ada bahaya menonjol saat ini.</span>'
    : `<span class="muted">Perhatian utama:</span> <b style="color:var(--${{ sedang: 't-yellow', tinggi: 't-orange', bahaya: 't-red' }[lv]})">${teratas.map((k) => esc(k.judul)).join(', ')}</b> <span class="muted">· ${NAMA_LV[lv]}</span>`;
}

function amatiKartu() {
  for (const k of SEMUA) {
    const card = document.getElementById(k.id);
    const obs = new MutationObserver(() => sinkronUbin(k.id));
    obs.observe($('[data-badge]', card), { childList: true, characterData: true, subtree: true, attributes: true });
    obs.observe($('[data-summary]', card), { childList: true, characterData: true, subtree: true });
    sinkronUbin(k.id);
  }
}

// ---------- Navigasi halaman ----------
export function bukaHalaman(id) {
  $('#page-home').hidden = !!id;
  for (const k of SEMUA) document.getElementById(k.id).hidden = k.id !== id;
  $('#sheet-scroll').scrollTop = 0;
  if (id && kecil()) aturSheet('penuh');
}

// ---------- Sheet bawah (layar kecil) ----------
const kecil = () => window.matchMedia('(max-width: 899px)').matches;
const POSISI = { intip: 0.24, setengah: 0.5, penuh: 0.92 };
let posisi = 'setengah';

function aturSheet(nama, px) {
  posisi = nama;
  const tinggi = px ?? Math.round(window.innerHeight * POSISI[nama]);
  document.documentElement.style.setProperty('--sheet-visible', `${tinggi}px`);
}

function pasangSeret() {
  const sheet = $('#sheet');
  const grab = $('#grabber');
  let awalY = 0;
  let awalTinggi = 0;
  let seret = false;
  grab.addEventListener('pointerdown', (e) => {
    if (!kecil()) return;
    seret = true;
    awalY = e.clientY;
    awalTinggi = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-visible')) || window.innerHeight * 0.5;
    sheet.classList.add('menyeret');
    grab.setPointerCapture(e.pointerId);
  });
  grab.addEventListener('pointermove', (e) => {
    if (!seret) return;
    const h = Math.min(window.innerHeight * 0.92, Math.max(90, awalTinggi + (awalY - e.clientY)));
    document.documentElement.style.setProperty('--sheet-visible', `${h}px`);
  });
  const selesai = (e) => {
    if (!seret) return;
    seret = false;
    sheet.classList.remove('menyeret');
    const h = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-visible'));
    const geser = Math.abs(e.clientY - awalY);
    if (geser < 6) {
      // ketuk: bergantian setengah <-> penuh
      aturSheet(posisi === 'penuh' ? 'setengah' : 'penuh');
      return;
    }
    const rasio = h / window.innerHeight;
    const terdekat = Object.entries(POSISI).sort((a, b) => Math.abs(a[1] - rasio) - Math.abs(b[1] - rasio))[0][0];
    aturSheet(terdekat);
  };
  grab.addEventListener('pointerup', selesai);
  grab.addEventListener('pointercancel', selesai);
  grab.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') aturSheet(posisi === 'penuh' ? 'intip' : 'penuh');
  });
  window.addEventListener('resize', () => aturSheet(posisi));
  // Saat peta disentuh di HP, turunkan sheet agar peta lega
  map.on('dragstart', () => { if (kecil() && posisi !== 'intip') aturSheet('intip'); });
}

/** Turunkan sheet (mis. saat mode darurat menampilkan rute). */
export function turunkanSheet() {
  if (kecil()) aturSheet('intip');
}

/** Padding fitBounds yang menyisakan ruang untuk panel (di kiri pada desktop, di bawah pada HP). */
export function paddingPanel(panel) {
  const kotak = panel.getBoundingClientRect();
  return window.innerWidth >= 900
    ? { paddingTopLeft: [kotak.right + 24, 60], paddingBottomRight: [60, 60] }
    : { paddingTopLeft: [24, 140], paddingBottomRight: [24, kotak.height + 24] };
}

// ---------- Tombol peta ----------
function pasangTombolPeta() {
  const btn = $('#btn-lapisan');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const el = kontrolLapisan.getContainer();
    if (el.classList.contains('leaflet-control-layers-expanded')) kontrolLapisan.collapse();
    else kontrolLapisan.expand();
  });
}

export function setMemuat(aktif) {
  $('#btn-refresh').classList.toggle('berputar', aktif);
}

export function pasangUI() {
  bangunBeranda();
  amatiKartu();
  pasangSeret();
  pasangTombolPeta();
  aturSheet('setengah');
  renderIkon();
}
