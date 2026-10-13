// Mode darurat: cari AREA aman terdekat untuk satu jenis bencana (bukan sekadar satu titik),
// dengan mempertimbangkan elevasi & lereng, lalu buat rute jalan kaki/kendaraan ke sana (OSRM).
import { esc, fmtKm, arahKe, jarakKm, $ } from './util.js';
import { map, lapisan, ikonTitik } from './peta.js';
import { evaluasiArea, pilihBahaya, nilaiDi, NAMA_LEVEL, WARNA_CSS } from './zona.js';
import { renderIkon, turunkanSheet, paddingPanel } from './ui.js';
import { titikKumpul, namaTitik, JENIS } from './titikkumpul.js';
import { rute, lengkapiRute, grafikElevasi } from './rute.js';
import { jalankanEvakuasiGempa, batalGempa } from './evakuasi-gempa.js';

const kepala = (p, judul) => `<div class="hd-head"><b><span class="row-ikon" style="--c:${p.warna}"><i data-lucide="${p.ikon}"></i></span>${judul}</b><button type="button" class="hd-tutup" aria-label="Tutup">✕</button></div>`;

const L = window.L;

// Kriteria "aman" per bencana. c = sel grid, u = sel lokasi pengguna, ctx = data tambahan.
const PROFIL = {
  tsunami: {
    label: 'Tsunami', ikon: 'waves', warna: 'var(--blue)', radius: 6, langkah: 0.12, moda: 'foot',
    aman: (c, u, x) => c.lv.tsunami === 0 && c.elev >= x.tinggiAman && c.lereng < 30 && c.lv.longsor <= 1,
    alasan: (c, u) => `Elevasi ±${Math.round(c.elev)} m (${Math.max(0, Math.round(c.elev - u.elev))} m lebih tinggi dari lokasi), di luar jangkauan genangan tsunami`,
    arahan: 'Segera jalan kaki/motor menjauhi pantai menuju tanah tinggi. Jangan memakai mobil (macet). Jangan kembali sampai ada pernyataan aman dari BMKG.',
  },
  banjir: {
    label: 'Banjir', ikon: 'droplets', warna: 'var(--teal)', radius: 3, langkah: 0.08, moda: 'foot',
    aman: (c, u) => c.lv.banjir === 0 && c.elev >= u.elev + 3 && c.lereng < 15 && c.lv.longsor === 0,
    alasan: (c, u) => `Elevasi ±${Math.round(c.elev)} m (+${Math.round(c.elev - u.elev)} m dari lokasi), landai & jauh dari sungai`,
    arahan: 'Matikan listrik, bawa dokumen penting. Hindari berjalan di arus air (15 cm sudah bisa menjatuhkan orang) dan jangan melintasi jembatan saat banjir.',
  },
  longsor: {
    label: 'Longsor', ikon: 'mountain', warna: 'var(--brown)', radius: 2.5, langkah: 0.08, moda: 'foot',
    aman: (c) => c.lv.longsor === 0 && c.lereng < 8 && c.lv.banjir <= 1,
    tetangga: (c) => c.lereng < 15, // sekitarnya juga tidak curam (tidak di kaki tebing)
    alasan: (c) => `Area landai (lereng ±${c.lereng.toFixed(0)}°), tidak di bawah tebing curam`,
    arahan: 'Menjauh dari tebing dan kaki lereng; jangan berlindung di lembah atau alur sungai kecil. Waspadai longsor susulan saat hujan.',
  },
  gempa: {
    label: 'Gempa', ikon: 'activity', warna: 'var(--red)', radius: 4, langkah: 0.1, moda: 'foot',
    aman: (c) => c.lv.gempa === 0 && c.lv.longsor === 0 && c.lereng < 10 && c.lv.banjir <= 1 && c.lv.tsunami === 0,
    alasan: (c) => `Di luar zona sesar, landai (±${c.lereng.toFixed(0)}°), jauh dari lereng rawan longsor`,
    arahan: 'Saat guncangan: merunduk, lindungi kepala, bertahan. Setelah berhenti, keluar ke ruang terbuka. Rute ini untuk mengungsi/bermalam di area yang lebih aman dari gempa susulan.',
  },
  gunung: {
    label: 'Gunung api', ikon: 'triangle', warna: 'var(--orange)', radius: 25, langkah: 0.5, moda: 'car',
    aman: (c) => c.lv.gunung === 0 && c.lv.longsor <= 1 && c.lv.banjir <= 1,
    alasan: () => 'Di luar radius bahaya kawah & jalur abu, tidak di lembah sungai (lahar)',
    arahan: 'Ikuti perintah evakuasi BPBD. Pakai masker & kacamata, hindari lembah sungai berhulu di gunung (awan panas & lahar).',
  },
  kebakaran: {
    label: 'Kebakaran', ikon: 'flame', warna: 'var(--red)', radius: 15, langkah: 0.3, moda: 'car',
    aman: (c) => c.lv.kebakaran === 0 && c.lv.banjir <= 1,
    alasan: () => 'Di luar jangkauan api & jalur asap searah angin',
    arahan: 'Menjauh berlawanan arah angin; tutup hidung/mulut dengan kain basah atau masker N95.',
  },
};

