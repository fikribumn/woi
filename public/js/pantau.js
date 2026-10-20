// Pemantauan live: cek BMKG berkala, nilai dampak tiap gempa baru terhadap lokasi pengguna
// (perkiraan guncangan MMI, potensi tsunami untuk lokasi pesisir), lalu bunyikan peringatan
// dan arahkan ke langkah evakuasi. Ada mode simulasi untuk demo/latihan, selalu diberi label jelas.
import { $, esc, jarakKm, arahKe, fmtKm, getJson, waktuRelatif } from './util.js';
import { perkiraanMMI, labelMMI, parseBmkg } from './gempa.js';
import { map, ikonTitik } from './peta.js';
import { renderIkon, bukaHalaman } from './ui.js';
import { infoPosisi, saranPosisi } from './posisi.js';
import { kabari } from './siaga.js';
import { tr, bahasa } from './bahasa.js';
import { bacakanOtomatis } from './pengaturan.js';
import { daftarLokasiTersimpan } from './lokasi.js';
import { izinNotifikasi, mintaIzinNotifikasi, notifikasi as kirimNotifikasi, layarTetapNyala, pantauLatarAktif, aturPantauLatar, diAplikasi, bicara, hentikanBicara, bisaBicara } from './platform.js';

const L = window.L;
const INTERVAL = 30000;
const UMUR_MAKS = 60 * 60e3; // gempa lebih tua dari 1 jam tidak memicu peringatan
const KUNCI = 'pantau-sudah';
const SUMBER = {
  auto: 'https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json',
  dirasakan: 'https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json',
};

let lokasi = null; // { lat, lon, label, pesisir, sub, tinggiAman }
let api = null; // { jalankanDarurat }
let status = { cek: null, galat: null, terakhir: null };
let berjalan = false;
let peringatanAktif = null;
const lapisanLive = L.layerGroup().addTo(map);

// ---------- Penyimpanan kejadian yang sudah diperingatkan ----------
function sudahDilihat() {
  try { return new Set(JSON.parse(localStorage.getItem(KUNCI) || '[]')); } catch { return new Set(); }
}
function tandaiDilihat(id) {
  const s = [...sudahDilihat(), id].slice(-50);
  try { localStorage.setItem(KUNCI, JSON.stringify(s)); } catch { /* cukup di sesi ini */ }
}
const idKejadian = (g) => `${g.waktu}|${g.lat.toFixed(2)}|${g.lon.toFixed(2)}`;

// ---------- Penilaian dampak ----------
const berpotensiTsunami = (g) => /tsunami/i.test(g.potensi || '') && !/tidak/i.test(g.potensi || '');

/** Dampak satu gempa di satu lokasi (bawaan: lokasi yang dianalisis). level: 'bahaya' | 'waspada' | 'info' | null. */
function nilaiDampak(g, l = lokasi) {
  const jarak = jarakKm(l.lat, l.lon, g.lat, g.lon);
  const mmi = perkiraanMMI(g.mag, Math.sqrt(jarak ** 2 + (g.kedalaman || 10) ** 2));
  const tsunami = berpotensiTsunami(g) && l.pesisir && jarak <= 600;
  let level = null;
  if (tsunami || mmi >= 6) level = 'bahaya';
  else if (mmi >= 4) level = 'waspada';
  else if (mmi >= 3) level = 'info';
  // Gelombang ±8 km/menit (480 km/jam) dari episenter; dihitung sejak waktu gempa
  const tiba = tsunami ? g.waktu + (Math.max(10, jarak / 8)) * 60e3 : null;
  return { ...g, jarak, mmi, tsunami, level, tiba, jenis: tsunami ? 'tsunami' : 'gempa', l, lain: l !== lokasi };
}

const URUT_LEVEL = { bahaya: 3, waspada: 2, info: 1 };
/** Dampak terberat di antara lokasi yang dianalisis dan semua lokasi tersimpan; lokasi kini didahulukan bila setara. */
function dampakTerberat(g) {
  const lain = daftarLokasiTersimpan()
    .filter((t) => jarakKm(t.lat, t.lon, lokasi.lat, lokasi.lon) > 0.05)
    .map((t) => ({ lat: t.lat, lon: t.lon, label: t.nama, pesisir: !!t.pesisir, tinggiAman: 20 }));
  return [lokasi, ...lain].map((l) => nilaiDampak(g, l))
    .reduce((a, b) => ((URUT_LEVEL[b.level] || 0) > (URUT_LEVEL[a.level] || 0) ? b : a));
}

