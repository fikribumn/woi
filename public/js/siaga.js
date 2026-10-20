// Kesiapsiagaan: kontak darurat (telepon langsung), kabari keluarga (status + lokasi, juga lewat SMS
// yang tetap jalan tanpa internet), dan checklist Tas Siaga Bencana. Semua data pribadi hanya disimpan
// di perangkat (localStorage).
import { $, esc, fmtKm, setCard } from './util.js';
import { renderIkon } from './ui.js';
import { bagikan, smsKeSemua } from './platform.js';
import { tr } from './bahasa.js';

// Nomor layanan darurat nasional (bebas pulsa, bisa dari HP tanpa kartu SIM untuk 112).
const LAYANAN = [
  { no: '112', nama: ['Darurat', 'Emergency'], ket: ['Semua keadaan darurat', 'Any emergency'], ikon: 'siren', warna: 'var(--red)' },
  { no: '119', nama: ['Ambulans', 'Ambulance'], ket: ['Gawat darurat medis (PSC)', 'Medical emergency'], ikon: 'ambulance', warna: 'var(--red)' },
  { no: '113', nama: ['Pemadam', 'Fire'], ket: ['Kebakaran & penyelamatan', 'Fire & rescue'], ikon: 'flame', warna: 'var(--orange)' },
  { no: '110', nama: ['Polisi', 'Police'], ket: ['Keamanan & kecelakaan', 'Security & accidents'], ikon: 'shield', warna: 'var(--blue)' },
  { no: '115', nama: ['Basarnas', 'SAR'], ket: ['Pencarian & pertolongan (SAR)', 'Search and rescue'], ikon: 'life-buoy', warna: 'var(--teal)' },
  { no: '117', nama: ['BNPB', 'BNPB'], ket: ['Informasi & laporan bencana', 'Disaster information'], ikon: 'megaphone', warna: 'var(--indigo)' },
  { no: '123', nama: ['PLN', 'PLN'], ket: ['Kabel listrik putus / gangguan', 'Fallen power lines'], ikon: 'zap', warna: 'var(--yellow)' },
];

// Isi Tas Siaga Bencana mengikuti panduan BNPB, untuk bertahan ±3 hari.
const TAS = [
  { grup: 'Dokumen & uang', item: [
    ['dok', 'Fotokopi KTP, KK, akta, ijazah, polis', 'Masukkan ke plastik kedap air'],
    ['uang', 'Uang tunai secukupnya', 'ATM & dompet digital bisa mati saat listrik padam'],
  ] },
  { grup: 'Air & makanan', item: [
    ['air', 'Air minum 3 hari', '±3 liter per orang per hari'],
    ['makan', 'Makanan tahan lama', 'Biskuit, roti kering, makanan kaleng + pembukanya'],
  ] },
  { grup: 'Kesehatan', item: [
    ['p3k', 'Kotak P3K', 'Plester, perban, antiseptik, kasa'],
    ['obat', 'Obat pribadi untuk 1 minggu', 'Bawa juga salinan resep'],
    ['masker', 'Masker', 'Untuk abu vulkanik, asap, dan debu reruntuhan'],
    ['bersih', 'Perlengkapan kebersihan', 'Sabun, sikat gigi, pembalut, tisu basah'],
  ] },
  { grup: 'Pakaian', item: [
    ['baju', 'Pakaian ganti 3 hari', 'Termasuk jaket atau jas hujan'],
    ['selimut', 'Selimut atau sleeping bag', ''],
    ['sepatu', 'Alas kaki yang kuat', 'Lindungi kaki dari pecahan kaca dan puing'],
  ] },
  { grup: 'Alat', item: [
    ['senter', 'Senter + baterai cadangan', ''],
    ['peluit', 'Peluit', 'Memberi tanda bila terjebak, lebih hemat tenaga dari berteriak'],
    ['pisau', 'Pisau lipat / multitool', ''],
    ['korek', 'Korek api atau pemantik', 'Simpan di wadah kedap air'],
  ] },
  { grup: 'Komunikasi', item: [
    ['pb', 'Power bank terisi + kabel', ''],
    ['radio', 'Radio kecil bertenaga baterai', 'Untuk siaran resmi saat internet putus'],
    ['nomor', 'Nomor penting ditulis di kertas', 'HP bisa mati atau hilang'],
  ] },
];
const SEMUA_ITEM = TAS.flatMap((g) => g.item.map(([id]) => id));
const ENAM_BULAN = 182 * 24 * 3600e3;