// Penanda "Tempat aman" (aman.js) memakai gaya yang sama dengan tujuan evakuasi; sembunyikan selama
// mode darurat terbuka agar tidak tertukar, lalu tampilkan lagi bila sebelumnya aktif.
let amanDisembunyikan = false;
function sembunyikanAman() {
  if (map.hasLayer(lapisan.aman)) {
    map.removeLayer(lapisan.aman);
    amanDisembunyikan = true;
  }
}
function pulihkanAman() {
  if (amanDisembunyikan) map.addLayer(lapisan.aman);
  amanDisembunyikan = false;
}

let konteks = null;
let siapResolve = null;
let siap = new Promise((r) => { siapResolve = r; });

/** Dipanggil main.js: lokasi berganti (data belum siap). */
export function resetDarurat() {
  konteks = null;
  batalGempa();
  // Buat penanda baru hanya bila yang lama sudah terpenuhi, agar pemanggil yang sedang menunggu tidak tergantung.
  if (!siapResolve) siap = new Promise((r) => { siapResolve = r; });
  lapisan.evakuasi.clearLayers();
  $('#hasil-darurat').hidden = true;
  pulihkanAman();
}

/** Dipanggil main.js setelah semua analisis & zona selesai. */
export function aturKonteksDarurat(ctx, hasil) {
  konteks = { ctx, hasil };
  if (siapResolve) {
    siapResolve();
    siapResolve = null;
  }
}

// ---------- Pencarian area aman ----------
function cariArea(grid, profil, u, x) {
  const aman = (c) => c && profil.aman(c, u, x);
  const tetangga = profil.tetangga || ((c) => aman(c));
  const kandidat = [];
  for (const c of grid.sel) {
    if (!aman(c)) continue;
    // Area, bukan titik tunggal: ≥ 6 dari 8 tetangga juga memenuhi syarat
    let ok = 0;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const t = grid.ambil(c.i + di, c.j + dj);
        if (t && (profil.tetangga ? tetangga(t) && aman(t) : aman(t))) ok++;
      }
    }
    if (ok >= 6) kandidat.push(c);
  }
  kandidat.sort((a, b) => a.jarak - b.jarak);
  // Ambil 5 kandidat terdekat yang saling berjauhan (arah berbeda)
  const pilih = [];
  const minJarak = Math.max(0.3, grid.langkahKm * 4);
  for (const c of kandidat) {
    if (pilih.every((p) => jarakKm(p.lat, p.lon, c.lat, c.lon) >= minJarak)) pilih.push(c);
    if (pilih.length >= 5) break;
  }
  return pilih;
}