// ---------- Pengecekan berkala ----------
async function cek() {
  if (!lokasi) return;
  try {
    const [auto, dirasakan] = await Promise.allSettled([getJson(SUMBER.auto, { timeout: 15000, cache: 'no-store' }), getJson(SUMBER.dirasakan, { timeout: 15000, cache: 'no-store' })]);
    if (auto.status === 'rejected' && dirasakan.status === 'rejected') throw auto.reason;
    const daftar = [
      ...(auto.status === 'fulfilled' ? parseBmkg([auto.value.Infogempa.gempa], 'BMKG') : []),
      ...(dirasakan.status === 'fulfilled' ? parseBmkg(dirasakan.value.Infogempa.gempa, 'BMKG') : []),
    ].filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.mag));
    status = { ...status, cek: Date.now(), galat: null };
    const dilihat = sudahDilihat();
    const baru = daftar
      .filter((g) => Date.now() - g.waktu < UMUR_MAKS && !dilihat.has(idKejadian(g)))
      .map(dampakTerberat)
      .filter((d) => d.level)
      .sort((a, b) => (a.level === 'bahaya' ? 0 : 1) - (b.level === 'bahaya' ? 0 : 1) || b.waktu - a.waktu);
    // Gempa terbaru di sekitar (untuk status), terlepas dari sudah diperingatkan atau belum
    status.terakhir = daftar.map((g) => nilaiDampak(g)).filter((d) => d.jarak <= 500).sort((a, b) => b.waktu - a.waktu)[0] || null;
    for (const d of baru) tandaiDilihat(idKejadian(d));
    if (baru[0]) peringatkan(baru[0]);
  } catch (err) {
    status = { ...status, cek: Date.now(), galat: err.message };
  }
  renderPil();
}

/** Dipanggil main.js sekali saat aplikasi dimuat. */
export function mulaiPantau(opsi) {
  api = opsi;
  pasangPil();
  if (!berjalan) {
    berjalan = true;
    setInterval(cek, INTERVAL);
  }
}

/** Dipanggil main.js setiap analisis lokasi selesai. */
export function aturLokasiPantau(l) {
  const baru = !lokasi || jarakKm(lokasi.lat, lokasi.lon, l.lat, l.lon) > 0.05;
  lokasi = l;
  if (baru) cek();
  // ?demo=gempa|tsunami: jalankan simulasi sekali setelah analisis pertama
  if (demo) {
    simulasi(demo);
    demo = null;
  }
}
// Dibaca saat modul dimuat, karena setLokasi() menulis ulang URL tanpa parameter ini.
let demo = new URLSearchParams(location.search).get('demo');

// ---------- Simulasi (demo / latihan) ----------
export function simulasi(jenis) {
  if (!lokasi) return;
  const sekarang = Date.now() - 40e3; // seolah terjadi 40 detik lalu
  let g;
  if (jenis === 'tsunami') {
    // Gempa besar di zona subduksi terdekat (atau 150 km ke arah laut bila tidak diketahui)
    const titik = lokasi.sub?.titik || [lokasi.lat - 1.2, lokasi.lon - 0.6];
    g = { waktu: sekarang, lat: titik[0], lon: titik[1], mag: 7.8, kedalaman: 20, tempat: 'SIMULASI: zona subduksi lepas pantai', potensi: 'Berpotensi tsunami', sumber: 'Simulasi' };
  } else {
    // Gempa dangkal ±35 km barat daya lokasi
    g = { waktu: sekarang, lat: lokasi.lat - 0.22, lon: lokasi.lon - 0.22, mag: 6.3, kedalaman: 12, tempat: 'SIMULASI: darat, barat daya lokasi', potensi: 'Tidak berpotensi tsunami', sumber: 'Simulasi' };
  }
  const d = nilaiDampak(g);
  peringatkan({ ...d, level: d.level || 'info', simulasi: true, diminta: jenis });
}

