// Antarmuka ala Apple: ubin ringkasan (tersinkron dengan kartu detail), navigasi halaman di dalam sheet,
// sheet bawah yang bisa diseret di layar kecil, dan ikon Lucide.
import { $, esc, URUTAN_LEVEL } from './util.js';
import { map, kontrolLapisan } from './peta.js';
import { TEMA, MODE, temaAktif, modeAktif, aturTema, aturMode, gelapAktif } from './tema.js';
import { warnaBilahSistem } from './platform.js';

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
// Tiga aksi utama di beranda
const AKSI = [
  { id: 'card-aman', judul: 'Tempat aman', ikon: 'shield-check', warna: 'var(--green)' },
  { id: 'card-titik', judul: 'Titik kumpul', ikon: 'flag', warna: 'var(--teal)' },
  { id: 'card-siaga', judul: 'Siaga', ikon: 'life-buoy', warna: 'var(--orange)' },
];
// Detail tambahan, di dalam "Lihat semua bahaya"
const BARIS = [
  { id: 'card-jarak', judul: 'Jarak ke Sumber Bahaya', ikon: 'ruler', warna: 'var(--purple)' },
];
// Isi halaman Siaga (sos = aksi, bukan halaman)
const SIAGA = [
  { id: 'card-kontak', judul: 'Kontak Darurat & Kabari Keluarga', ikon: 'phone-call', warna: 'var(--red)' },
  { id: 'sos', judul: 'SOS: saya terjebak', ikon: 'siren', warna: 'var(--red)', aksi: true },
  { id: 'card-rencana', judul: 'Rencana Keluarga', ikon: 'users', warna: 'var(--blue)' },
  { id: 'card-tas', judul: 'Tas Siaga Bencana', ikon: 'backpack', warna: 'var(--orange)' },
  { id: 'card-panduan', judul: 'Panduan Bencana', ikon: 'book-open', warna: 'var(--teal)' },
];
const SIAGA_2 = [
  { id: 'card-lokasi', judul: 'Lokasi Tersimpan', ikon: 'map-pinned', warna: 'var(--indigo)' },
  { id: 'card-offline', judul: 'Peta & Data Offline', ikon: 'hard-drive-download', warna: 'var(--gray)' },
  { id: 'card-pengaturan', judul: 'Pengaturan & Tentang', ikon: 'settings', warna: 'var(--gray)' },
];
const HALAMAN_SIAGA = [...SIAGA, ...SIAGA_2].filter((k) => !k.aksi);
const SEMUA = [...KARTU, ...AKSI, ...BARIS, ...HALAMAN_SIAGA];
// Halaman induk untuk tombol kembali
const INDUK = Object.fromEntries(HALAMAN_SIAGA.map((k) => [k.id, 'card-siaga']));

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

// ---------- Beranda ----------
const baris = (daftar) => daftar.map((k) => `
  <button type="button" class="row" ${k.aksi ? `data-aksi-baris="${k.id}"` : `data-tile="${k.id}"`} style="--c:${k.warna}">
    <span class="row-ikon">${ikon(k.ikon)}</span>
    <span class="row-body"><span class="row-title">${esc(k.judul)}</span>${k.aksi ? '' : '<span class="row-val" data-tv></span>'}${ikon('chevron-right', 'row-chev')}</span>
  </button>`).join('');

let bukaSosFn = () => {};
/** main.js memberi fungsi pembuka layar SOS (menghindari impor melingkar). */
export const aturPembukaSos = (fn) => { bukaSosFn = fn; };

