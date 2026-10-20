// Pemantau latar belakang aplikasi Android (Capacitor Background Runner).
// Berjalan di mesin JavaScript terpisah tanpa DOM, ±15 menit sekali walau aplikasi ditutup (jadwal diatur
// Android dan bisa lebih jarang saat hemat baterai). Memeriksa BMKG dan mengirim notifikasi bila gempa baru
// diperkirakan terasa di lokasi terakhir pengguna atau berpotensi tsunami untuk lokasi pesisir.
// Penilaian disalin dari js/pantau.js dan js/gempa.js (runner tidak bisa mengimpor modul).

const SUMBER = [
  'https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json',
  'https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json',
];
const UMUR_MAKS = 60 * 60e3;

function bacaKV(kunci, cadangan) {
  try {
    const v = CapacitorKV.get(kunci);
    return v && v.value ? JSON.parse(v.value) : cadangan;
  } catch {
    return cadangan;
  }
}
const tulisKV = (kunci, nilai) => CapacitorKV.set(kunci, JSON.stringify(nilai));

function tandai(id) {
  tulisKV('sudah', [...bacaKV('sudah', []), id].slice(-50));
}

function jarakKm(lat1, lon1, lat2, lon2) {
  const r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function perkiraanMMI(mag, jarakHiposenterKm) {
  const R = Math.sqrt(jarakHiposenterKm ** 2 + 14 ** 2);
  const B = Math.max(0, Math.log10(R / 50));
  const mmi = 12.27 + 2.27 * (mag - 6) + 0.1304 * (mag - 6) ** 2 - 1.3 * Math.log10(R) - 0.000707 * R + 1.95 * B - 0.577 * mag * Math.log10(R);
  return Math.max(1, Math.min(12, mmi));
}

const idKejadian = (g) => `${g.waktu}|${g.lat.toFixed(2)}|${g.lon.toFixed(2)}`;

async function ambilGempa() {
  const daftar = [];
  for (const url of SUMBER) {
    try {
      const res = await fetch(url);
      const j = await res.json();
      const list = Array.isArray(j.Infogempa.gempa) ? j.Infogempa.gempa : [j.Infogempa.gempa];
      for (const g of list) {
        const [lat, lon] = g.Coordinates.split(',').map(Number);
        daftar.push({ waktu: Date.parse(g.DateTime), lat, lon, mag: parseFloat(g.Magnitude), kedalaman: parseFloat(g.Kedalaman), tempat: g.Wilayah, potensi: g.Potensi || '' });
      }
    } catch (e) {
      console.log(`[pantau-gempa] gagal ${url}: ${e}`);
    }
  }
  return daftar.filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.mag));
}

async function cekGempa() {
  const lokasi = bacaKV('lokasi', null);
  if (!lokasi) return;
  const sudah = new Set(bacaKV('sudah', []));
  const baru = [];
  for (const g of await ambilGempa()) {
    const id = idKejadian(g);
    if (Date.now() - g.waktu > UMUR_MAKS || sudah.has(id)) continue;
    const jarak = jarakKm(lokasi.lat, lokasi.lon, g.lat, g.lon);
    const mmi = perkiraanMMI(g.mag, Math.sqrt(jarak ** 2 + (g.kedalaman || 10) ** 2));
    const tsunami = /tsunami/i.test(g.potensi) && !/tidak/i.test(g.potensi) && lokasi.pesisir && jarak <= 600;
    if (!tsunami && mmi < 4) continue;
    baru.push({ ...g, id, jarak, mmi, tsunami });
  }
  baru.sort((a, b) => b.tsunami - a.tsunami || b.mmi - a.mmi);
  for (const d of baru) tandai(d.id);
  const d = baru[0];
  if (!d) return;
  const judul = d.tsunami ? 'POTENSI TSUNAMI' : d.mmi >= 6 ? 'GEMPA KUAT' : 'GEMPA TERASA';
  CapacitorNotifications.schedule([{
    id: Math.floor(d.waktu / 1000) % 2147483647,
    title: `${judul}: M${d.mag.toFixed(1)}`,
    body: `${d.tempat} · ${Math.round(d.jarak)} km dari ${lokasi.label || 'lokasi Anda'}. Buka aplikasi untuk langkah evakuasi.`,
    autoCancel: true,
  }]);
}

addEventListener('cekGempa', async (resolve, reject) => {
  try {
    await cekGempa();
    resolve();
  } catch (e) {
    console.log(`[pantau-gempa] ${e}`);
    reject(e);
  }
});

addEventListener('aturLokasi', (resolve, reject, args) => {
  try {
    tulisKV('lokasi', { lat: args.lat, lon: args.lon, label: args.label, pesisir: args.pesisir });
    resolve();
  } catch (e) {
    reject(e);
  }
});

addEventListener('tandai', (resolve, reject, args) => {
  try {
    tandai(args.id);
    resolve();
  } catch (e) {
    reject(e);
  }
});
