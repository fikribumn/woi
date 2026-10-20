// Bahasa antarmuka: Indonesia (bawaan) atau Inggris untuk wisatawan. Terjemahan Inggris mencakup layar
// yang paling penting saat darurat (peringatan gempa/tsunami, SOS, panduan, nomor darurat); bagian lain
// tetap berbahasa Indonesia. Pemakaian: tr('Teks Indonesia', 'English text').
const KUNCI = 'woi-bahasa';

// Bawaan selalu Indonesia (banyak HP di Indonesia berbahasa Inggris); Inggris dipilih sendiri oleh pengguna.
function awal() {
  try { return localStorage.getItem(KUNCI) === 'en' ? 'en' : 'id'; } catch { return 'id'; }
}

let aktif = awal();
document.documentElement.lang = aktif;

export const bahasa = () => aktif;
export const tr = (id, en) => (aktif === 'en' && en ? en : id);

/** Ganti bahasa lalu muat ulang halaman agar semua teks ikut berganti. */
export function aturBahasa(b) {
  if (b === aktif || !['id', 'en'].includes(b)) return;
  try { localStorage.setItem(KUNCI, b); } catch { /* berlaku sampai muat ulang */ }
  location.reload();
}