function bangunBeranda() {
  $('#tiles').innerHTML = KARTU.map((k) => `
    <button type="button" class="tile memuat" data-tile="${k.id}" style="--c:${k.warna}">
      <span class="tile-head">${ikon(k.ikon)}${esc(k.judul)}</span>
      <span class="tile-val" data-tv>…</span>
      <span class="tile-sub" data-ts>Memuat</span>
    </button>`).join('');
  $('#aksi-cepat').innerHTML = AKSI.map((k) => `
    <button type="button" class="aksi" data-tile="${k.id}" style="--c:${k.warna}">
      <span class="row-ikon">${ikon(k.ikon)}</span><span class="aksi-judul">${esc(k.judul)}</span>
    </button>`).join('');
  $('#group-baris').innerHTML = baris(BARIS);
  $('#group-siaga').innerHTML = baris(SIAGA);
  $('#group-siaga-2').innerHTML = baris(SIAGA_2);

  // Judul tiap halaman detail: ikon + tombol kembali (ke Siaga untuk halaman persiapan, selain itu ke ringkasan)
  for (const k of SEMUA) {
    const card = document.getElementById(k.id);
    const h2 = $('h2', card);
    h2.insertAdjacentHTML('afterbegin', `<span class="row-ikon" style="--c:${k.warna}">${ikon(k.ikon)}</span>`);
    card.insertAdjacentHTML('afterbegin', `<button type="button" class="back" data-back="${INDUK[k.id] || ''}">${ikon('chevron-left')}${INDUK[k.id] ? 'Siaga' : 'Ringkasan'}</button>`);
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tile]');
    if (t) return bukaHalaman(t.dataset.tile);
    const b = e.target.closest('[data-back]');
    if (b) return bukaHalaman(b.dataset.back || null);
    const a = e.target.closest('[data-aksi-baris]');
    if (a && a.dataset.aksiBaris === 'sos') bukaSosFn();
  });
  $('#status-utama').addEventListener('click', () => {
    const id = $('#status-utama').dataset.buka;
    if (id) bukaHalaman(id);
  });
}

const PENTING = new Set(['sedang', 'tinggi', 'bahaya']);
function sinkronUbin(id) {
  const card = document.getElementById(id);
  const tile = document.querySelector(`#tiles [data-tile="${id}"], #tiles-penting [data-tile="${id}"]`);
  const badge = $('[data-badge]', card);
  const row = document.querySelector(`.row[data-tile="${id}"] [data-tv]`);
  if (row) row.textContent = badge.textContent === '…' ? '' : badge.textContent;
  if (!tile) return;
  tile.dataset.level = badge.dataset.level || '';
  if (!badge.dataset.level) tile.removeAttribute('data-level');
  $('[data-tv]', tile).textContent = badge.textContent;
  tile.classList.toggle('memuat', badge.textContent === '…');
  const sub = $('[data-ts]', tile);
  if (sub) sub.textContent = kalimatPertama(teksPolos($('[data-summary]', card).innerHTML));
  tataUbin();
  renderStatus();
}

/** Bahaya sedang ke atas tampil langsung di beranda; sisanya di "Lihat semua bahaya". Urutan tetap seperti KARTU. */
function tataUbin() {
  const penting = $('#tiles-penting');
  const lain = $('#tiles');
  let memuat = 0;
  for (const k of KARTU) {
    const t = document.querySelector(`[data-tile="${k.id}"].tile`);
    if (t.classList.contains('memuat')) memuat++;
    const tujuan = PENTING.has(t.dataset.level) && k.id !== 'card-bangunan' ? penting : lain;
    tujuan.append(t); // append memindahkan elemen; urutan mengikuti KARTU
  }
  $('#penting-kosong').hidden = memuat > 0 || penting.children.length > 0;
  const n = lain.children.length;
  $('#semua-bahaya summary span').textContent = penting.children.length ? `Lihat bahaya lainnya (${n})` : `Lihat semua bahaya (${n})`;
}

const STATUS = {
  aman: { judul: 'Aman', ikon: 'shield-check' },
  sedang: { judul: 'Waspada', ikon: 'alert-triangle' },
  tinggi: { judul: 'Rawan', ikon: 'alert-triangle' },
  bahaya: { judul: 'Bahaya', ikon: 'siren' },
};
let statusTerakhir = '';
function renderStatus() {
  const el = $('#status-utama');
  const daftar = KARTU
    .map((k) => ({ ...k, level: document.getElementById(k.id).querySelector('[data-badge]').dataset.level || '' }))
    .filter((k) => k.level && k.id !== 'card-bangunan');
  const memuat = KARTU.some((k) => document.getElementById(k.id).querySelector('[data-badge]').textContent === '…');
  let kunci;
  let judul;
  let isi;
  let lv;
  if (!daftar.length) {
    lv = 'memuat';
    judul = memuat ? 'Menganalisis…' : 'Belum ada data';
    isi = memuat ? 'Memeriksa bahaya di sekitar Anda' : 'Periksa koneksi lalu muat ulang';
    el.dataset.buka = '';
  } else {
    const maks = Math.max(...daftar.map((k) => URUTAN_LEVEL[k.level]));
    const teratas = daftar.filter((k) => URUTAN_LEVEL[k.level] === maks);
    lv = maks <= 1 ? 'aman' : teratas[0].level;
    judul = STATUS[lv].judul;
    isi = maks <= 1 ? 'Tidak ada bahaya menonjol di sekitar Anda.' : `Perhatian: ${teratas.map((k) => k.judul).join(', ')}`;
    el.dataset.buka = maks <= 1 ? '' : teratas[0].id;
  }
  kunci = `${lv}|${judul}|${isi}`;
  if (kunci === statusTerakhir) return;
  statusTerakhir = kunci;
  el.dataset.level = lv;
  $('[data-su-judul]', el).textContent = judul;
  $('[data-su-isi]', el).textContent = isi;
  $('.su-ikon', el).innerHTML = ikon(lv === 'memuat' ? 'loader' : STATUS[lv].ikon);
  renderIkon(el);
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
  if (id && !kecil()) ciutkanPanel(false, false);
}

