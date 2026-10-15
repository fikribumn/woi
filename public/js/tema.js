// Tema tampilan (Awan, Mochi, Stiker) dan mode terang/gelap. Atribut awal dipasang skrip di <head>;
// modul ini menyimpan pilihan, mengikuti perubahan mode sistem, dan memberi tahu modul lain lewat event 'tema:ganti'.

export const TEMA = [
  { id: 'awan', nama: 'Awan', ket: 'Putih, lapang, tenang', contoh: ['#f5f7fb', '#2f6bff', '#ffce54'] },
  { id: 'mochi', nama: 'Mochi', ket: 'Pastel lembut dan bulat', contoh: ['#fbf6ee', '#5b7cfa', '#ffaa78'] },
  { id: 'stiker', nama: 'Stiker', ket: 'Ilustrasi datar, playful', contoh: ['#fff4dc', '#d6336c', '#2b2340'] },
];
export const MODE = [
  { id: 'otomatis', nama: 'Otomatis', ikon: 'sun-moon' },
  { id: 'terang', nama: 'Terang', ikon: 'sun' },
  { id: 'gelap', nama: 'Gelap', ikon: 'moon' },
];

const root = document.documentElement;
const sistemGelap = window.matchMedia('(prefers-color-scheme: dark)');

export const temaAktif = () => root.dataset.tema || 'awan';
export const modeAktif = () => root.dataset.mode || 'otomatis';
export const gelapAktif = () => root.hasAttribute('data-gelap');

function simpan(kunci, nilai) {
  try { localStorage.setItem(kunci, nilai); } catch { /* penyimpanan diblokir: pilihan berlaku sampai muat ulang */ }
}

function terapkan() {
  const m = modeAktif();
  root.toggleAttribute('data-gelap', m === 'gelap' || (m === 'otomatis' && sistemGelap.matches));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim() || '#f5f7fb';
  document.dispatchEvent(new CustomEvent('tema:ganti', { detail: { tema: temaAktif(), gelap: gelapAktif() } }));
}

export function aturTema(id) {
  if (!TEMA.some((t) => t.id === id) || id === temaAktif()) return;
  root.dataset.tema = id;
  simpan('woi-tema', id);
  terapkan();
}

export function aturMode(id) {
  if (!MODE.some((m) => m.id === id) || id === modeAktif()) return;
  root.dataset.mode = id;
  simpan('woi-mode', id);
  terapkan();
}

sistemGelap.addEventListener('change', () => { if (modeAktif() === 'otomatis') terapkan(); });