// ---------- Penyimpanan lokal ----------
function baca(kunci, awal) {
  try { return JSON.parse(localStorage.getItem(kunci)) ?? awal; } catch { return awal; }
}
function tulis(kunci, nilai) {
  try { localStorage.setItem(kunci, JSON.stringify(nilai)); } catch { /* berlaku sampai muat ulang */ }
}

let lokasiKini = () => null; // { lat, lon, label }
let faskes = [];

const telp = (no) => `tel:${encodeURIComponent(no)}`;
const nomorBersih = (s) => String(s || '').replace(/[^\d+]/g, '');

// ---------- Kabari keluarga ----------
function teksStatus(jenis) {
  const l = lokasiKini();
  const jam = new Date().toLocaleString('id-ID', { weekday: 'long', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
  const tautan = l ? `https://maps.google.com/?q=${l.lat.toFixed(5)},${l.lon.toFixed(5)}` : '';
  const isi = jenis === 'aman'
    ? tr(`Saya AMAN. ${l?.label ? `Posisi saya di sekitar ${l.label}.` : ''} (${jam})`, `I am SAFE. ${l?.label ? `I am near ${l.label}.` : ''} (${jam})`)
    : tr(`Saya BUTUH BANTUAN. ${l?.label ? `Posisi saya di sekitar ${l.label}.` : ''} Mohon hubungi saya atau 112. (${jam})`, `I NEED HELP. ${l?.label ? `I am near ${l.label}.` : ''} Please contact me or call 112. (${jam})`);
  return { isi: isi.replace(/\s+/g, ' ').trim(), tautan };
}

async function kabari(jenis, tombol) {
  const { isi, tautan } = teksStatus(jenis);
  const hasil = await bagikan({ judul: jenis === 'aman' ? 'Saya aman' : 'Butuh bantuan', teks: isi, url: tautan });
  if (hasil === 'disalin' && tombol) {
    const asal = tombol.innerHTML;
    tombol.textContent = 'Tersalin ke papan klip';
    setTimeout(() => { tombol.innerHTML = asal; renderIkon(tombol); }, 2000);
  }
}

/** Tautan SMS berisi status; SMS tetap terkirim walau data internet putus. */
function tautanSms(no, jenis) {
  const { isi, tautan } = teksStatus(jenis);
  return `sms:${nomorBersih(no)}?body=${encodeURIComponent(`${isi} ${tautan}`.trim())}`;
}

// ---------- Halaman Kontak Darurat ----------
function renderKontak() {
  const keluarga = baca('woi-keluarga', []);
  const card = document.getElementById('card-kontak');
  setCard('card-kontak', {
    badge: keluarga.length ? `${keluarga.length} keluarga` : '112',
    level: '',
    summary: tr('Ketuk untuk menelepon. Nomor darurat bebas pulsa; <b>112</b> bisa dihubungi walau pulsa habis.', 'Tap to call. Emergency numbers are free; <b>112</b> works even without credit.'),
    detail: `
      <div class="kd-grid">${LAYANAN.map((k) => `
        <a class="kd-tombol" href="${telp(k.no)}" style="--c:${k.warna}" aria-label="${tr('Telepon', 'Call')} ${esc(tr(...k.nama))} ${k.no}">
          <span class="row-ikon">${`<i data-lucide="${k.ikon}"></i>`}</span>
          <span class="kd-no">${k.no}</span><span class="kd-nama">${esc(tr(...k.nama))}</span><span class="kd-ket">${esc(tr(...k.ket))}</span>
        </a>`).join('')}
      </div>

      <button type="button" class="sos-112 kd-sos" data-kd-sos><i data-lucide="siren"></i>${tr('SOS: saya terjebak', 'SOS: I am trapped')}</button>

      <h3 class="sub">${tr('Kabari keluarga', 'Tell your family')}</h3>
      <p class="meta">${tr('Kirim status dan tautan lokasi lewat WhatsApp, SMS, atau aplikasi lain.', 'Send your status and location link via WhatsApp, SMS, or another app.')}</p>
      <div class="hd-aksi kd-kabar">
        <button type="button" class="btn-utama kd-aman" data-kabar="aman"><i data-lucide="heart-handshake"></i>${tr('Saya aman', "I'm safe")}</button>
        <button type="button" class="kd-tolong" data-kabar="tolong"><i data-lucide="hand-helping"></i>${tr('Butuh bantuan', 'Need help')}</button>
      </div>
      ${keluarga.length > 1 ? `<div class="hd-aksi" style="margin-top:8px"><button type="button" data-sms-semua="aman" style="flex:1"><i data-lucide="message-square-text"></i>${tr(`SMS "saya aman" ke ${keluarga.length} kontak sekaligus`, `Text "I'm safe" to all ${keluarga.length} contacts`)}</button></div>` : ''}

      <h3 class="sub">${tr('Kontak keluarga', 'Family contacts')}</h3>
      ${keluarga.length ? `<ul class="list kd-keluarga">${keluarga.map((k, i) => `
        <li>
          <div><b>${esc(k.nama)}</b><div class="meta">${esc(k.no)}</div></div>
          <div class="kd-aksi">
            <a href="${telp(nomorBersih(k.no))}" aria-label="Telepon ${esc(k.nama)}"><i data-lucide="phone"></i></a>
            <a href="${tautanSms(k.no, 'aman')}" aria-label="SMS 'saya aman' ke ${esc(k.nama)}"><i data-lucide="message-square-text"></i></a>
            <button type="button" data-hapus="${i}" aria-label="Hapus ${esc(k.nama)}"><i data-lucide="trash-2"></i></button>
          </div>
        </li>`).join('')}</ul>
        <p class="meta">Tombol pesan membuka SMS berisi "Saya aman" + lokasi. SMS tetap terkirim walau internet putus.</p>`
        : '<p class="meta">Simpan nomor keluarga agar bisa ditelepon atau dikirimi SMS dengan sekali ketuk. Disimpan hanya di perangkat ini.</p>'}
      <form class="kd-form" data-form-keluarga>
        <input name="nama" required maxlength="40" placeholder="Nama (mis. Ibu)" autocomplete="off" aria-label="Nama kontak">
        <input name="no" required type="tel" inputmode="tel" maxlength="20" placeholder="Nomor HP" autocomplete="off" aria-label="Nomor HP">
        <button type="submit" aria-label="Tambah kontak"><i data-lucide="user-plus"></i></button>
      </form>

      ${faskes.length ? `<h3 class="sub">Fasilitas terdekat</h3>
      <ul class="list">${faskes.slice(0, 5).map((f) => {
        const jenis = { hospital: 'Rumah sakit', fire_station: 'Pemadam kebakaran', police: 'Kantor polisi' }[f.tags.amenity] || 'Fasilitas';
        const no = nomorBersih(f.tags.phone || f.tags['contact:phone'] || '');
        return `<li><div><b>${esc(f.nama || jenis)}</b><div class="meta">${jenis} · ${fmtKm(f.jarak)}</div></div>
          <div class="kd-aksi">${no ? `<a href="${telp(no)}" aria-label="Telepon ${esc(f.nama || jenis)}"><i data-lucide="phone"></i></a>` : ''}
          <a href="https://www.google.com/maps/dir/?api=1&destination=${f.lat.toFixed(6)},${f.lon.toFixed(6)}" target="_blank" rel="noopener" aria-label="Rute ke ${esc(f.nama || jenis)}"><i data-lucide="navigation"></i></a></div></li>`;
      }).join('')}</ul>` : ''}`,
  });
  renderIkon(card);
}

function pasangKontak() {
  const card = document.getElementById('card-kontak');
  card.addEventListener('click', (e) => {
    const k = e.target.closest('[data-kabar]');
    if (k) return kabari(k.dataset.kabar, k);
    const m = e.target.closest('[data-sms-semua]');
    if (m) {
      const { isi, tautan } = teksStatus(m.dataset.smsSemua);
      return smsKeSemua(nomorKeluarga(), `${isi} ${tautan}`.trim());
    }
    if (e.target.closest('[data-kd-sos]')) return window.woiAksi('sos');
    const h = e.target.closest('[data-hapus]');
    if (h) {
      const daftar = baca('woi-keluarga', []);
      const item = daftar[+h.dataset.hapus];
      if (item && window.confirm(`Hapus ${item.nama} dari kontak keluarga?`)) {
        daftar.splice(+h.dataset.hapus, 1);
        tulis('woi-keluarga', daftar);
        renderKontak();
      }
    }
  });
  card.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-form-keluarga]');
    if (!f) return;
    e.preventDefault();
    const nama = f.nama.value.trim();
    const no = f.no.value.trim();
    if (!nama || nomorBersih(no).length < 5) return;
    tulis('woi-keluarga', [...baca('woi-keluarga', []), { nama, no }].slice(0, 10));
    renderKontak();
  });
}