// ---------- Panel ciut (desktop) ----------
// Panel bisa diciutkan menjadi kartu kecil berisi nama lokasi & ringkasan risiko agar peta lega.
export function ciutkanPanel(ciut, simpan = true) {
  const btn = $('#btn-ciut');
  $('#sheet').classList.toggle('ciut', ciut);
  document.documentElement.classList.toggle('panel-ciut', ciut);
  btn.setAttribute('aria-expanded', String(!ciut));
  const label = ciut ? 'Tampilkan panel' : 'Sembunyikan panel';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  if (!simpan) return;
  try { localStorage.setItem('woi-panel-ciut', ciut ? '1' : '0'); } catch { /* cukup untuk sesi ini */ }
}

function pasangCiut() {
  const sheet = $('#sheet');
  $('#btn-ciut').addEventListener('click', (e) => {
    e.stopPropagation();
    ciutkanPanel(!sheet.classList.contains('ciut'));
  });
  // Kartu yang diciutkan bisa diketuk di mana saja untuk dibuka lagi
  sheet.addEventListener('click', () => {
    if (sheet.classList.contains('ciut') && !kecil()) ciutkanPanel(false);
  });
  let awal = false;
  try { awal = localStorage.getItem('woi-panel-ciut') === '1'; } catch { /* abaikan */ }
  if (awal) ciutkanPanel(true);
}

// ---------- Sheet bawah (layar kecil) ----------
const kecil = () => window.matchMedia('(max-width: 899px)').matches;
const POSISI = { intip: 0.24, setengah: 0.5, penuh: 0.92 };
let posisi = 'setengah';

function aturSheet(nama, px) {
  posisi = nama;
  const tinggi = px ?? Math.round(window.innerHeight * POSISI[nama]);
  aturTinggiSheet(tinggi);
}

/** Saat sheet hampir penuh, kontrol peta yang mengambang disembunyikan agar tidak menimpa isi sheet. */
function aturTinggiSheet(px) {
  document.documentElement.style.setProperty('--sheet-visible', `${px}px`);
  document.documentElement.classList.toggle('sheet-penuh', kecil() && px > window.innerHeight * 0.7);
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
    aturTinggiSheet(h);
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

/** Beri ruang untuk peta (mis. saat mode darurat menampilkan rute): turunkan sheet di HP, ciutkan panel di desktop. */
export function turunkanSheet() {
  if (kecil()) aturSheet('intip');
  else ciutkanPanel(true, false); // otomatis, tidak mengubah pilihan pengguna
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
  // Tombol yang jarang dipakai (pindah posisi, muat ulang, tema) disembunyikan di balik "Lainnya"
  const grup = $('.map-buttons');
  const lainnya = $('#btn-lainnya');
  lainnya.addEventListener('click', (e) => {
    e.stopPropagation();
    const buka = !grup.classList.contains('terbuka');
    grup.classList.toggle('terbuka', buka);
    lainnya.setAttribute('aria-expanded', String(buka));
    lainnya.setAttribute('aria-label', buka ? 'Tutup tombol lainnya' : 'Tombol lainnya');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.map-buttons, #panel-tema, #panel-pindah')) {
      grup.classList.remove('terbuka');
      lainnya.setAttribute('aria-expanded', 'false');
    }
  });
  const btn = $('#btn-lapisan');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const el = kontrolLapisan.getContainer();
    if (el.classList.contains('leaflet-control-layers-expanded')) kontrolLapisan.collapse();
    else {
      tutupPanelTema();
      kontrolLapisan.expand();
    }
  });
}

