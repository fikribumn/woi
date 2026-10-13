// Posisi vertikal pengguna (lantai / ketinggian) untuk saran darurat yang sesuai situasi.
// 1. Bila GPS memberi altitude yang cukup akurat: tinggi di atas tanah = altitude (dikoreksi geoid) − elevasi tanah.
// 2. Bila tidak ada: pengguna memilih lantai. Pilihan manual selalu menang atas perkiraan GPS.
import { esc, jarakKm, getJson } from './util.js';
import { sampelTitik } from './dem.js';

const TINGGI_LANTAI = 3.5; // m, rata-rata gedung kantor/apartemen
const MAKS_AKURASI = 20; // m; altitude yang lebih buruk dari ini tidak dipakai
const UMUR_MANUAL = 3 * 3600e3; // pilihan lantai dianggap basi setelah 3 jam
const KUNCI = 'posisi-lantai';

// Pilihan cepat. min dipakai untuk keputusan keselamatan (tsunami: anggap serendah mungkin),
// maks untuk perkiraan waktu turun.
const PILIHAN = [
  { label: 'Luar ruangan', min: 0, maks: 0 },
  { label: 'Lantai 1', min: 1, maks: 1 },
  { label: '2–3', min: 2, maks: 3 },
  { label: '4–6', min: 4, maks: 6 },
  { label: '7–10', min: 7, maks: 10 },
  { label: '11–20', min: 11, maks: 20 },
  { label: '21–40', min: 21, maks: 40 },
  { label: '> 40', min: 41, maks: 60 },
];

let gps = null; // { lat, lon, alt, akurasi, waktu }
let manual = bacaManual();
let info = null; // hasil perbaruiPosisi
let sedangUbah = false;
let geoid = null;

function bacaManual() {
  try {
    const m = JSON.parse(sessionStorage.getItem(KUNCI) || 'null');
    return m && Date.now() - m.waktu < UMUR_MANUAL ? m : null;
  } catch {
    return null;
  }
}

function simpanManual(m) {
  manual = m;
  try {
    if (m) sessionStorage.setItem(KUNCI, JSON.stringify(m));
    else sessionStorage.removeItem(KUNCI);
  } catch { /* penyimpanan tidak tersedia: cukup di memori */ }
}

/** Dipanggil saat GPS berhasil: simpan altitude (bila ada) beserta akurasinya. */
export function catatGps(coords) {
  gps = { lat: coords.latitude, lon: coords.longitude, alt: coords.altitude, akurasi: coords.altitudeAccuracy, waktu: Date.now() };
}

/** Ambil posisi GPS terbaru tanpa memunculkan permintaan izin baru (hanya bila izin sudah diberikan). */
export async function segarkanGps() {
  if (!navigator.geolocation) return;
  try {
    const izin = await navigator.permissions?.query({ name: 'geolocation' });
    if (izin && izin.state !== 'granted') return;
    const pos = await new Promise((ok, gagal) => navigator.geolocation.getCurrentPosition(ok, gagal, { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }));
    catatGps(pos.coords);
  } catch { /* tanpa GPS: pakai pilihan manual */ }
}

// Altitude W3C diukur dari elipsoid WGS84 (Android). Safari iOS memakai tinggi di atas permukaan laut.
const altitudeDiAtasLaut = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

async function tinggiGeoid(lat, lon) {
  geoid ||= getJson('data/geoid.json');
  const g = await geoid;
  const i = Math.round((g.lat0 - lat) / g.langkah);
  const j = Math.round((lon - g.lon0) / g.langkah);
  const v = g.data[i]?.[j];
  return v == null ? null : v / 10;
}

/**
 * Elevasi tanah. DEM di kota ikut mengukur atap bangunan & pohon, jadi ambil nilai terendah
 * dari titik itu dan empat titik ±100 m di sekitarnya.
 */
async function elevTanah(lat, lon) {
  const d = 0.1;
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  const titik = [[0, 0], [d / 110.57, 0], [-d / 110.57, 0], [0, d / kx], [0, -d / kx]];
  const e = (await Promise.all(titik.map(([a, b]) => sampelTitik(lat + a, lon + b, 14).then((s) => s.elev, () => NaN)))).filter(Number.isFinite);
  return e.length ? Math.min(...e) : null;
}