// ---------- Peringatan ----------
let audio = null;
function sirene(nyala) {
  try {
    if (!nyala) {
      audio?.ctx.close();
      audio = null;
      return;
    }
    if (audio) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 850;
    lfo.frequency.value = 1.2; // naik-turun seperti sirene
    lfoGain.gain.value = 300;
    lfo.connect(lfoGain).connect(osc.frequency);
    gain.gain.value = 0.12;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    lfo.start();
    audio = { ctx };
  } catch { /* audio tidak tersedia */ }
}

function notifikasi(d, judul) {
  kirimNotifikasi(`${d.simulasi ? '[SIMULASI] ' : ''}${judul}`, `${d.tempat} · ${fmtKm(d.jarak)} dari ${d.lain ? d.l.label : 'lokasi Anda'}`, { tag: idKejadian(d), penting: d.level === 'bahaya' });
}

function langkah(d) {
  if (d.tsunami) {
    const sp = d.lain ? null : saranPosisi('tsunami', { tinggiAman: d.l.tinggiAman });
    const tinggi = d.l.tinggiAman || 20;
    return [
      sp?.tetapDiAtas
        ? tr(`<b>${sp.judul}</b>. Jangan turun ke jalan selama gedung tidak rusak berat.`, '<b>Stay where you are, up high.</b> Do not go down to the street unless the building is badly damaged.')
        : tr(`<b>Segera menjauhi pantai</b> ke tanah setinggi ≥ ${tinggi} m, jalan kaki atau motor.`, `<b>Move away from the beach now</b> to ground at least ${tinggi} m high, on foot or motorbike.`),
      tr('Tidak sempat? Naik ke <b>lantai 3 atau lebih</b> gedung beton yang kokoh.', 'No time? Climb to the <b>3rd floor or higher</b> of a sturdy concrete building.'),
      tr('Jangan menunggu sirene atau melihat air laut. Jangan kembali sampai BMKG menyatakan ancaman berakhir.', 'Do not wait for sirens or go to look at the sea. Do not return until BMKG declares the threat over.'),
    ];
  }
  const p = infoPosisi();
  const tinggi = p?.sumber && p.min >= 3;
  const r = [
    tr('<b>Bila masih bergoyang: merunduk, lindungi kepala, bertahan</b> di bawah meja kokoh. Jauhi kaca.', '<b>If still shaking: drop, cover, and hold on</b> under a sturdy table. Stay away from glass.'),
    tinggi
      ? tr('Setelah berhenti: <b>jangan pakai lift</b>. Ikuti arahan pengelola gedung; turun lewat tangga bila ada api, gas, atau kerusakan.', 'When it stops: <b>do not use elevators</b>. Follow building staff; take the stairs down if there is fire, gas, or damage.')
      : tr('Setelah berhenti: keluar dengan tenang ke ruang terbuka, pakai alas kaki, jangan pakai lift.', 'When it stops: go calmly to an open area, wear shoes, do not use elevators.'),
    tr('Waspadai <b>gempa susulan</b>. Jangan masuk ke bangunan yang retak.', 'Expect <b>aftershocks</b>. Do not enter cracked buildings.'),
  ];
  if (d.diminta === 'tsunami') r.unshift(tr('Lokasi Anda <b>tidak di pesisir rendah</b>, jadi tidak perlu evakuasi tsunami. Coba simulasi ini di kota pesisir, mis. Padang.', 'Your location is <b>not on a low-lying coast</b>, so no tsunami evacuation is needed. Try this simulation in a coastal city such as Padang.'));
  else if (d.l.pesisir) r.push(tr('BMKG: tidak berpotensi tsunami. Tetapi bila guncangan sangat kuat atau lama (&gt; 20 detik), tetap menjauh dari pantai.', 'BMKG: no tsunami potential. But if the shaking was very strong or long (&gt; 20 s), still move away from the beach.'));
  return r;
}