// ---------- Pemilih tema ----------
const panelTema = () => $('#panel-tema');
function tutupPanelTema() {
  panelTema().hidden = true;
  $('#btn-tema').setAttribute('aria-expanded', 'false');
}

/** Buka panel tema dari tempat lain (halaman Pengaturan). Di HP sheet diturunkan agar panel terlihat. */
export function bukaPanelTema() {
  if (kecil()) aturSheet('intip');
  else ciutkanPanel(true, false);
  setTimeout(() => {
    panelTema().hidden = false;
    $('#btn-tema').setAttribute('aria-expanded', 'true');
    kontrolLapisan.collapse();
  }, 0);
}

function perbaruiPanelTema() {
  document.querySelectorAll('#pt-tema [data-tema]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tema === temaAktif())));
  document.querySelectorAll('#pt-mode [data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === modeAktif())));
}

function pasangPemilihTema() {
  $('#pt-tema').innerHTML = TEMA.map((t) => `
    <button type="button" data-tema="${t.id}">
      <span class="pt-contoh">${t.contoh.map((c) => `<i style="background:${c}"></i>`).join('')}</span>
      <span class="pt-teks"><span class="pt-nama">${esc(t.nama)}</span><span class="pt-ket">${esc(t.ket)}</span></span>
    </button>`).join('');
  $('#pt-mode').innerHTML = MODE.map((m) => `<button type="button" data-mode="${m.id}">${ikon(m.ikon)}${esc(m.nama)}</button>`).join('');
  $('#pt-tema').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tema]');
    if (b) aturTema(b.dataset.tema);
  });
  $('#pt-mode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b) aturMode(b.dataset.mode);
  });
  document.addEventListener('tema:ganti', perbaruiPanelTema);
  perbaruiPanelTema();

  const btn = $('#btn-tema');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const buka = panelTema().hidden;
    panelTema().hidden = !buka;
    btn.setAttribute('aria-expanded', String(buka));
    if (buka) kontrolLapisan.collapse();
  });
  document.addEventListener('click', (e) => {
    if (!panelTema().hidden && !e.target.closest('#panel-tema')) tutupPanelTema();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panelTema().hidden) {
      tutupPanelTema();
      btn.focus();
    }
  });
  cegahKlikPeta(panelTema());
}

/** Klik & gulir di panel tidak boleh diteruskan ke peta. */
function cegahKlikPeta(el) {
  window.L.DomEvent.disableClickPropagation(el);
  window.L.DomEvent.disableScrollPropagation(el);
}

/**
 * Tombol kembali Android, setelah penutup yang didaftarkan modul lain: tutup panel/popup yang terbuka,
 * kembali dari halaman detail ke ringkasan, lalu turunkan sheet. false = tidak ada yang ditutup.
 */
export function kembaliUI() {
  const terbuka = document.querySelector('dialog[open]:not(#dialog-sambut)');
  if (terbuka) {
    terbuka.close();
    return true;
  }
  if (!panelTema().hidden) {
    tutupPanelTema();
    return true;
  }
  const lapisanEl = kontrolLapisan.getContainer();
  if (lapisanEl.classList.contains('leaflet-control-layers-expanded')) {
    kontrolLapisan.collapse();
    return true;
  }
  const menu = document.querySelector('.pl-menu:not([hidden]), .panel-pindah:not([hidden])');
  if (menu) {
    menu.hidden = true;
    return true;
  }
  if (map._popup?.isOpen()) {
    map.closePopup();
    return true;
  }
  if ($('#page-home').hidden) {
    const terbuka = SEMUA.find((k) => !document.getElementById(k.id).hidden);
    bukaHalaman(terbuka ? INDUK[terbuka.id] || null : null);
    return true;
  }
  if (kecil() && posisi !== 'intip') {
    aturSheet('intip');
    return true;
  }
  return false;
}

function pasangBilahSistem() {
  const terapkan = () => {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    warnaBilahSistem(bg, gelapAktif());
  };
  document.addEventListener('tema:ganti', terapkan);
  terapkan();
}

export function setMemuat(aktif) {
  $('#btn-refresh').classList.toggle('berputar', aktif);
}

export function pasangUI() {
  bangunBeranda();
  amatiKartu();
  pasangSeret();
  pasangCiut();
  pasangTombolPeta();
  pasangPemilihTema();
  pasangBilahSistem();
  // Di HP sheet mulai dari posisi intip (lokasi + ringkasan risiko) agar peta tidak tertutup
  aturSheet('intip');
  renderIkon();
}
