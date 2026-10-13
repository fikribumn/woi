// Evakuasi gempa bumi, dua tahap:
//   1. Titik kumpul segera: begitu guncangan berhenti, ke ruang terbuka terdekat yang bisa dicapai jalan kaki
//      (≤ 1,5 km), jauh dari gedung tinggi, tidak di lereng/kaki tebing, dan tidak tepat di jalur sesar.
//   2. Area pengungsian: untuk bermalam selama gempa susulan. Area landai & kering di luar zona sesar,
//      longsor, banjir/likuefaksi, dan genangan tsunami; diutamakan yang tinggi di atas sungai dan dekat
//      fasilitas umum (sekolah/tempat ibadah: air, toilet, atap).
// Di pesisir rendah, gempa kuat adalah tanda alami tsunami: tujuan harus di tanah tinggi.
import { esc, fmtKm, arahKe, jarakKm, $ } from './util.js';
import { map, lapisan, ikonTitik } from './peta.js';
import { evaluasiArea, pilihBahaya, nilaiDi, NAMA_LEVEL, WARNA_CSS } from './zona.js';
import { sampelTitik } from './dem.js';
import { renderIkon, turunkanSheet, paddingPanel } from './ui.js';
import { titikKumpul, namaTitik, JENIS } from './titikkumpul.js';
import { rute, lengkapiRute, grafikElevasi } from './rute.js';

const L = window.L;
const R_SEGERA = 1.5; // km
const R_UNGSI = 5; // km
const LANGKAH_UNGSI = 0.1; // km
const HUTAN = /hutan|tahura|forest|cagar|kebun raya/i; // taman berpohon lebat bukan ruang terbuka
const MAKS_MENIT_SEGERA = 25; // titik kumpul segera harus terjangkau jalan kaki
const NAMA_LIQ = { 1: 'tinggi', 2: 'menengah', 3: 'rendah' };

const nilai = (r) => (r?.status === 'fulfilled' ? r.value : null);
const menit = (m) => `${Math.max(1, Math.round(m))}`;

let jalan = 0; // penanda pencarian terakhir (abaikan hasil pencarian lama)
let rencana = null;

// ---------- Kondisi lokasi ----------
function kondisiLokasi(ctx, hasil, osm, u) {
  const gempa = nilai(hasil.gempa);
  const ts = nilai(hasil.tsunami);
  const sub = gempa?.subduksiTerdekat || null;
  const tinggiAman = sub && sub.km < 300 ? 30 : 20;
  // Gempa kuat di pesisir rendah = tanda alami tsunami
  const ancamTsunami = (u?.lv?.tsunami ?? 0) >= 2 || (!!ts?.pesisir && (ts.elev ?? u?.elev ?? 99) < tinggiAman);
  const terkuat = gempa?.gempaTerkuat;
  return {
    sesar: gempa?.sesarTerdekat || null,
    sub,
    tinggiAman,
    ancamTsunami,
    tibaTsunami: sub ? Math.max(10, Math.round(sub.km / 8)) : null,
    kelasKrb: gempa?.kelasKrb || null,
    geologi: nilai(hasil.geologi),
    bangunan: nilai(hasil.bangunan),
    hujan: nilai(hasil.hujan),
    baruGempa: terkuat && Date.now() - terkuat.waktu < 24 * 3600e3 && terkuat.mmi >= 4 ? terkuat : null,
    rs: (osm?.faskes || []).find((f) => f.tags.amenity === 'hospital') || null,
    u,
  };
}

// ---------- Tahap 1: titik kumpul segera ----------
function namaRuang(t) {
  const tg = t.tags || {};
  if (t.nama) return t.nama;
  if (tg.leisure === 'pitch' || tg.leisure === 'stadium') return 'Lapangan';
  if (tg.leisure === 'park' || tg.leisure === 'common') return 'Taman';
  if (tg.place === 'square') return 'Alun-alun';
  return 'Ruang terbuka';
}

/** Gedung bertingkat yang runtuhannya dapat menjangkau titik (jarak < tinggi gedung). */
function gedungDekat(lat, lon, gedung) {
  let terburuk = null;
  for (const g of gedung) {
    if (!g.tinggi) continue;
    const m = jarakKm(lat, lon, g.lat, g.lon) * 1000;
    if (m < g.tinggi + 10 && (!terburuk || g.tinggi / m > terburuk.tinggi / terburuk.m)) terburuk = { ...g, m };
  }
  return terburuk;
}

/** Apakah titik berada di bawah tebing: ada lereng ≥ 25° yang lebih tinggi > 10 m dalam ±120 m. */
async function bawahTebing(lat, lon, elev) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  const d = 0.12;
  const titik = [[d / 110.57, 0], [-d / 110.57, 0], [0, d / kx], [0, -d / kx]].map(([a, b]) => [lat + a, lon + b]);
  const s = await Promise.all(titik.map((p) => sampelTitik(...p, 13).catch(() => null)));
  return s.some((x) => x && x.lereng >= 25 && x.elev - elev > 10);
}

