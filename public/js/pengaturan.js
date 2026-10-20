// Pengaturan & Tentang: bahasa, tema, pemantauan (latar, siaga tinggi, bacakan peringatan), versi & pembaruan,
// serta ringkasan privasi. Pembaruan diperiksa dari GitHub Releases (aplikasi Android tidak lewat Play Store).
import { $, esc, setCard } from './util.js';
import { renderIkon } from './ui.js';
import { bahasa, aturBahasa } from './bahasa.js';
import {
  diAplikasi, versiAplikasi, pantauLatarAktif, aturPantauLatar, siagaTinggiAktif, aturSiagaTinggi,
  bebasHematBaterai, bukaPengaturanBaterai, izinNotifikasi, mintaIzinNotifikasi, bisaBicara,
} from './platform.js';

const REPO = 'fikribumn/woi';
const KUNCI_BACAKAN = 'woi-bacakan';
const KUNCI_CEK = 'woi-cek-versi';

export function bacakanOtomatis() {
  try { return localStorage.getItem(KUNCI_BACAKAN) === '1'; } catch { return false; }
}

const saklar = (data, aktif, judul, ket, nonaktif = false) => `
  <label class="pg-saklar"><input type="checkbox" ${data} ${aktif ? 'checked' : ''} ${nonaktif ? 'disabled' : ''}>
    <span><b>${judul}</b><span class="meta">${ket}</span></span></label>`;

function render(pesanVersi = '') {
  const versi = versiAplikasi();
  setCard('card-pengaturan', {
    badge: versi ? `v${versi}` : 'Web',
    level: '',
    summary: '',
    detail: `
      <h3 class="sub">Bahasa / Language</h3>
      <div class="pg-pilih" role="group" aria-label="Bahasa">
        <button type="button" data-pg-bahasa="id" aria-pressed="${bahasa() === 'id'}">Indonesia</button>
        <button type="button" data-pg-bahasa="en" aria-pressed="${bahasa() === 'en'}">English</button>
      </div>
      <p class="meta">English covers emergency screens: alerts, SOS, disaster guides, and emergency numbers.</p>

      <h3 class="sub">Tampilan</h3>
      <div class="hd-aksi"><button type="button" data-pg-tema><i data-lucide="palette"></i>Tema &amp; mode gelap</button></div>

      <h3 class="sub">Peringatan</h3>
      ${izinNotifikasi() === 'granted' ? '' : `<div class="hd-aksi" style="margin-bottom:8px"><button type="button" class="btn-utama" data-pg-notif><i data-lucide="bell-ring"></i>Izinkan notifikasi</button></div>`}
      ${diAplikasi ? saklar('data-pg-latar', pantauLatarAktif(), 'Pantau saat aplikasi ditutup', 'Cek BMKG ±15 menit sekali untuk lokasi terakhir dan lokasi tersimpan.') : ''}
      ${diAplikasi ? saklar('data-pg-siaga', siagaTinggiAktif(), 'Mode siaga tinggi', 'Cek BMKG tiap 1 menit dengan notifikasi tetap di bilah status. Untuk warga pesisir atau saat aktivitas gempa meningkat. Lebih boros baterai.') : ''}
      ${diAplikasi && !bebasHematBaterai() ? `<p class="meta">Android bisa menunda pemantauan saat hemat daya. <button type="button" class="btn-coba" data-pg-baterai><i data-lucide="battery-warning"></i>Kecualikan dari hemat baterai</button></p>` : ''}
      ${bisaBicara() ? saklar('data-pg-bacakan', bacakanOtomatis(), 'Bacakan peringatan', 'Peringatan gempa dan tsunami dibacakan dengan suara, membantu lansia atau saat panik.') : ''}

      <h3 class="sub">Tentang</h3>
      <ul class="list">
        <li><span>Versi</span><span class="right">${versi ? `${esc(versi)} (Android)` : 'Web'}</span></li>
      </ul>
      ${diAplikasi ? `<div class="hd-aksi"><button type="button" data-pg-cek><i data-lucide="refresh-cw"></i>Periksa pembaruan</button></div>
      <p class="meta" data-pg-pesan aria-live="polite">${esc(pesanVersi)}</p>` : ''}

      <h3 class="sub">Privasi</h3>
      <ul class="tips">
        <li>Tidak ada akun dan tidak ada server milik aplikasi ini. Lokasi, kontak keluarga, rencana, dan checklist <b>hanya disimpan di perangkat Anda</b>.</li>
        <li>Untuk menilai bahaya, koordinat lokasi dikirim langsung ke penyedia data publik (BMKG, Open-Meteo, OpenStreetMap, Badan Geologi, NASA FIRMS, PetaBencana.id, BNPB) dan layanan peta/rute.</li>
        <li>Pesan "Saya aman" atau SOS hanya dikirim bila Anda menekan tombolnya, lewat aplikasi pilihan Anda.</li>
      </ul>
      <p class="meta">Alat bantu informasi, bukan peringatan dini resmi. Ikuti arahan BMKG, PVMBG, BNPB, dan BPBD.</p>`,
  });
  renderIkon(document.getElementById('card-pengaturan'));
}