/** Gedung bertingkat OSM terdekat (≤ 40 m) sebagai petunjuk jumlah lantai. */
function gedungDi(lat, lon, osm) {
  return (osm?.bangunan || [])
    .map((g) => ({ ...g, m: jarakKm(lat, lon, g.lat, g.lon) * 1000 }))
    .filter((g) => g.m <= 40 && g.lantai >= 2)
    .sort((a, b) => a.m - b.m)[0] || null;
}

const tinggiDariLantai = (l) => Math.max(0, (l - 1) * TINGGI_LANTAI);

/** Hitung ulang posisi untuk lokasi analisis ctx. Hasil: infoPosisi(). */
export async function perbaruiPosisi(ctx, osm) {
  const tanah = await elevTanah(ctx.lat, ctx.lon).catch(() => null);
  const gedung = gedungDi(ctx.lat, ctx.lon, osm);
  const dasar = { tanah, gedung };
  manual = bacaManual();

  if (manual) {
    info = { ...dasar, sumber: 'manual', min: manual.min, maks: manual.maks, label: manual.label };
  } else if (gps && Number.isFinite(gps.alt) && (gps.akurasi == null || gps.akurasi <= MAKS_AKURASI)
    && jarakKm(gps.lat, gps.lon, ctx.lat, ctx.lon) <= 0.5 && tanah != null) {
    // GPS dipakai hanya bila lokasi yang dianalisis memang lokasi pengguna
    const n = altitudeDiAtasLaut() ? 0 : await tinggiGeoid(gps.lat, gps.lon).catch(() => null);
    if (n == null) {
      info = { ...dasar, sumber: null };
    } else {
      const diAtasTanah = Math.max(0, gps.alt - n - tanah);
      const lantai = diAtasTanah < 2 ? 1 : 1 + Math.round(diAtasTanah / TINGGI_LANTAI);
      const sel = Math.ceil((gps.akurasi ?? 15) / TINGGI_LANTAI);
      info = {
        ...dasar, sumber: 'gps', akurasi: gps.akurasi, diAtasTanahGps: diAtasTanah,
        min: Math.max(1, lantai - sel), maks: lantai + sel, lantai,
        label: lantai <= 1 ? 'permukaan tanah' : `±${lantai}`,
      };
    }
  } else {
    info = { ...dasar, sumber: null };
  }
  if (info.sumber) {
    info.diAtasTanah = tinggiDariLantai(info.min);
    info.dpl = tanah != null ? tanah + info.diAtasTanah : null;
  }
  return info;
}

export const infoPosisi = () => info;

// ---------- Tampilan ----------
function namaLantai(p) {
  if (p.maks === 0) return 'Luar ruangan';
  if (p.sumber === 'gps') return p.lantai <= 1 ? 'Di permukaan tanah' : `Lantai ±${p.lantai}`;
  return p.min === p.maks ? `Lantai ${p.min}` : `Lantai ${p.label}`;
}

/** Kartu posisi di atas panel darurat: ringkasan + tombol ubah, atau pemilih lantai. */
export function htmlPosisi() {
  const p = info;
  if (!p) return '';
  const petunjukGedung = p.gedung ? `<span class="meta">Peta: Anda di dekat <b>${esc(p.gedung.nama || 'gedung')}</b> (${p.gedung.lantai} lantai).</span>` : '';
  if (p.sumber && !sedangUbah) {
    const angka = p.maks === 0 ? 'di luar gedung'
      : `±${Math.round(p.sumber === 'gps' ? p.diAtasTanahGps : p.diAtasTanah)} m di atas tanah${p.dpl != null ? ` · ±${Math.round(p.sumber === 'gps' ? p.tanah + p.diAtasTanahGps : p.dpl)} m dpl` : ''}`;
    const asal = p.sumber === 'gps'
      ? `Dari altitude GPS${p.akurasi ? ` (±${Math.round(p.akurasi)} m ≈ ±${Math.ceil(p.akurasi / TINGGI_LANTAI)} lantai)` : ''}`
      : 'Dipilih manual';
    return `<div class="ps-kartu">
      <span class="ps-ikon"><i data-lucide="${p.maks === 0 ? 'trees' : 'building-2'}"></i></span>
      <div><b>${namaLantai(p)}</b><span>${angka}</span><span class="meta">${asal}</span></div>
      <button type="button" data-posisi-ubah>Ubah</button>
    </div>`;
  }
  const alasan = gps && !Number.isFinite(gps.alt) ? 'Perangkat tidak memberi data ketinggian.'
    : gps && gps.akurasi > MAKS_AKURASI ? `Ketinggian GPS kurang akurat (±${Math.round(gps.akurasi)} m).`
      : !gps ? 'Lokasi tidak dari GPS, jadi ketinggian tidak diketahui.' : '';
  return `<div class="ps-pilih">
    <b>Anda sedang di mana?</b>
    <span class="meta">${alasan} Pilih agar saran sesuai posisi Anda.</span>
    ${petunjukGedung}
    <div class="ps-chip">${PILIHAN.map((o, i) => `<button type="button" data-posisi="${i}" aria-pressed="${p.sumber === 'manual' && p.min === o.min && p.maks === o.maks}">${o.label}</button>`).join('')}</div>
    <form class="ps-tepat" data-posisi-form>
      <label>Lantai tepatnya <input type="number" name="lantai" min="1" max="200" inputmode="numeric" placeholder="mis. 30" value="${p.sumber && p.min === p.maks && p.min > 0 ? p.min : ''}"></label>
      <button type="submit">OK</button>
      ${p.sumber ? '<button type="button" data-posisi-batal>Batal</button>' : ''}
    </form>
  </div>`;
}