async function nilaiTitikSegera(t, k) {
  const v = await nilaiDi(t.lat, t.lon);
  if (!v) return null;
  const tolak = [];
  const catatan = [];
  let penalti = 0;
  if (v.gempa >= 3) tolak.push('tepat di jalur sesar');
  if (v.longsor >= 2 || v.lereng >= 15) tolak.push('di lereng curam');
  if (k.ancamTsunami && v.tsunami >= 1) tolak.push('di zona genangan tsunami');
  if (tolak.length) return { ...t, v, tolak };
  if (await bawahTebing(t.lat, t.lon, v.elev)) return { ...t, v, tolak: ['di bawah tebing'] };

  if (v.gempa === 2) { penalti += 3; catatan.push(['Dekat sesar (≤ 2 km)', 2]); }
  if (v.banjir >= 2) { penalti += 4; catatan.push(['Dataran rendah dekat sungai — tanah bisa jenuh air/likuefaksi', 2]); }
  if (v.longsor === 1) { penalti += 2; catatan.push([`Agak miring (${v.lereng.toFixed(0)}°)`, 1]); }
  const g = gedungDekat(t.lat, t.lon, k.gedung);
  if (g) { penalti += 5; catatan.push([`${Math.round(g.m)} m dari gedung ${g.lantai} lantai — jaga jarak dari sisi gedung`, 2]); }
  if (!catatan.length) catatan.push([`Landai (${v.lereng.toFixed(0)}°), jauh dari tebing & gedung tinggi terpetakan`, 0]);
  return { ...t, v, elev: v.elev, penalti, catatan, tolak: [] };
}

async function cariSegera(ctx, osm, k) {
  const sekolah = /^(school|college|university|townhall|community_centre)$/;
  let daftar = [
    ...titikKumpul().filter((t) => t.jenis !== 'potensial')
      .map((t) => ({ lat: t.lat, lon: t.lon, nama: namaTitik(t), jenis: JENIS[t.jenis].label, warna: JENIS[t.jenis].warna, bonus: JENIS[t.jenis].bonus, tk: t })),
    ...(osm?.ruangTerbuka || []).filter((t) => !HUTAN.test(t.nama || '')).map((t) => ({ lat: t.lat, lon: t.lon, nama: namaRuang(t), jenis: 'Ruang terbuka (OSM)', warna: 'var(--green)', bonus: 2 })),
    ...(osm?.potensial || []).filter((t) => sekolah.test(t.tags.amenity || ''))
      .map((t) => ({ lat: t.lat, lon: t.lon, nama: t.nama || 'Halaman sekolah/kantor', jenis: 'Halaman fasilitas umum', warna: 'var(--gray)', bonus: 0 })),
  ]
    .map((t) => ({ ...t, jarak: jarakKm(ctx.lat, ctx.lon, t.lat, t.lon) }))
    .filter((t) => t.jarak <= R_SEGERA)
    .sort((a, b) => a.jarak - b.jarak);
  const unik = [];
  for (const t of daftar) if (!unik.some((x) => jarakKm(x.lat, x.lon, t.lat, t.lon) < 0.05)) unik.push(t);
  daftar = unik.slice(0, 24);

  const dinilai = (await Promise.all(daftar.map((t) => nilaiTitikSegera(t, k).catch(() => null)))).filter(Boolean);
  const layak = dinilai.filter((t) => !t.tolak.length)
    .sort((a, b) => (a.jarak + a.penalti * 0.08 - a.bonus * 0.05) - (b.jarak + b.penalti * 0.08 - b.bonus * 0.05))
    .slice(0, 6);
  return { layak, ditolak: dinilai.filter((t) => t.tolak.length) };
}