function hitungMundur(el, tiba) {
  const tick = () => {
    if (!el.isConnected) return;
    const s = Math.round((tiba - Date.now()) / 1000);
    const waktu = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    el.innerHTML = s > 0
      ? tr(`Perkiraan gelombang tiba <b>±${waktu}</b> menit lagi`, `Waves may arrive in about <b>${waktu}</b> minutes`)
      : tr('<b>Gelombang bisa tiba kapan saja</b>', '<b>Waves may arrive at any moment</b>');
    setTimeout(tick, 1000);
  };
  tick();
}

const polos = (html) => html.replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

function peringatkan(d) {
  tutupPeringatan();
  peringatanAktif = d;
  const judul = d.tsunami ? tr('POTENSI TSUNAMI', 'TSUNAMI THREAT')
    : d.level === 'bahaya' ? tr('GEMPA KUAT', 'STRONG EARTHQUAKE')
      : d.level === 'waspada' ? tr('GEMPA TERASA', 'EARTHQUAKE FELT') : tr('GEMPA TERCATAT', 'EARTHQUAKE RECORDED');
  const tempat = d.lain ? esc(d.l.label) : tr('lokasi Anda', 'your location');
  const kalimat = d.tsunami
    ? tr(`Gempa M${d.mag.toFixed(1)} berpotensi tsunami. ${d.lain ? `${tempat} berada` : 'Lokasi Anda'} di pesisir.`, `M${d.mag.toFixed(1)} earthquake may cause a tsunami. ${d.lain ? tempat : 'You are'} on the coast.`)
    : tr(`Gempa M${d.mag.toFixed(1)} diperkirakan ${d.mmi >= 5 ? 'terasa kuat' : 'terasa'} di ${tempat}.`, `M${d.mag.toFixed(1)} earthquake likely ${d.mmi >= 5 ? 'felt strongly' : 'felt'} at ${tempat}.`);
  const jam = new Date(d.waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const daftarLangkah = langkah(d);
  const el = document.createElement('div');
  el.className = 'lv-overlay';
  el.dataset.level = d.level;
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-labelledby', 'lv-judul');
  el.innerHTML = `
    <div class="lv-kartu">
      ${d.simulasi ? `<div class="lv-simulasi">${tr('SIMULASI · bukan kejadian nyata', 'SIMULATION · not a real event')}</div>` : ''}
      <div class="lv-kepala"><span class="lv-ikon"><i data-lucide="${d.tsunami ? 'waves' : 'activity'}"></i></span><span>${judul}</span></div>
      <h2 id="lv-judul">${kalimat}</h2>
      <p class="lv-meta">${jam} · ${waktuRelatif(d.waktu)} · ${esc(d.tempat)}<br>${fmtKm(d.jarak)} ${tr('arah', 'to the')} ${arahKe(d.l.lat, d.l.lon, d.lat, d.lon)} ${tr('dari', 'of')} ${tempat} · ${tr('kedalaman', 'depth')} ${Math.round(d.kedalaman)} km · ${esc(d.sumber)}</p>
      <div class="lv-angka">
        <div><b>M${d.mag.toFixed(1)}</b><span>${tr('magnitudo', 'magnitude')}</span></div>
        <div><b>${labelMMI(d.mmi).split(' ')[0]}</b><span>${tr('perkiraan guncangan (MMI)', 'estimated shaking (MMI)')}</span></div>
        <div><b>${d.tsunami ? tr('Ya', 'Yes') : tr('Tidak', 'No')}</b><span>${tr('potensi tsunami', 'tsunami threat')}</span></div>
      </div>
      ${d.tsunami ? '<p class="lv-hitung" data-hitung></p>' : `<p class="lv-mmi">${labelMMI(d.mmi)}</p>`}
      <ol class="lv-langkah">${daftarLangkah.map((x) => `<li>${x}</li>`).join('')}</ol>
      <div class="lv-aksi">
        <button type="button" class="lv-utama" data-lv-evakuasi>${d.lain ? tr(`Hubungi keluarga di ${tempat}`, `Contact family at ${tempat}`) : d.tsunami ? tr('Rute ke tempat tinggi', 'Route to high ground') : tr('Langkah & rute evakuasi', 'Steps & evacuation route')}</button>
        <button type="button" data-lv-aman>${tr('Saya aman', "I'm safe")}</button>
        <button type="button" data-lv-kabar aria-label="${tr('Kabari keluarga', 'Tell family')}"><i data-lucide="share-2"></i></button>
        ${bisaBicara() ? `<button type="button" data-lv-bacakan aria-label="${tr('Bacakan', 'Read aloud')}"><i data-lucide="volume-2"></i></button>` : ''}
        <button type="button" data-lv-senyap aria-label="${tr('Matikan suara', 'Mute')}"><i data-lucide="volume-x"></i></button>
      </div>
      <p class="lv-sumber">${tr(`Sumber: ${d.simulasi ? 'simulasi untuk latihan' : 'BMKG'}. Perkiraan guncangan dihitung dari magnitudo & jarak. Ikuti arahan resmi BMKG dan BPBD. Darurat: 112.`, `Source: ${d.simulasi ? 'practice simulation' : 'BMKG'}. Shaking is estimated from magnitude & distance. Follow official BMKG and local authority instructions. Emergency: 112.`)}</p>
    </div>`;
  const bacakan = () => {
    sirene(false);
    bicara(polos(`${judul}. ${kalimat} ${daftarLangkah.join(' ')}`), bahasa());
  };
  document.body.append(el);
  renderIkon(el);
  if (d.tsunami) hitungMundur($('[data-hitung]', el), d.tiba);

  // Sirene & getar hanya untuk tingkat waspada/bahaya
  if (d.level !== 'info') {
    layarTetapNyala(true);
    sirene(true);
    navigator.vibrate?.([600, 300, 600, 300, 600]);
  }
  notifikasi(d, `${judul}: M${d.mag.toFixed(1)}`);

  // Peta: episenter dan garis ke lokasi
  lapisanLive.clearLayers();
  L.circle([d.lat, d.lon], { radius: 20000, color: '#dc2626', weight: 2, fillOpacity: 0.08, className: 'lv-denyut' }).addTo(lapisanLive);
  L.marker([d.lat, d.lon], { icon: ikonTitik('pin-episenter', `M${d.mag.toFixed(0)}`), zIndexOffset: 1000 })
    .bindPopup(`<b>${d.simulasi ? '[SIMULASI] ' : ''}M${d.mag.toFixed(1)}</b><br>${esc(d.tempat)}`).addTo(lapisanLive);
  L.polyline([[d.l.lat, d.l.lon], [d.lat, d.lon]], { color: '#dc2626', weight: 2, dashArray: '6 6' }).addTo(lapisanLive);

  $('[data-lv-senyap]', el).onclick = () => {
    sirene(false);
    hentikanBicara();
  };
  el.querySelector('[data-lv-bacakan]')?.addEventListener('click', bacakan);
  // Bacakan otomatis (Pengaturan): sirene dulu sebentar agar menarik perhatian, lalu suara
  if (bacakanOtomatis() && d.level !== 'info') setTimeout(() => { if (el.isConnected) bacakan(); }, 4000);
  $('[data-lv-aman]', el).onclick = tutupPeringatan;
  $('[data-lv-kabar]', el).onclick = (e) => kabari('aman', e.currentTarget);
  $('[data-lv-evakuasi]', el).onclick = () => {
    tutupPeringatan({ simpanPeta: true });
    // Gempa terasa di lokasi tersimpan (bukan di tempat pengguna): arahkan ke kontak keluarga
    if (d.lain) return bukaHalaman('card-kontak');
    api.jalankanDarurat(d.jenis);
  };
  $('[data-lv-evakuasi]', el).focus();
  renderPil();
}

function tutupPeringatan(opsi = {}) {
  sirene(false);
  hentikanBicara();
  navigator.vibrate?.(0);
  layarTetapNyala(false);
  document.querySelector('.lv-overlay')?.remove();
  if (!opsi.simpanPeta) lapisanLive.clearLayers();
  peringatanAktif = null;
}

// ---------- Indikator "Live" ----------
function pasangPil() {
  if ($('#pil-live')) return;
  const el = document.createElement('div');
  el.id = 'pil-live';
  el.className = 'pil-live glass';
  el.innerHTML = '<button type="button" class="pl-tombol" aria-expanded="false"><span class="pl-titik"></span><b>LIVE</b><span data-pl-teks>Memulai…</span></button><div class="pl-menu" hidden></div>';
  (document.querySelector('.app') || document.body).append(el);
  const tombol = $('.pl-tombol', el);
  tombol.onclick = (e) => {
    e.stopPropagation();
    const menu = $('.pl-menu', el);
    menu.hidden = !menu.hidden;
    tombol.setAttribute('aria-expanded', String(!menu.hidden));
    renderPil();
  };
  document.addEventListener('click', (e) => { if (!e.target.closest('#pil-live')) $('.pl-menu', el).hidden = true; });
  renderPil();
}

function renderPil() {
  const el = $('#pil-live');
  if (!el) return;
  const jam = status.cek ? new Date(status.cek).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null;
  el.dataset.galat = status.galat ? '1' : '';
  $('[data-pl-teks]', el).textContent = !lokasi ? 'menunggu lokasi' : status.galat ? 'BMKG tidak terjangkau' : jam ? `BMKG · ${jam}` : 'memeriksa…';
  const menu = $('.pl-menu', el);
  if (menu.hidden) return;
  const t = status.terakhir;
  const izin = izinNotifikasi();
  const latar = diAplikasi ? pantauLatarAktif() : null;
  menu.innerHTML = `
    <p><b>Pemantauan live</b><br><span class="meta">Memeriksa gempa & potensi tsunami dari BMKG tiap ${INTERVAL / 1000} detik untuk ${esc(lokasi?.label || 'lokasi Anda')}${daftarLokasiTersimpan().length ? ` dan ${daftarLokasiTersimpan().length} lokasi tersimpan` : ''}. Peringatan muncul bila guncangan diperkirakan terasa (MMI ≥ 4) atau ada potensi tsunami dan Anda di pesisir.</span></p>
    ${status.galat ? `<p class="hd-warn">Gagal memeriksa: ${esc(status.galat)}</p>` : ''}
    <p class="meta">${t ? `Gempa terakhir ≤ 500 km: <b>M${t.mag.toFixed(1)}</b> ${esc(t.tempat)}, ${fmtKm(t.jarak)}, ${waktuRelatif(t.waktu)} (MMI ${labelMMI(t.mmi)})` : 'Belum ada gempa dalam 1 jam terakhir dalam 500 km.'}</p>
    ${izin === 'default' ? '<button type="button" data-pl-notif>Aktifkan notifikasi</button>' : izin === 'granted' ? `<p class="meta">✓ Notifikasi aktif${diAplikasi ? '' : ' (saat tab tidak dilihat)'}.</p>` : izin === 'denied' ? `<p class="meta">Notifikasi diblokir di pengaturan ${diAplikasi ? 'Android' : 'browser'}.</p>` : ''}
    ${latar === null ? '' : `<label class="pl-latar"><input type="checkbox" data-pl-latar ${latar ? 'checked' : ''}><span><b>Pantau saat aplikasi ditutup</b><br><span class="meta">Cek BMKG ±15 menit sekali dan beri notifikasi bila gempa terasa di lokasi terakhir atau lokasi tersimpan.</span></span></label>`}
    <div class="pl-sim"><span class="meta">Uji / latihan:</span>
      <button type="button" data-pl-sim="gempa">Simulasi gempa</button>
      <button type="button" data-pl-sim="tsunami">Simulasi tsunami</button>
    </div>`;
  menu.querySelector('[data-pl-notif]')?.addEventListener('click', async () => {
    await mintaIzinNotifikasi();
    renderPil();
  });
  menu.querySelector('[data-pl-latar]')?.addEventListener('change', async (e) => {
    if (e.target.checked && izinNotifikasi() !== 'granted') await mintaIzinNotifikasi();
    aturPantauLatar(e.target.checked);
    renderPil();
  });
  menu.querySelectorAll('[data-pl-sim]').forEach((b) => b.addEventListener('click', () => {
    menu.hidden = true;
    simulasi(b.dataset.plSim);
  }));
}