// ---------- Pembaruan aplikasi ----------
const angkaVersi = (v) => String(v || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
function lebihBaru(a, b) {
  const x = angkaVersi(a);
  const y = angkaVersi(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

/** Rilis terbaru di GitHub; null bila tidak terjangkau (offline, atau repositori privat). */
async function rilisTerbaru() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const j = await res.json();
  const apk = (j.assets || []).find((a) => a.name.endsWith('.apk'));
  return { versi: j.tag_name, url: apk?.browser_download_url || j.html_url, catatan: j.body || '' };
}

function tampilkanBannerVersi(r) {
  document.querySelector('.banner-versi')?.remove();
  const el = document.createElement('div');
  el.className = 'banner-versi';
  el.innerHTML = `<i data-lucide="download"></i><span>Versi baru <b>${esc(r.versi)}</b> tersedia.</span><a href="${esc(r.url)}" target="_blank" rel="noopener">Unduh</a>`;
  $('#page-home .home-head').after(el);
  renderIkon(el);
}

async function cekPembaruan({ manual = false } = {}) {
  const versi = versiAplikasi();
  if (!versi) return;
  try {
    const r = await rilisTerbaru();
    if (!r) return manual && render('Tidak bisa memeriksa pembaruan saat ini (offline, atau rilis belum dipublikasikan).');
    if (lebihBaru(r.versi, versi)) {
      tampilkanBannerVersi(r);
      if (manual) render(`Versi ${r.versi} tersedia. Lihat tombol Unduh di beranda.`);
    } else if (manual) {
      render('Anda sudah memakai versi terbaru.');
    }
  } catch {
    if (manual) render('Tidak bisa memeriksa pembaruan saat ini.');
  }
}

export function pasangPengaturan({ bukaTema }) {
  const card = document.getElementById('card-pengaturan');
  card.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pg-bahasa]');
    if (b) return aturBahasa(b.dataset.pgBahasa);
    if (e.target.closest('[data-pg-tema]')) return bukaTema();
    if (e.target.closest('[data-pg-notif]')) {
      await mintaIzinNotifikasi();
      return render();
    }
    if (e.target.closest('[data-pg-baterai]')) return bukaPengaturanBaterai();
    if (e.target.closest('[data-pg-cek]')) cekPembaruan({ manual: true });
  });
  card.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.matches('[data-pg-latar]')) aturPantauLatar(t.checked);
    if (t.matches('[data-pg-siaga]')) {
      if (t.checked && izinNotifikasi() !== 'granted') await mintaIzinNotifikasi();
      aturSiagaTinggi(t.checked);
    }
    if (t.matches('[data-pg-bacakan]')) {
      try { localStorage.setItem(KUNCI_BACAKAN, t.checked ? '1' : '0'); } catch { /* abaikan */ }
    }
    render();
  });
  // Halaman dibuka lagi (mis. setelah kembali dari pengaturan baterai Android): perbarui status
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !card.hidden) render(); });
  render();
  // Periksa pembaruan sekali sehari
  let terakhir = 0;
  try { terakhir = Number(localStorage.getItem(KUNCI_CEK)) || 0; } catch { /* abaikan */ }
  if (Date.now() - terakhir > 24 * 3600e3) {
    try { localStorage.setItem(KUNCI_CEK, String(Date.now())); } catch { /* abaikan */ }
    setTimeout(() => cekPembaruan(), 8000);
  }
}