// ---------- Tahap 2: area pengungsian ----------
function cariUngsi(grid, k, osm, longgar) {
  const aman = (c) => c && c.lv.gempa <= 1 && c.lv.longsor === 0 && c.lv.tsunami === 0
    && (longgar ? c.lv.banjir <= 1 : c.lv.banjir === 0) && c.lereng < 8
    // Pesisir rendah: tempat mengungsi juga harus aman dari tsunami susulan (tanah tinggi atau jauh dari pantai)
    && (!k.ancamTsunami || c.elev >= k.tinggiAman || c.q.dc > 10);
  const fasilitas = [...(osm?.potensial || []), ...titikKumpul().filter((t) => t.jenis !== 'potensial')];
  const kandidat = [];
  for (const c of grid.sel) {
    if (!aman(c)) continue;
    let ok = 0;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if ((di || dj) && aman(grid.ambil(c.i + di, c.j + dj))) ok++;
    if (ok < 6) continue;
    const diAtasSungai = Number.isFinite(c.q?.er) && c.q.dr < 3 ? c.elev - c.q.er : null;
    // Skor (km setara): jarak, dikurangi bonus tinggi di atas sungai, ditambah penalti bila masih 2–5 km dari sesar.
    kandidat.push({ ...c, diAtasSungai, skor: c.jarak - Math.min(0.3, Math.max(0, (diAtasSungai ?? 0) / 50)) + (c.lv.gempa ? 0.8 : 0) });
  }
  kandidat.sort((a, b) => a.skor - b.skor);
  const pilih = [];
  for (const c of kandidat) {
    if (pilih.every((p) => jarakKm(p.lat, p.lon, c.lat, c.lon) >= 0.5)) pilih.push(c);
    if (pilih.length >= 8) break;
  }
  // Dekatkan tujuan ke fasilitas umum terdekat (≤ 300 m) yang juga aman — tempat mengungsi butuh air & toilet.
  const hasil = pilih.map((c) => {
    const f = fasilitas.map((t) => ({ t, km: jarakKm(c.lat, c.lon, t.lat, t.lon) })).filter((x) => x.km <= 0.3).sort((a, b) => a.km - b.km)[0];
    return { ...c, fasilitas: f ? f.t : null };
  });
  hasil.sort((a, b) => (a.skor - (a.fasilitas ? 0.4 : 0)) - (b.skor - (b.fasilitas ? 0.4 : 0)));
  return { kandidat: hasil.slice(0, 4), aman };
}

function alasanUngsi(c, u, longgar) {
  const r = [`landai (${c.lereng.toFixed(0)}°)`, c.q && c.q.df < 99 ? `${fmtKm(c.q.df)} dari sesar aktif` : 'jauh dari sesar aktif', 'tidak di lereng rawan longsor'];
  if (Number.isFinite(c.diAtasSungai)) r.push(`±${Math.max(0, Math.round(c.diAtasSungai))} m di atas sungai terdekat`);
  else r.push(longgar ? 'agak jauh dari sungai' : 'jauh dari sungai');
  if (u && Number.isFinite(u.elev)) r.push(`elevasi ±${Math.round(c.elev)} m (${c.elev >= u.elev ? '+' : ''}${Math.round(c.elev - u.elev)} m dari lokasi)`);
  return r.join(', ');
}

// ---------- Rute ----------
const levelGempa = (v) => Math.max(v.gempa, v.longsor);
const levelUngsi = (v) => Math.max(v.gempa, v.longsor, v.banjir, v.tsunami);

async function ruteKe(asal, tujuan, level, sungai, biayaTambahan, maksMenit = Infinity) {
  let hasil = (await Promise.allSettled(tujuan.map(async (c) => {
    const r = await rute('foot', asal, c);
    r.tujuan = c;
    return lengkapiRute(r, 'foot', { level, sungai });
  }))).filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!hasil.length && tujuan.length) {
    // Layanan rute tidak terjangkau (jaringan padat/terputus setelah gempa): pakai garis lurus sebagai arah,
    // dengan jarak jalan diperkirakan 1,3× jarak lurus.
    hasil = await Promise.all(tujuan.slice(0, 3).map((c) => {
      const km = jarakKm(...asal, c.lat, c.lon) * 1.3;
      return lengkapiRute({ jarakKm: km, menit: (km / 5) * 60, garis: [asal, [c.lat, c.lon]], tujuan: c, lurus: true }, 'foot', { level, sungai });
    }));
  }
  // Biaya = waktu jalan kaki (sudah dikoreksi tanjakan) + penalti menit untuk risiko sepanjang rute.
  const biaya = (r) => r.menit + biayaTambahan(r.tujuan)
    + r.zona.lereng * 10 + r.zona.sesar * 4 + r.zona.tsunami * 10 + r.jembatan.length * 3
    + (r.tanjakanMaks > 0.15 ? 4 : 0);
  for (const r of hasil) r.jauh = r.menit > maksMenit;
  // Tujuan yang terlalu jauh untuk dicapai segera hanya dipakai bila tidak ada yang lebih dekat.
  return hasil.sort((a, b) => (a.jauh - b.jauh) || (biaya(a) - biaya(b))).slice(0, 3);
}

