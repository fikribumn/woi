// Membuat public/data/geoid.json: tinggi geoid EGM96 (N, meter) di wilayah Indonesia, grid 0,25°.
// Dipakai untuk mengubah altitude GPS (tinggi di atas elipsoid WGS84, mis. di Android) menjadi
// tinggi di atas permukaan laut (H = h − N), agar bisa dibandingkan dengan elevasi DEM.
// Sumber: GeographicLib geoids-distrib/egm96-15.pgm (domain publik).
//   Unduh & ekstrak egm96-15.zip dari https://sourceforge.net/projects/geographiclib/files/geoids-distrib/
// Pakai: node tools/buat-geoid.js path/ke/egm96-15.pgm
const fs = require('fs');
const path = require('path');

const BBOX = { minLon: 94, maxLon: 142, minLat: -12, maxLat: 7 };
const berkas = process.argv[2];
if (!berkas) throw new Error('Pakai: node tools/buat-geoid.js path/ke/egm96-15.pgm');

const buf = fs.readFileSync(berkas);
// Header PGM (P5) GeographicLib: komentar "# Offset" dan "# Scale", lalu lebar tinggi, lalu nilai maks.
let pos = 0;
const baris = [];
while (baris.filter((b) => !b.startsWith('#')).length < 3) {
  const akhir = buf.indexOf(0x0a, pos);
  baris.push(buf.toString('latin1', pos, akhir).trim());
  pos = akhir + 1;
}
const offset = parseFloat(baris.find((b) => b.startsWith('# Offset')).split(/\s+/)[2]);
const skala = parseFloat(baris.find((b) => b.startsWith('# Scale')).split(/\s+/)[2]);
const [lebar, tinggi] = baris.filter((b) => !b.startsWith('#'))[1].split(/\s+/).map(Number);
const res = 360 / lebar; // derajat per sel; baris 0 = lintang 90°, kolom 0 = bujur 0°
const nilai = (lat, lon) => {
  const i = Math.round((90 - lat) / res);
  const j = Math.round((((lon % 360) + 360) % 360) / res);
  return offset + skala * buf.readUInt16BE(pos + 2 * (i * lebar + j));
};

const data = [];
for (let lat = BBOX.maxLat; lat >= BBOX.minLat; lat -= res) {
  const row = [];
  for (let lon = BBOX.minLon; lon <= BBOX.maxLon + 1e-9; lon += res) row.push(Math.round(nilai(lat, lon) * 10)); // desimeter
  data.push(row);
}
const keluar = {
  sumber: 'EGM96 (GeographicLib egm96-15), domain publik',
  satuan: 'desimeter',
  lat0: BBOX.maxLat, lon0: BBOX.minLon, langkah: res,
  data,
};
const tujuan = path.join(__dirname, '..', 'public', 'data', 'geoid.json');
fs.writeFileSync(tujuan, JSON.stringify(keluar));
console.log(`${tujuan}: ${data.length}×${data[0].length} titik, ${(fs.statSync(tujuan).size / 1024).toFixed(0)} KB (grid ${lebar}×${tinggi})`);