// ---------- Halaman Tas Siaga ----------
function statusTas() {
  const cek = baca('woi-tas', {});
  const siap = SEMUA_ITEM.filter((id) => cek[id]).length;
  const diperiksa = baca('woi-tas-waktu', null);
  const usang = diperiksa && Date.now() - diperiksa > ENAM_BULAN;
  return { cek, siap, total: SEMUA_ITEM.length, diperiksa, usang };
}

function renderTas() {
  const { cek, siap, total, diperiksa, usang } = statusTas();
  const persen = Math.round((siap / total) * 100);
  const level = usang ? 'sedang' : siap === total ? 'rendah' : siap >= total / 2 ? 'sedang' : 'tinggi';
  const card = document.getElementById('card-tas');
  setCard('card-tas', {
    badge: usang ? 'Periksa ulang' : `${siap}/${total} siap`,
    level: siap ? level : '',
    summary: usang
      ? 'Sudah lebih dari 6 bulan sejak tas terakhir diperiksa. Ganti air, makanan, obat, dan baterai yang kedaluwarsa.'
      : siap === total
        ? 'Tas siaga lengkap. Simpan di dekat pintu keluar dan periksa ulang tiap 6 bulan.'
        : 'Siapkan satu tas per keluarga yang mudah dibawa lari. Centang barang yang sudah ada di tas.',
    detail: `
      <div class="ts-progres" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${siap}" aria-label="Kelengkapan tas siaga">
        <span style="width:${persen}%"></span>
      </div>
      <p class="meta ts-info">${persen}% lengkap${diperiksa ? ` · terakhir diperiksa ${new Date(diperiksa).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}</p>
      ${TAS.map((g) => `
        <h3 class="sub">${esc(g.grup)}</h3>
        <ul class="list ts-list">${g.item.map(([id, nama, ket]) => `
          <li><label><input type="checkbox" data-tas="${id}" ${cek[id] ? 'checked' : ''}>
            <span><span class="ts-nama">${esc(nama)}</span>${ket ? `<span class="meta">${esc(ket)}</span>` : ''}</span></label></li>`).join('')}
        </ul>`).join('')}
      <div class="hd-aksi" style="margin-top:14px"><button type="button" data-tas-periksa><i data-lucide="calendar-check"></i>Tandai sudah diperiksa hari ini</button></div>
      <ul class="tips">
        <li>Sepakati <b>titik kumpul keluarga</b> bila terpisah saat bencana.</li>
        <li>Tambahkan kebutuhan khusus: bayi, lansia, penyandang disabilitas, hewan peliharaan.</li>
        <li>Letakkan tas di tempat yang mudah dijangkau, dekat pintu keluar.</li>
      </ul>`,
  });
  renderIkon(card);
}

function pasangTas() {
  const card = document.getElementById('card-tas');
  card.addEventListener('change', (e) => {
    const c = e.target.closest('[data-tas]');
    if (!c) return;
    const cek = baca('woi-tas', {});
    cek[c.dataset.tas] = c.checked;
    tulis('woi-tas', cek);
    if (!baca('woi-tas-waktu', null)) tulis('woi-tas-waktu', Date.now());
    const scroll = $('#sheet-scroll').scrollTop;
    renderTas();
    $('#sheet-scroll').scrollTop = scroll;
  });
  card.addEventListener('click', (e) => {
    if (!e.target.closest('[data-tas-periksa]')) return;
    tulis('woi-tas-waktu', Date.now());
    renderTas();
  });
}

/** Dipanggil main.js sekali. lokasi() mengembalikan lokasi yang sedang dianalisis. */
export function pasangSiaga({ lokasi }) {
  lokasiKini = lokasi;
  pasangKontak();
  pasangTas();
  renderKontak();
  renderTas();
}

/** Dipanggil setelah data OSM lokasi baru siap: daftar RS, pemadam, polisi terdekat. */
export function aturFaskes(osm) {
  faskes = osm?.faskes || [];
  renderKontak();
}

/** Nomor HP semua kontak keluarga (untuk SMS sekaligus). */
export const nomorKeluarga = () => baca('woi-keluarga', []).map((k) => nomorBersih(k.no)).filter((n) => n.length >= 5);

export { kabari, teksStatus };