// ---------- Rekomendasi ----------
function rekomendasi(k, rSegera, rUngsi) {
  const grup = [];
  const saat = [
    '<b>Merunduk, lindungi kepala & leher, bertahan</b> di bawah meja kokoh. Jangan berlari keluar selama guncangan: kebanyakan korban terkena benda jatuh di pintu dan tangga.',
    'Jauhi kaca, lemari, dan benda gantung. Bila di tempat tidur, tetap di sana dan lindungi kepala dengan bantal.',
  ];
  if (k.bangunan?.maks?.lantai >= 4) saat.push('Di gedung bertingkat: <b>jangan pakai lift</b>. Turun lewat tangga setelah guncangan berhenti.');
  saat.push('Bila di luar: menjauh dari gedung, tiang listrik, pohon, papan reklame. Bila berkendara: menepi, jangan berhenti di atas/bawah jembatan atau jalan layang.');
  grup.push({ judul: 'Saat guncangan', ikon: 'shield', butir: saat });

  const segera = [];
  if (k.ancamTsunami) {
    segera.push(`<b>Lokasi Anda di pesisir rendah.</b> Bila guncangan kuat (sulit berdiri) atau lama (&gt; 20 detik), <b>langsung ke tanah setinggi ≥ ${k.tinggiAman} m</b>, jangan menunggu sirene atau ke titik kumpul di dataran rendah${k.tibaTsunami ? `; gelombang dari zona subduksi bisa tiba ±${k.tibaTsunami} menit` : ''}.`);
  }
  segera.push('Setelah guncangan berhenti: matikan kompor & listrik utama, bawa tas siaga, pakai alas kaki (pecahan kaca), lalu keluar lewat tangga.');
  segera.push(rSegera ? `Jalan kaki ke <b>${esc(rSegera.tujuan.nama)}</b> (±${menit(rSegera.menit)} menit). Jangan pakai mobil: jalan perlu kosong untuk ambulans & pemadam.` : 'Cari halaman/lapangan atau jalan lebar terdekat yang berjarak lebih dari tinggi bangunan di sekitarnya.');
  segera.push('Bila mencium bau gas, jangan menyalakan api atau sakelar listrik. Jangan masuk kembali ke bangunan yang retak.');
  grup.push({ judul: 'Segera setelah guncangan', ikon: 'footprints', butir: segera });

  const jalan = [];
  if (k.sesar && k.sesar.km <= 2) jalan.push(`<b>${esc(k.sesar.nama)}</b> hanya ${fmtKm(k.sesar.km)} dari lokasi: jalan & tanah di jalurnya bisa retak/bergeser. Hindari melintasi jalurnya (garis ungu di peta).`);
  const jembatan = [...(rSegera?.jembatan || []), ...(rUngsi?.jembatan || [])];
  if (jembatan.length) jalan.push(`Rute melintasi ${jembatan.length} sungai${jembatan[0].nama ? ` (${esc(jembatan[0].nama)})` : ''}. <b>Periksa jembatan</b> (retak, amblas, oprit turun) sebelum menyeberang; pakai rute lain bila ragu.`);
  if ((rSegera?.zona.lereng || 0) + (rUngsi?.zona.lereng || 0) > 0.05) jalan.push('Sebagian rute melewati lereng curam: waspadai batu jatuh & longsor susulan, lewati cepat dan jangan berhenti di bawah tebing.');
  if (Math.max(rSegera?.tanjakanMaks || 0, rUngsi?.tanjakanMaks || 0) > 0.12) jalan.push(`Ada tanjakan ±${Math.round(Math.max(rSegera?.tanjakanMaks || 0, rUngsi?.tanjakanMaks || 0) * 100)}%: lansia, anak, dan penyandang disabilitas perlu bantuan & waktu lebih.`);
  if (k.hujan?.skorHujan >= 2) jalan.push('Sedang/baru hujan lebat: tanah jenuh air + guncangan = <b>longsor</b>. Jauhi tebing dan alur sungai kecil.');
  jalan.push('Waspadai kabel listrik putus, kaca & dinding pagar yang bisa roboh saat gempa susulan. Berjalan di tengah jalan bila aman.');
  if (new Date().getHours() >= 18 || new Date().getHours() < 6) jalan.push('Malam hari: bawa senter, jangan pakai lilin (risiko kebakaran bila ada kebocoran gas).');
  grup.push({ judul: 'Di perjalanan', ikon: 'route', butir: jalan });

  const ungsi = [];
  if (k.baruGempa) ungsi.push(`Baru terjadi gempa M${k.baruGempa.mag.toFixed(1)} (${fmtKm(k.baruGempa.jarak)}). <b>Gempa susulan</b> paling sering terjadi dalam 1–3 hari pertama.`);
  ungsi.push('Selama gempa susulan, tidur di luar atau di tenda bila bangunan retak. Masuk rumah hanya setelah diperiksa (kolom, balok, dinding retak diagonal = jangan masuk).');
  const liq = k.geologi?.likuefaksi;
  if (liq && liq.kerentanan <= 2) ungsi.push(`Lokasi Anda di <b>zona kerentanan likuefaksi ${NAMA_LIQ[Math.round(liq.kerentanan)]}</b>: waspadai tanah retak, amblas, atau semburan pasir & air. Jauhi area itu dan jangan kembali ke bangunan yang miring.`);
  else if (k.geologi?.tanahLunak) ungsi.push('Tanah di lokasi Anda lunak (endapan muda): guncangan diperkuat & bisa terjadi likuefaksi. Periksa bangunan lebih teliti.');
  if (k.rs) ungsi.push(`Rumah sakit terdekat: <b>${esc(k.rs.nama || 'tanpa nama')}</b> (${fmtKm(k.rs.jarak)}, ${arahKe(k.u.lat ?? 0, k.u.lon ?? 0, k.rs.lat, k.rs.lon)}). Darurat: <b>112</b>.`);
  ungsi.push('Kabari keluarga lewat SMS/WhatsApp (lebih andal dari telepon saat jaringan padat). Pantau info resmi di aplikasi <b>InfoBMKG</b> dan BPBD; abaikan hoaks "prediksi gempa".');
  grup.push({ judul: 'Di tempat pengungsian', ikon: 'tent', butir: ungsi });

  const siaga = [
    'Siapkan <b>tas siaga</b>: air minum 3 hari, makanan kering, obat rutin, P3K, senter, peluit, powerbank, masker, salinan dokumen, uang tunai.',
    'Ikat lemari/rak tinggi ke dinding, letakkan barang berat di rak bawah, ketahui letak meteran listrik & keran gas.',
    `Sepakati titik kumpul keluarga${rSegera ? ` (mis. <b>${esc(rSegera.tujuan.nama)}</b>)` : ''} dan latih rutenya, termasuk pada malam hari.`,
  ];
  if (k.kelasKrb && /tinggi|menengah/i.test(k.kelasKrb)) siaga.push(`Lokasi berada di <b>${esc(k.kelasKrb)}</b>: periksakan struktur rumah (kolom-balok beton bertulang, ikatan dinding) dan pertimbangkan retrofit.`);
  if (k.ancamTsunami) siaga.push(`Hafalkan jalur ke tanah tinggi ≥ ${k.tinggiAman} m yang bisa ditempuh &lt; ${k.tibaTsunami ? Math.min(15, k.tibaTsunami) : 15} menit jalan kaki.`);
  grup.push({ judul: 'Persiapan sebelum gempa', ikon: 'backpack', butir: siaga });
  return grup;
}