/** Titik kumpul (resmi/pribadi/OSM/potensial) yang berada di sel aman menjadi kandidat tujuan juga. */
function kandidatTitik(grid, profil, u, x, ctx) {
  const kx = 111.32 * Math.cos((ctx.lat * Math.PI) / 180);
  return titikKumpul()
    .filter((t) => t.jarak <= profil.radius)
    .map((t) => {
      const i = Math.round(((t.lat - ctx.lat) * 110.57) / grid.langkahKm);
      const j = Math.round(((t.lon - ctx.lon) * kx) / grid.langkahKm);
      const c = grid.ambil(i, j);
      if (!c) return null;
      // Tsunami: gedung TES/evakuasi vertikal resmi memang berada di zona genangan, jadi tetap sah sebagai tujuan.
      const vertikal = profil === PROFIL.tsunami && t.jenis === 'resmi' && /vertikal|TES|sementara/i.test(`${t.jenisResmi || ''} ${t.keterangan || ''}`);
      if (!vertikal && !profil.aman(c, u, x)) return null;
      return { ...c, lat: t.lat, lon: t.lon, jarak: t.jarak, tk: t, vertikal };
    })
    .filter(Boolean)
    .sort((a, b) => (a.jarak - JENIS[a.tk.jenis].bonus * 0.1) - (b.jarak - JENIS[b.tk.jenis].bonus * 0.1))
    .slice(0, 4);
}

// ---------- Alur UI ----------
let pilihanRute = [];
let indeksRute = 0;

export async function jalankanDarurat(idBahaya) {
  const profil = PROFIL[idBahaya];
  if (!profil) return;
  sembunyikanAman();
  if (idBahaya === 'gempa') {
    // Gempa punya alur sendiri: titik kumpul segera + area pengungsian + rekomendasi.
    return jalankanEvakuasiGempa({ profil, kepala, tutup, tunggu: () => siap.then(() => konteks), konteks: () => konteks, jalankanDarurat });
  }
  batalGempa();
  const panel = $('#hasil-darurat');
  panel.hidden = false;
  panel.innerHTML = `${kepala(profil, profil.label)}
    <p class="muted">Mencari area aman terdekat… (menilai elevasi, lereng, dan zona bahaya)</p>`;
  $('.hd-tutup', panel).onclick = tutup;
  renderIkon(panel);
  turunkanSheet();
  pilihBahaya(idBahaya);

  if (!konteks) {
    $('p', panel).textContent = 'Menunggu analisis lokasi selesai…';
    await siap;
  }
  const { ctx, hasil } = konteks;
  const asal = [ctx.lat, ctx.lon];

  try {
    const grid = await evaluasiArea(ctx.lat, ctx.lon, profil.radius, profil.langkah);
    const u = grid.ambil(0, 0) || (await nilaiDi(ctx.lat, ctx.lon).then((v) => ({ elev: v.elev, lereng: v.lereng, lv: v })));
    const sub = hasil.gempa?.status === 'fulfilled' ? hasil.gempa.value.subduksiTerdekat : null;
    const x = { tinggiAman: Math.max(20, sub && sub.km < 300 ? 30 : 20) };

    const sudahAman = u && u.lv && profil.aman(u, u, x);
    const kandidat = [...cariArea(grid, profil, u, x).slice(0, 4), ...kandidatTitik(grid, profil, u, x, ctx)];
    if (!kandidat.length) throw new Error(`Tidak ditemukan area aman dalam radius ${profil.radius} km. Ikuti jalur evakuasi BPBD${idBahaya === 'tsunami' ? ' atau naik ke lantai atas gedung beton tinggi' : ''}.`);

    $('p', panel).textContent = 'Menghitung rute…';
    const hasilRute = (await Promise.allSettled(kandidat.map(async (c) => {
      const r = await rute(profil.moda, asal, c);
      return { ...r, tujuan: c };
    }))).filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (!hasilRute.length) throw new Error('Layanan rute tidak dapat dihubungi. Gunakan arah garis lurus pada peta.');

    // Jalan berakhir di titik terdekat yang bisa dicapai; sisanya (mis. mendaki bukit) ditempuh di luar jalan.
    const levelRute = (v) => (idBahaya === 'banjir' ? Math.max(v.banjir, v.longsor) : v[idBahaya]);
    await Promise.all(hasilRute.map((r) => lengkapiRute(r, profil.moda, { level: levelRute })));
    // Biaya = waktu tempuh + penalti melewati zona bahaya (menit per 100 m)
    // Titik kumpul resmi/pribadi diberi bonus beberapa menit agar diutamakan bila waktunya sebanding.
    // Tsunami: rute yang tidak sempat ditempuh sebelum gelombang tiba diberi penalti besar.
    const tiba = idBahaya === 'tsunami' && sub ? Math.max(10, Math.round(sub.km / 8)) : null;
    const biaya = (r) => r.menit + (r.tujuan.vertikal ? 0 : r.bahayaKm * 10)
      - (r.tujuan.tk ? JENIS[r.tujuan.tk.jenis].bonus : 0)
      + (tiba && r.menit > tiba * 0.8 ? 120 : 0);
    hasilRute.sort((a, b) => biaya(a) - biaya(b));
    pilihanRute = hasilRute.slice(0, 3);
    indeksRute = 0;
    tampilkan(idBahaya, profil, ctx, hasil, u, sudahAman, sub);
  } catch (err) {
    panel.innerHTML = `${kepala(profil, profil.label)}
      <p>${esc(err.message)}</p><p class="hd-arahan">${profil.arahan}</p>`;
    $('.hd-tutup', panel).onclick = tutup;
    renderIkon(panel);
  }
}