/** Pasang tombol pada kartu posisi. ubah() dipanggil setelah posisi berganti (untuk merender ulang panel). */
export function pasangPosisi(panel, ctx, osm, ubah) {
  const pilih = async (m) => {
    simpanManual(m && { ...m, waktu: Date.now() });
    sedangUbah = false;
    await perbaruiPosisi(ctx, osm);
    ubah();
  };
  panel.querySelector('[data-posisi-ubah]')?.addEventListener('click', () => { sedangUbah = true; ubah(); });
  panel.querySelector('[data-posisi-batal]')?.addEventListener('click', () => { sedangUbah = false; ubah(); });
  panel.querySelectorAll('[data-posisi]').forEach((b) => b.addEventListener('click', () => {
    const o = PILIHAN[+b.dataset.posisi];
    pilih({ label: o.label, min: o.min, maks: o.maks });
  }));
  panel.querySelector('[data-posisi-form]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = Math.round(+new FormData(e.target).get('lantai'));
    if (n >= 1 && n <= 200) pilih({ label: String(n), min: n, maks: n });
  });
}

// ---------- Saran sesuai posisi ----------
const menitTurun = (lantai) => [Math.max(1, Math.round(lantai * 0.3)), Math.max(2, Math.round(lantai * 1))];

/**
 * Saran untuk posisi saat ini. x.tinggiAman = elevasi aman tsunami (m dpl).
 * Hasil: { nada: 'ok' | 'warn' | 'info', judul, butir[], tetapDiAtas } atau null bila posisi tidak mengubah saran.
 */