// ---------- Tampilan ----------
function htmlRute(r, tahap, ctx, k) {
  const t = r.tujuan;
  const gmaps = `https://www.google.com/maps/dir/?api=1&origin=${ctx.lat},${ctx.lon}&destination=${t.lat.toFixed(6)},${t.lon.toFixed(6)}&travelmode=walking`;
  const info = [];
  if (r.lurus) info.push(`<div class="hd-warn">Layanan rute tidak terjangkau: garis lurus hanya menunjukkan <b>arah ${arahKe(ctx.lat, ctx.lon, t.lat, t.lon)}</b>. Ikuti jalan terbesar ke arah itu; waktu & jarak hanya perkiraan.</div>`);
  if (tahap === 1 && r.jauh) info.push(`<div class="hd-warn">Tidak ada ruang terbuka terpetakan dalam ${MAKS_MENIT_SEGERA} menit jalan kaki. Untuk keadaan darurat, cari halaman, lapangan, atau jalan lebar terdekat yang jaraknya lebih dari tinggi bangunan di sekitarnya; tujuan ini untuk berkumpul setelahnya.</div>`);
  if (r.sisaKm > 0.03) info.push(`<div class="hd-info">Jalan berakhir ${fmtKm(r.sisaKm)} sebelum tujuan; lanjutkan berjalan (garis putus-putus).</div>`);
  if (r.jembatan.length) info.push(`<div class="hd-warn">Melintasi ${r.jembatan.length} sungai/kanal${r.jembatan[0].nama ? ` (${esc(r.jembatan[0].nama)})` : ''}. Periksa jembatan sebelum menyeberang.</div>`);
  if (r.zona.lereng > 0.05) info.push(`<div class="hd-warn">±${fmtKm(r.zona.lereng)} rute melewati lereng curam (rawan longsor/batu jatuh).</div>`);
  if (r.zona.sesar > 0.05) info.push(`<div class="hd-warn">±${fmtKm(r.zona.sesar)} rute berada ≤ 2 km dari sesar aktif; waspadai jalan retak.</div>`);
  if (k.ancamTsunami && r.zona.tsunami > 0.05) info.push(`<div class="hd-warn">±${fmtKm(r.zona.tsunami)} rute melewati zona genangan tsunami. Lewati secepatnya dan jangan berhenti di dataran rendah.</div>`);
  if (r.zona.sungai > 0.05) info.push(`<div class="hd-warn">±${fmtKm(r.zona.sungai)} rute melewati dataran rendah dekat sungai: waspadai tanah retak, amblas, atau semburan pasir (likuefaksi).</div>`);
  const koreksi = r.faktorMedan > 1.08 ? ` · +${Math.round((r.faktorMedan - 1) * 100)}% karena tanjakan` : '';

  const judul = tahap === 1
    ? `<span class="zchip" style="--c:${t.warna}">${esc(t.jenis)}</span> <b>${esc(t.nama)}</b>`
    : `<span class="zchip" style="--c:${WARNA_CSS[0]}">area ${NAMA_LEVEL[0].toLowerCase()}</span> <b>${t.tk ? esc(namaTitik(t.tk)) : t.fasilitas ? `Dekat ${esc(t.fasilitas.nama || 'fasilitas umum')}` : 'Area pengungsian'}</b>`;
  const alasan = tahap === 1
    ? `<ul class="hd-catatan">${t.catatan.map(([s, lv]) => `<li><i style="background:${WARNA_CSS[lv]}"></i>${esc(s)}</li>`).join('')}</ul>`
    : `<p class="meta">${esc(alasanUngsi(t, k.u, rencana.longgar))}${t.fasilitas && !t.tk ? `. ${esc(t.fasilitas.nama || 'Fasilitas umum')} ±${Math.round(jarakKm(t.lat, t.lon, t.fasilitas.lat, t.fasilitas.lon) * 1000)} m (air, toilet, atap)` : ''}.</p>`;

  return `
    <div class="hd-tujuan">${judul}${alasan}</div>
    <div class="hd-angka">
      <div><b>${menit(r.menit)}</b> menit<span>jalan kaki${koreksi}</span></div>
      <div><b>${fmtKm(r.jarakKm)}</b><span>rute (${arahKe(ctx.lat, ctx.lon, t.lat, t.lon)})</span></div>
      <div><b>${Number.isFinite(r.elevAwal) ? `${Math.round(r.elevAwal)}→${Math.round(r.elevAkhir)}` : '—'}</b> m<span>naik ${Math.round(r.naik)} m · tanjakan ${Math.round(r.tanjakanMaks * 100)}%</span></div>
    </div>
    ${grafikElevasi(r.sampel)}
    ${info.join('')}
    <div class="hd-aksi">
      <a class="btn-utama" href="${gmaps}" target="_blank" rel="noopener">Mulai navigasi</a>
      ${rencana.tahap[tahap].rute.length > 1 ? `<button type="button" data-alt>Tujuan lain (${rencana.tahap[tahap].indeks + 1}/${rencana.tahap[tahap].rute.length})</button>` : ''}
    </div>`;
}

