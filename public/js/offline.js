// Halaman "Peta & data offline": simpan peta sekitar lokasi untuk dipakai tanpa sinyal, lihat pemakaian
// penyimpanan, dan hapus data offline. Data analisis terakhir disimpan otomatis oleh platform.js.
import { esc, setCard } from './util.js';
import { renderIkon } from './ui.js';
import { simpanPetaSekitar, jumlahTileTersimpan, hapusPetaOffline } from './peta.js';

let lokasiKini = () => null;
let sedangUnduh = false;

const fmtMb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(0.1, b / 1e6).toFixed(1)} MB`);

async function render(pesan = '') {
  const [tile, est] = await Promise.all([jumlahTileTersimpan(), navigator.storage?.estimate?.().catch(() => null)]);
  const kini = lokasiKini();
  let terakhir = null;
  try { terakhir = JSON.parse(localStorage.getItem('woi-lokasi-terakhir')); } catch { /* abaikan */ }
  setCard('card-offline', {
    badge: tile ? `${tile} tile` : 'Belum ada',
    level: tile > 100 ? 'rendah' : '',
    summary: 'Saat bencana, sinyal sering hilang lebih dulu. Simpan peta sekitar rumah selagi ada internet.',
    detail: `
      <ul class="list">
        <li><span>Analisis terakhir</span><span class="right">${terakhir ? `${esc(terakhir.label)}<br><span class="meta">${new Date(terakhir.waktu).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>` : '—'}</span></li>
        <li><span>Tile peta tersimpan</span><span class="right">${tile}</span></li>
        ${est?.usage ? `<li><span>Penyimpanan dipakai</span><span class="right">${fmtMb(est.usage)}</span></li>` : ''}
      </ul>
      <p class="meta">Data analisis (gempa, cuaca, sesar, titik kumpul, rute) disimpan otomatis setiap kali dimuat. Bila sinyal hilang, data terakhir ditampilkan dengan keterangan waktunya.</p>
      ${kini ? `<div class="hd-aksi"><button type="button" class="btn-utama" data-offline-unduh ${sedangUnduh ? 'disabled' : ''}><i data-lucide="hard-drive-download"></i>${sedangUnduh ? 'Menyimpan…' : 'Simpan peta ±5 km di sekitar sini'}</button></div>
      <p class="meta">${esc(kini.label)} · ±300 tile (±5 MB). Pakai Wi-Fi bila bisa.</p>` : ''}
      <div class="ts-progres" data-offline-progres ${sedangUnduh ? '' : 'hidden'}><span style="width:0%"></span></div>
      <p class="meta" data-offline-pesan aria-live="polite">${esc(pesan)}</p>
      ${tile ? '<div class="hd-aksi" style="margin-top:10px"><button type="button" data-offline-hapus><i data-lucide="trash-2"></i>Hapus peta offline</button></div>' : ''}`,
  });
  renderIkon(document.getElementById('card-offline'));
}

export function pasangOffline({ lokasi }) {
  lokasiKini = lokasi;
  const card = document.getElementById('card-offline');
  card.addEventListener('click', async (e) => {
    if (e.target.closest('[data-offline-unduh]') && !sedangUnduh) {
      const kini = lokasiKini();
      if (!navigator.onLine) return render('Tidak ada koneksi internet. Coba lagi saat tersambung.');
      sedangUnduh = true;
      await render();
      const bar = card.querySelector('[data-offline-progres] span');
      const { berhasil, gagal } = await simpanPetaSekitar(kini.lat, kini.lon, 5, (n, total) => {
        if (bar?.isConnected) bar.style.width = `${Math.round((n / total) * 100)}%`;
      });
      sedangUnduh = false;
      return render(gagal ? `${berhasil} tile tersimpan, ${gagal} gagal (server peta sibuk). Coba lagi nanti untuk melengkapi.` : `✓ ${berhasil} tile tersimpan. Peta sekitar ${kini.label} bisa dibuka tanpa internet.`);
    }
    if (e.target.closest('[data-offline-hapus]') && window.confirm('Hapus semua peta offline?')) {
      await hapusPetaOffline();
      render('Peta offline dihapus.');
    }
  });
  render();
}

export const perbaruiOffline = () => { if (!sedangUnduh) render(); };