export function saranPosisi(idBahaya, x = {}) {
  const p = info;
  if (!p?.sumber || p.maks <= 1 || (p.sumber === 'gps' && p.lantai <= 1)) return null;
  const nama = namaLantai(p).toLowerCase();

  if (idBahaya === 'gempa') {
    const turun = p.sumber === 'gps' ? p.lantai : p.maks;
    const [cepat, lambat] = menitTurun(turun);
    const butir = [
      '<b>Saat guncangan:</b> jangan lari ke tangga atau lift. Merunduk di bawah meja kokoh, lindungi kepala, jauhi jendela & dinding kaca luar.',
    ];
    if (p.maks >= 10) butir.push('Di lantai atas, gedung tinggi bergoyang <b>lebih lama dan lebih jauh</b>. Itu wajar. Benda yang tidak terikat bisa bergeser; jauhi lemari dan rak.');
    butir.push('<b>Setelah guncangan:</b> jangan pakai lift (bisa macet dan Anda terjebak). Tunggu arahan pengelola gedung / petugas lantai. Turun tergesa-gesa di tangga yang penuh saat gempa susulan juga berbahaya.');
    butir.push('<b>Turun segera lewat tangga darurat bila:</b> ada api atau asap, bau gas, retak besar di kolom/balok, atau ada perintah evakuasi.');
    butir.push(`Turun ${p.sumber === 'gps' ? '±' : ''}${turun} lantai butuh ±${cepat}–${lambat} menit. Pakai alas kaki, bawa senter/HP & air, pegang pegangan tangga, jangan berlari, beri jalan petugas yang naik.`);
    butir.push('Sampai di bawah: <b>segera menjauh dari gedung</b> (kaca dan panel fasad bisa jatuh), lalu ke titik kumpul di tab 1.');
    return { nada: 'info', judul: `Anda di ${nama}`, butir };
  }

  if (idBahaya === 'tsunami') {
    const batas = x.tinggiAman ?? 20;
    if (p.min >= 3 && p.dpl != null && p.dpl >= batas) {
      return {
        nada: 'ok', tetapDiAtas: true, judul: `Tetap di atas: ${nama} sudah aman dari tsunami`,
        butir: [
          `Posisi Anda ±${Math.round(p.dpl)} m di atas permukaan laut, di atas batas aman ±${batas} m. <b>Jangan turun ke jalan</b>: arus tsunami di permukaan sangat deras dan membawa puing.`,
          'Berlaku bila gedung beton bertulang dan <b>tidak rusak berat</b> oleh gempa. Bila ada retak besar di kolom/balok, turun dan ikuti rute ke tanah tinggi di bawah.',
          'Jauhi sisi gedung yang menghadap laut. Tetap di atas sampai BMKG menyatakan aman: gelombang bisa datang berkali-kali selama beberapa jam.',
        ],
      };
    }
    if (p.tanah != null) {
      // Lantai ≥ 3 gedung beton = batas minimum evakuasi vertikal (TES); ideal setinggi batas aman daratan.
      const ideal = Math.max(3, 1 + Math.ceil((batas - p.tanah) / TINGGI_LANTAI));
      const butir = p.min >= 3
        ? [
          `Lantai ≥ 3 gedung beton sudah memenuhi batas minimum evakuasi vertikal, tetapi posisi Anda (±${Math.round(p.dpl)} m dpl) masih di bawah batas aman ±${batas} m. <b>Naik lebih tinggi bila bisa</b>, idealnya lantai ${ideal} atau atap.`,
          'Jangan turun ke jalan bila gelombang mungkin sudah dekat. Turun hanya bila gedung rusak berat.',
        ]
        : [
          `<b>Naik ke lantai 3 atau lebih</b> di gedung beton yang kokoh; idealnya lantai ${ideal} atau atap (±${batas} m dpl).`,
          'Bila gedung tidak cukup tinggi dan rute di bawah sempat ditempuh sebelum gelombang tiba, segera turun dan ikuti rute ke tanah tinggi.',
        ];
      return { nada: 'warn', judul: p.min >= 3 ? 'Naik lebih tinggi bila bisa' : `${namaLantai(p)} belum cukup tinggi`, butir };
    }
    return null;
  }

  if (idBahaya === 'banjir') {
    return {
      nada: 'ok', tetapDiAtas: true, judul: `Tetap di ${nama}`,
      butir: [
        'Di lantai atas Anda aman dari genangan. <b>Jangan turun ke basement atau parkiran bawah tanah</b>: cepat tergenang dan berisiko tersengat listrik.',
        'Matikan listrik lantai bawah bila aman. Siapkan air minum, makanan, obat, dan HP terisi penuh.',
        'Evakuasi (rute di bawah) hanya bila air terus naik mendekati lantai Anda atau diminta petugas.',
      ],
    };
  }

  if (idBahaya === 'gunung' || idBahaya === 'kebakaran') {
    return {
      nada: 'info', judul: `Anda di ${nama}`,
      butir: [
        `Tutup jendela dan matikan AC yang mengambil udara luar; ${idBahaya === 'gunung' ? 'abu vulkanik' : 'asap'} masuk lewat ventilasi.`,
        'Bila harus mengungsi (rute di bawah), turun lewat tangga. Lift bisa mati saat listrik padam.',
      ],
    };
  }
  return null;
}

export function htmlSaranPosisi(s) {
  if (!s) return '';
  const kelas = s.nada === 'ok' ? 'hd-ok' : s.nada === 'warn' ? 'hd-warn' : 'hd-info';
  return `<div class="${kelas} ps-saran"><b>${s.judul}</b><ul>${s.butir.map((b) => `<li>${b}</li>`).join('')}</ul></div>`;
}