function render(api) {
  const { ctx, k } = rencana;
  const panel = $('#hasil-darurat');
  const aktif = rencana.aktif;
  const tab = (id, label) => `<button type="button" role="tab" data-tahap="${id}" aria-selected="${aktif === id}">${label}</button>`;

  let isi = '';
  if (aktif === 'saran') {
    isi = rencana.saran.map((g) => `
      <h3 class="hd-sub"><i data-lucide="${g.ikon}"></i>${g.judul}</h3>
      <ul class="hd-saran">${g.butir.map((b) => `<li>${b}</li>`).join('')}</ul>`).join('');
  } else {
    const t = rencana.tahap[aktif];
    const r = t.rute[t.indeks];
    if (aktif === 1) {
      isi = '<p class="hd-arahan">Tujuan <b>begitu guncangan berhenti</b>: ruang terbuka terdekat, jauh dari bangunan, tiang, dan tebing. Tunggu di sini sampai situasi jelas.</p>';
    } else {
      isi = `<p class="hd-arahan">Tujuan untuk <b>mengungsi/bermalam</b> selama gempa susulan: area datar & kering di luar zona sesar, longsor, banjir/likuefaksi${k.ancamTsunami ? ', dan tsunami' : ''}.</p>`;
      if (t.sudahAman) isi += '<p class="hd-ok">✓ Lokasi Anda sendiri sudah memenuhi kriteria ini. Bila rumah rusak, cukup mengungsi di ruang terbuka terdekat.</p>';
      if (rencana.longgar && r) isi += '<div class="hd-info">Tidak ada area yang memenuhi semua kriteria; kriteria jarak dari sungai dilonggarkan.</div>';
    }
    isi += r ? htmlRute(r, aktif, ctx, k) : `<p>${t.pesan || 'Tidak ditemukan tujuan.'}</p>`;
    if (aktif === 1 && rencana.ditolak) isi += `<p class="meta muted">${rencana.ditolak} ruang terbuka terdekat dilewati karena di lereng/kaki tebing, jalur sesar${k.ancamTsunami ? ', atau zona tsunami' : ''}.</p>`;
  }

  const banner = [];
  if (k.ancamTsunami) {
    banner.push(`<div class="hd-warn"><b>Pesisir rendah — gempa kuat bisa memicu tsunami.</b> Bila guncangan kuat atau &gt; 20 detik, lewati titik kumpul dan langsung ke tanah ≥ ${k.tinggiAman} m.
      <div class="hd-aksi" style="margin-top:8px"><button type="button" data-tsunami>Rute ke tanah tinggi</button></div></div>`);
  }
  if (k.sesar && k.sesar.km <= 2) banner.push(`<div class="hd-warn">Anda ${fmtKm(k.sesar.km)} dari <b>${esc(k.sesar.nama)}</b>. Di jalur sesar, tanah dapat retak dan bergeser.</div>`);

  panel.innerHTML = `
    ${api.kepala(api.profil, 'Evakuasi Gempa')}
    ${banner.join('')}
    <div class="tabs hd-tabs" role="tablist">${tab(1, '1 Titik kumpul')}${tab(2, '2 Pengungsian')}${tab('saran', 'Saran')}</div>
    ${isi}
    <p class="meta muted">Dihitung otomatis dari DEM ±30 m, sesar Badan Geologi, dan OpenStreetMap; waktu jalan kaki dikoreksi tanjakan (Tobler). Utamakan jalur evakuasi resmi & arahan BPBD.</p>`;
  $('.hd-tutup', panel).onclick = api.tutup;
  panel.querySelectorAll('[data-tahap]').forEach((b) => b.addEventListener('click', () => {
    rencana.aktif = b.dataset.tahap === 'saran' ? 'saran' : +b.dataset.tahap;
    render(api);
  }));
  const alt = $('[data-alt]', panel);
  if (alt) alt.onclick = () => {
    const t = rencana.tahap[rencana.aktif];
    t.indeks = (t.indeks + 1) % t.rute.length;
    render(api);
  };
  const ts = $('[data-tsunami]', panel);
  if (ts) ts.onclick = () => api.jalankanDarurat('tsunami');
  renderIkon(panel);
  gambarPeta(aktif === 'saran' ? null : aktif);
}