function tampilkan(idBahaya, profil, ctx, hasil, u, sudahAman, sub) {
  const r = pilihanRute[indeksRute];
  const t = r.tujuan;
  const panel = $('#hasil-darurat');
  const modaTeks = profil.moda === 'foot' ? 'jalan kaki' : 'berkendara';
  const gmaps = `https://www.google.com/maps/dir/?api=1&origin=${ctx.lat},${ctx.lon}&destination=${t.lat.toFixed(6)},${t.lon.toFixed(6)}&travelmode=${profil.moda === 'foot' ? 'walking' : 'driving'}`;

  let peringatan = '';
  if (idBahaya === 'tsunami') {
    const tiba = sub ? Math.max(10, Math.round(sub.km / 8)) : null;
    if (tiba && r.menit > tiba * 0.8 && !t.vertikal) {
      const gedung = (hasil.bangunan?.status === 'fulfilled' ? hasil.bangunan.value.tinggi : [])[0];
      peringatan = `<div class="hd-warn">⚠ Waktu tempuh ±${Math.round(r.menit)} menit, sedangkan tsunami dari zona subduksi (${fmtKm(sub.km)}) dapat tiba dalam ±${tiba} menit.
        ${gedung ? `Bila tidak sempat, lakukan <b>evakuasi vertikal</b> ke <b>${esc(gedung.nama || `gedung ${gedung.lantai} lantai`)}</b> (${fmtKm(gedung.jarak)}), naik ke lantai ≥ 3.` : 'Bila tidak sempat, naik ke lantai atas gedung beton tinggi terdekat.'}</div>`;
    }
  }
  if (r.sisaKm > 0.03) {
    peringatan += `<div class="hd-info">Jalan berakhir ${fmtKm(r.sisaKm)} sebelum area aman; lanjutkan ${profil.moda === 'foot' ? 'berjalan/mendaki' : 'berjalan kaki'} (garis putus-putus) hingga elevasi ±${Math.round(t.elev)} m.</div>`;
  }
  if (r.bahayaKm > 0.05) peringatan += `<div class="hd-warn">Rute melewati zona bahaya ±${fmtKm(r.bahayaKm)} — lewati secepatnya.</div>`;

  panel.innerHTML = `
    ${kepala(profil, `Evakuasi ${profil.label}`)}
    ${sudahAman ? `<p class="hd-ok">✓ Lokasi Anda sudah berada di area yang relatif aman dari ${profil.label.toLowerCase()}. Rute di bawah menuju area aman lain terdekat bila diperlukan.</p>` : ''}
    ${t.tk ? `<div class="hd-tujuan"><span class="zchip" style="--c:${JENIS[t.tk.jenis].warna}">${JENIS[t.tk.jenis].label}</span> <b>${esc(namaTitik(t.tk))}</b></div>` : ''}
    ${t.vertikal
      ? `<div class="hd-tujuan">Evakuasi vertikal: naik ke lantai ≥ 3 gedung TES resmi${t.tk.keterangan ? ` (${esc(t.tk.keterangan)})` : ''}.</div>`
      : `<div class="hd-tujuan"><span class="zchip" style="--c:${WARNA_CSS[0]}">zona ${NAMA_LEVEL[0].toLowerCase()}</span> ${esc(profil.alasan(t, u))}</div>`}
    <div class="hd-angka">
      <div><b>${Math.round(r.menit)}</b> menit<span>${modaTeks}</span></div>
      <div><b>${fmtKm(r.jarakKm)}</b><span>jarak rute (${arahKe(ctx.lat, ctx.lon, t.lat, t.lon)})</span></div>
      <div><b>${Number.isFinite(r.elevAwal) ? `${Math.round(r.elevAwal)}→${Math.round(r.elevAkhir)}` : '—'}</b> m<span>elevasi (naik ${Math.round(r.naik)} m)</span></div>
    </div>
    ${grafikElevasi(r.sampel)}
    ${peringatan}
    <p class="hd-arahan">${profil.arahan}</p>
    <div class="hd-aksi">
      <a class="btn-utama" href="${gmaps}" target="_blank" rel="noopener">Mulai navigasi</a>
      ${pilihanRute.length > 1 ? `<button type="button" data-alt>Rute lain (${indeksRute + 1}/${pilihanRute.length})</button>` : ''}
    </div>
    <p class="meta muted">Area dipilih otomatis dari DEM ±30 m & zona perkiraan; rute dari OpenStreetMap (OSRM). Utamakan jalur evakuasi resmi & arahan petugas.</p>`;
  $('.hd-tutup', panel).onclick = tutup;
  renderIkon(panel);
  const alt = $('[data-alt]', panel);
  if (alt) alt.onclick = () => {
    indeksRute = (indeksRute + 1) % pilihanRute.length;
    tampilkan(idBahaya, profil, ctx, hasil, u, sudahAman, sub);
  };

  // Peta
  lapisan.evakuasi.clearLayers();
  pilihanRute.forEach((p, i) => {
    if (i !== indeksRute) L.polyline(p.garis, { color: '#64748b', weight: 4, opacity: 0.5, dashArray: '6 6' }).addTo(lapisan.evakuasi);
  });
  L.polyline(r.garis, { color: '#fff', weight: 9, opacity: 0.9 }).addTo(lapisan.evakuasi);
  L.polyline(r.garis, { color: '#16a34a', weight: 5 }).addTo(lapisan.evakuasi);
  const akhir = r.garis[r.garis.length - 1];
  if (jarakKm(...akhir, t.lat, t.lon) > 0.03) {
    L.polyline([akhir, [t.lat, t.lon]], { color: '#16a34a', weight: 3, dashArray: '4 6' }).addTo(lapisan.evakuasi);
  }
  L.circle([t.lat, t.lon], { radius: Math.max(120, profil.langkah * 1000 * 1.5), color: '#16a34a', weight: 2, fillColor: '#22c55e', fillOpacity: 0.35 }).addTo(lapisan.evakuasi);
  L.marker([t.lat, t.lon], { icon: ikonTitik('pin-aman', '✓'), zIndexOffset: 900 })
    .bindPopup(`<b>${t.tk ? esc(namaTitik(t.tk)) : 'Area aman'}</b><br>${esc(profil.alasan(t, u))}`)
    .addTo(lapisan.evakuasi);
  map.fitBounds(L.latLngBounds([[ctx.lat, ctx.lon], [t.lat, t.lon], ...r.garis]), { ...paddingPanel(panel), maxZoom: 16 });
}

function tutup() {
  batalGempa();
  $('#hasil-darurat').hidden = true;
  lapisan.evakuasi.clearLayers();
  pulihkanAman();
}

// ---------- Pemilih bencana ----------
export function pasangDarurat() {
  const dialog = $('#dialog-darurat');
  $('#pilih-darurat').innerHTML = Object.entries(PROFIL).map(([id, p]) => `<button type="button" data-darurat="${id}"><span class="pd-ikon" style="--c:${p.warna}"><i data-lucide="${p.ikon}"></i></span>${p.label}</button>`).join('');
  renderIkon(dialog);
  $('#btn-darurat').addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('click', (e) => {
    const b = e.target.closest('[data-darurat]');
    if (b) {
      dialog.close();
      jalankanDarurat(b.dataset.darurat);
    } else if (e.target === dialog || e.target.closest('[data-batal]')) {
      dialog.close();
    }
  });
}
