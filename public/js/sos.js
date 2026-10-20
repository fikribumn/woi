// Layar SOS untuk orang yang terjebak atau butuh pertolongan: peluit digital, senter & layar berkedip
// dengan pola SOS (· · · – – – · · ·), SMS "butuh bantuan" + lokasi ke semua kontak keluarga sekaligus,
// dan telepon 112. Selama terbuka, layar dijaga tetap menyala.
import { renderIkon } from './ui.js';
import { adaSenter, senter, smsKeSemua, layarTetapNyala, daftarKembali } from './platform.js';
import { nomorKeluarga, teksStatus, kabari } from './siaga.js';
import { tr } from './bahasa.js';

// Pola SOS dalam satuan 220 ms: titik 1, garis 3, jeda antarunsur 1, antarhuruf 3, antarkata 7.
const SATUAN = 220;
const POLA = (() => {
  const p = [];
  const huruf = (unsur) => unsur.forEach((u, i) => {
    p.push([true, u]);
    p.push([false, i < unsur.length - 1 ? 1 : 3]);
  });
  huruf([1, 1, 1]);
  huruf([3, 3, 3]);
  huruf([1, 1, 1]);
  p[p.length - 1][1] = 7;
  return p;
})();

let el = null;
let lepasKembali = null;
const nyala = { peluit: false, senter: false, layar: false };
let audio = null;
let langkah = 0;
let pewaktu = null;

// ---------- Peluit: nada 3 kHz (mudah terdengar, menembus reruntuhan lebih baik dari suara manusia) ----------
function siapkanAudio() {
  if (audio) return audio;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 3000;
  gain.gain.value = 0;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  audio = { ctx, gain };
  return audio;
}

function terapkan(on) {
  if (nyala.peluit) {
    const a = siapkanAudio();
    a.gain.gain.setTargetAtTime(on ? 0.6 : 0, a.ctx.currentTime, 0.005);
  }
  if (nyala.senter) senter(on);
  if (el) el.classList.toggle('sos-kedip', nyala.layar && on);
}

function detak() {
  const [on, satuan] = POLA[langkah % POLA.length];
  terapkan(on);
  langkah++;
  pewaktu = setTimeout(detak, satuan * SATUAN);
}

function aturPola() {
  const ada = nyala.peluit || nyala.senter || nyala.layar;
  if (ada && !pewaktu) {
    langkah = 0;
    detak();
  } else if (!ada && pewaktu) {
    clearTimeout(pewaktu);
    pewaktu = null;
    terapkan(false);
  }
  if (!nyala.peluit && audio) {
    audio.ctx.close();
    audio = null;
  }
  if (!nyala.senter) senter(false);
  if (!nyala.layar) el?.classList.remove('sos-kedip');
}

function renderTombol() {
  for (const [k, v] of Object.entries(nyala)) {
    const b = el.querySelector(`[data-sos="${k}"]`);
    if (b) b.setAttribute('aria-pressed', String(v));
  }
}

export function bukaSos() {
  if (el) return;
  const nomor = nomorKeluarga();
  el = document.createElement('div');
  el.className = 'sos-layar';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'sos-judul');
  el.innerHTML = `
    <div class="sos-isi">
      <div class="sos-kepala">
        <h2 id="sos-judul">SOS</h2>
        <button type="button" class="sos-tutup" data-sos-tutup aria-label="${tr('Tutup', 'Close')}"><i data-lucide="x"></i></button>
      </div>
      <p class="sos-sub">${tr('Terjebak atau butuh pertolongan? Beri tanda agar penolong menemukan Anda.', 'Trapped or need help? Signal so rescuers can find you.')}</p>
      <div class="sos-grid">
        <button type="button" data-sos="peluit" aria-pressed="false"><i data-lucide="megaphone"></i><b>${tr('Peluit', 'Whistle')}</b><span>${tr('Bunyi SOS keras', 'Loud SOS sound')}</span></button>
        ${adaSenter() ? `<button type="button" data-sos="senter" aria-pressed="false"><i data-lucide="flashlight"></i><b>${tr('Senter', 'Flashlight')}</b><span>${tr('Berkedip pola SOS', 'Blinks SOS')}</span></button>` : ''}
        <button type="button" data-sos="layar" aria-pressed="false"><i data-lucide="sun"></i><b>${tr('Layar', 'Screen')}</b><span>${tr('Berkedip terang', 'Bright flashing')}</span></button>
      </div>
      <a class="sos-112" href="tel:112"><i data-lucide="phone-call"></i>${tr('Telepon 112', 'Call 112')}</a>
      ${nomor.length
    ? `<button type="button" class="sos-sms" data-sos-sms><i data-lucide="message-square-warning"></i>${tr(`SMS "butuh bantuan" ke ${nomor.length} kontak keluarga`, `Text "need help" to ${nomor.length} family contacts`)}</button>`
    : `<p class="sos-catatan">${tr('Belum ada kontak keluarga. Tambahkan di Kontak Darurat agar bisa mengirim SMS sekaligus.', 'No family contacts yet. Add them under Emergency Contacts to text them all at once.')}</p>`}
      <button type="button" class="sos-bagikan" data-sos-bagikan><i data-lucide="share-2"></i>${tr('Bagikan lokasi saya', 'Share my location')}</button>
      <ul class="sos-tips">
        <li>${tr('Tidak bisa bersuara? <b>Ketuk pipa atau dinding 3 kali</b>, ulangi berkala.', 'Can\'t shout? <b>Tap a pipe or wall 3 times</b>, repeat regularly.')}</li>
        <li>${tr('Tutup hidung & mulut dengan kain bila berdebu. Jangan menyalakan api.', 'Cover nose & mouth with cloth if dusty. Do not light a flame.')}</li>
        <li>${tr('Hemat baterai: kecilkan kecerahan, matikan aplikasi lain.', 'Save battery: lower brightness, close other apps.')}</li>
      </ul>
    </div>`;
  document.body.append(el);
  renderIkon(el);
  layarTetapNyala(true);
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-sos]');
    if (t) {
      nyala[t.dataset.sos] = !nyala[t.dataset.sos];
      renderTombol();
      aturPola();
      return;
    }
    if (e.target.closest('[data-sos-tutup]')) return tutupSos();
    if (e.target.closest('[data-sos-sms]')) {
      const { isi, tautan } = teksStatus('tolong');
      return smsKeSemua(nomor, `${isi} ${tautan}`.trim());
    }
    const bagi = e.target.closest('[data-sos-bagikan]');
    if (bagi) kabari('tolong', bagi);
  });
  lepasKembali = daftarKembali(() => {
    if (!el) return false;
    tutupSos();
    return true;
  });
  el.querySelector('[data-sos="peluit"]').focus();
}

export function tutupSos() {
  if (!el) return;
  for (const k of Object.keys(nyala)) nyala[k] = false;
  aturPola();
  layarTetapNyala(false);
  el.remove();
  el = null;
  lepasKembali?.();
}