function gambarPeta(fokus) {
  const { ctx } = rencana;
  lapisan.evakuasi.clearLayers();
  const titikBatas = [[ctx.lat, ctx.lon]];
  for (const tahap of [1, 2]) {
    const t = rencana.tahap[tahap];
    const r = t.rute[t.indeks];
    if (!r) continue;
    const utama = fokus == null || fokus === tahap;
    const warna = tahap === 1 ? '#16a34a' : '#2563eb';
    if (utama) L.polyline(r.garis, { color: '#fff', weight: 9, opacity: 0.9 }).addTo(lapisan.evakuasi);
    L.polyline(r.garis, { color: warna, weight: utama ? 5 : 3, opacity: utama ? 1 : 0.55, dashArray: utama && !r.lurus ? null : '6 6' }).addTo(lapisan.evakuasi);
    const akhir = r.garis[r.garis.length - 1];
    if (r.sisaKm > 0.03) L.polyline([akhir, [r.tujuan.lat, r.tujuan.lon]], { color: warna, weight: 3, dashArray: '4 6' }).addTo(lapisan.evakuasi);
    if (tahap === 2) L.circle([r.tujuan.lat, r.tujuan.lon], { radius: 150, color: warna, weight: 2, fillColor: warna, fillOpacity: 0.2 }).addTo(lapisan.evakuasi);
    L.marker([r.tujuan.lat, r.tujuan.lon], { icon: ikonTitik(tahap === 1 ? 'pin-aman' : 'pin-ungsi', tahap), zIndexOffset: utama ? 900 : 800 })
      .bindPopup(`<b>${tahap === 1 ? 'Titik kumpul segera' : 'Area pengungsian'}</b><br>${esc(r.tujuan.nama || (r.tujuan.fasilitas?.nama ?? ''))}<br>${menit(r.menit)} menit jalan kaki · ${fmtKm(r.jarakKm)}`)
      .addTo(lapisan.evakuasi);
    if (utama) {
      for (const j of r.jembatan) {
        L.circleMarker(j.titik, { radius: 6, color: '#fff', weight: 2, fillColor: '#ff9500', fillOpacity: 1 })
          .bindTooltip(`Penyeberangan sungai${j.nama ? `: ${esc(j.nama)}` : ''} — periksa jembatan`).addTo(lapisan.evakuasi);
      }
      titikBatas.push(...r.garis, [r.tujuan.lat, r.tujuan.lon]);
    }
  }
  if (titikBatas.length > 1) map.fitBounds(L.latLngBounds(titikBatas), { ...paddingPanel($('#hasil-darurat')), maxZoom: 17 });
}

// ---------- Alur ----------
/** Batalkan pencarian/rencana gempa (mis. pengguna beralih ke bencana lain atau menutup panel). */
export function batalGempa() {
  jalan++;
  rencana = null;
}

export async function jalankanEvakuasiGempa(api) {
  const id = ++jalan;
  const panel = $('#hasil-darurat');
  panel.hidden = false;
  panel.innerHTML = `${api.kepala(api.profil, 'Evakuasi Gempa')}<p class="muted" data-status>Menilai ruang terbuka, lereng, sesar, dan elevasi di sekitar…</p>`;
  $('.hd-tutup', panel).onclick = api.tutup;
  renderIkon(panel);
  turunkanSheet();
  pilihBahaya('gempa');
  const status = (s) => { const el = $('[data-status]', panel); if (el) el.textContent = s; };

  if (!api.konteks()) status('Menunggu analisis lokasi selesai…');
  const { ctx, hasil } = await api.tunggu();
  if (id !== jalan) return;
  const asal = [ctx.lat, ctx.lon];

  try {
    const osm = await ctx.osm.catch(() => null);
    const u0 = await nilaiDi(ctx.lat, ctx.lon);
    const u = u0 ? { lat: ctx.lat, lon: ctx.lon, elev: u0.elev, lereng: u0.lereng, lv: u0 } : { lat: ctx.lat, lon: ctx.lon };
    const k = kondisiLokasi(ctx, hasil, osm, u);
    k.gedung = osm?.bangunan || [];

    // Tahap 1 & grid tahap 2 dihitung bersamaan
    const [segera, grid] = await Promise.all([cariSegera(ctx, osm, k), evaluasiArea(ctx.lat, ctx.lon, R_UNGSI, LANGKAH_UNGSI)]);
    if (id !== jalan) return;

    let longgar = false;
    let ungsi = cariUngsi(grid, k, osm, false);
    if (!ungsi.kandidat.length) {
      longgar = true;
      ungsi = cariUngsi(grid, k, osm, true);
    }
    const sel0 = grid.ambil(0, 0);
    const sudahAman = !!sel0 && ungsi.aman(sel0);
    // Titik kumpul resmi/OSM/pribadi yang berada di sel aman ikut menjadi kandidat pengungsian.
    const kx = 111.32 * Math.cos((ctx.lat * Math.PI) / 180);
    const tkAman = titikKumpul().filter((t) => t.jenis !== 'potensial' && t.jarak <= R_UNGSI).map((t) => {
      const c = grid.ambil(Math.round(((t.lat - ctx.lat) * 110.57) / LANGKAH_UNGSI), Math.round(((t.lon - ctx.lon) * kx) / LANGKAH_UNGSI));
      return c && ungsi.aman(c) ? { ...c, lat: t.lat, lon: t.lon, jarak: t.jarak, tk: t, diAtasSungai: Number.isFinite(c.q?.er) && c.q.dr < 3 ? c.elev - c.q.er : null } : null;
    }).filter(Boolean).slice(0, 2);

    status('Menghitung rute jalan kaki & profil elevasi…');
    const sungai = osm?.sungai || [];
    const [ruteSegera, ruteUngsi] = await Promise.all([
      segera.layak.length ? ruteKe(asal, segera.layak, levelGempa, sungai, (t) => t.penalti - t.bonus, MAKS_MENIT_SEGERA) : [],
      ruteKe(asal, [...ungsi.kandidat, ...tkAman], levelUngsi, sungai, (t) => (t.fasilitas ? -5 : 0) - (t.tk ? JENIS[t.tk.jenis].bonus : 0)),
    ]);
    if (id !== jalan) return;

    rencana = {
      ctx, k, longgar,
      aktif: 1,
      ditolak: segera.ditolak.length,
      tahap: {
        1: { rute: ruteSegera, indeks: 0, pesan: segera.layak.length ? 'Layanan rute tidak dapat dihubungi.' : k.ancamTsunami && segera.ditolak.length ? 'Ruang terbuka terdekat berada di zona genangan tsunami. Gunakan tombol <b>Rute ke tanah tinggi</b> di atas.' : `Tidak ada ruang terbuka terpetakan yang aman dalam ${fmtKm(R_SEGERA)}. Cari halaman, lapangan, atau persimpangan jalan lebar yang jaraknya lebih dari tinggi bangunan di sekitarnya, jauh dari tiang listrik dan tembok pagar.` },
        2: { rute: ruteUngsi, indeks: 0, sudahAman, pesan: ungsi.kandidat.length ? 'Layanan rute tidak dapat dihubungi.' : `Tidak ditemukan area pengungsian yang aman dalam ${fmtKm(R_UNGSI)}. Ikuti arahan BPBD.` },
      },
    };
    rencana.saran = rekomendasi(k, ruteSegera[0], ruteUngsi[0]);
    if (!ruteSegera.length && ruteUngsi.length) rencana.aktif = 2;
    render(api);
  } catch (err) {
    if (id !== jalan) return;
    panel.innerHTML = `${api.kepala(api.profil, 'Evakuasi Gempa')}<p>${esc(err.message)}</p><p class="hd-arahan">${api.profil.arahan}</p>`;
    $('.hd-tutup', panel).onclick = api.tutup;
    renderIkon(panel);
  }
}
