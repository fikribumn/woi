// Tsunami: jarak ke garis pantai (OSM), elevasi, KRB tsunami (Badan Geologi), dan jarak ke zona subduksi.
import { esc, getJson, setCard, fakta, fmtKm, jarakKeGaris, arahKe, levelMaks } from './util.js';
import { RADIUS } from './config.js';
import { garisJarak } from './peta.js';

export async function muatTsunami(ctx) {
  const { lat, lon } = ctx;
  const [osmR, gridR, geoR, subR, cuacaR] = await Promise.allSettled([
    ctx.osm, ctx.gridLokal, ctx.geologi, getJson('data/subduksi.json'), ctx.cuaca,
  ]);
  if (ctx.batal()) return null;
  if (osmR.status === 'rejected') throw new Error(`Data garis pantai (OpenStreetMap) gagal: ${osmR.reason.message}`);

  const pantai = osmR.value.pantai.length ? jarakKeGaris(lat, lon, osmR.value.pantai) : null;
  const elev = gridR.status === 'fulfilled' ? gridR.value.pusat.elev : cuacaR.status === 'fulfilled' ? cuacaR.value.elevation : null;
  const krb = geoR.status === 'fulfilled' && Array.isArray(geoR.value.krb_tsunami) ? geoR.value.krb_tsunami[0] : null;
  const sub = subR.status === 'fulfilled' ? jarakKeGaris(lat, lon, subR.value.segmen) : null;

  if (pantai) garisJarak([lat, lon], pantai.titik, '#0ea5e9', `Garis pantai: ${fmtKm(pantai.km)}`);

  let level = 'rendah';
  let summary;
  if (!pantai) {
    summary = `Tidak ada garis pantai dalam radius ${RADIUS.tsunami.km} km — lokasi di luar jangkauan tsunami.`;
  } else {
    if (elev != null && elev >= 30) level = 'rendah';
    else if (pantai.km <= 1 && (elev == null || elev < 10)) level = 'tinggi';
    else if (pantai.km <= 3 && (elev == null || elev < 20)) level = 'sedang';
    else if (pantai.km <= 5 && elev != null && elev < 10) level = 'sedang';
    // Sumber tsunami besar (megathrust) dekat menaikkan satu tingkat
    if (sub && sub.km <= 350 && level !== 'rendah') level = level === 'sedang' ? 'tinggi' : 'bahaya';
    summary = `Lokasi <b>${fmtKm(pantai.km)}</b> dari garis pantai (arah ${arahKe(lat, lon, ...pantai.titik)}) pada elevasi ±${elev != null ? Math.round(elev) : '?'} m.`;
    if (level === 'rendah') summary += ' Elevasi/jarak cukup aman dari genangan tsunami pada umumnya.';
    else summary += ' Jika terjadi gempa kuat atau air laut surut tiba-tiba, <b>segera evakuasi</b> ke tempat tinggi (≥ 20–30 m) atau gedung tinggi yang kokoh.';
    if (sub && sub.km <= 350) summary += ` Zona subduksi berjarak ${fmtKm(sub.km)} — tsunami dapat tiba dalam <b>hitungan menit</b> setelah gempa.`;
  }
  if (krb) {
    const lvKrb = /tinggi/i.test(krb.unsur) ? 'bahaya' : /menengah/i.test(krb.unsur) ? 'tinggi' : 'sedang';
    level = levelMaks(level, lvKrb);
    summary += ` Menurut Badan Geologi lokasi masuk <b>${esc(krb.unsur)}</b>.`;
  }
  const badge = { rendah: 'Rendah', sedang: 'Sedang', tinggi: 'Tinggi', bahaya: 'Sangat tinggi' }[level];

  setCard('card-tsunami', {
    badge,
    level,
    radius: `Radius ${RADIUS.tsunami.km} km dari pantai`,
    summary,
    detail: `
      <div class="facts">
        ${fakta('Garis pantai terdekat', pantai ? fmtKm(pantai.km) : `> ${RADIUS.tsunami.km} km`)}
        ${fakta('Elevasi lokasi', elev != null ? `${Math.round(elev)} m` : '—', 'DEM ±90 m')}
        ${fakta('Zona subduksi', sub ? fmtKm(sub.km) : '—', sub ? `arah ${arahKe(lat, lon, ...sub.titik)}` : '')}
        ${fakta('KRB tsunami resmi', krb ? esc(krb.unsur.replace('Kawasan Rawan Bencana Tsunami ', '')) : 'tidak tercakup', krb ? esc(krb.provinsi || '') : 'peta resmi baru mencakup sebagian pesisir')}
      </div>
      ${krb?.keterangan ? `<p class="meta">${esc(krb.keterangan)}</p>` : ''}
      <ul class="tips">
        <li>Tanda alam: gempa kuat/lama, air laut surut mendadak, suara gemuruh dari laut — jangan tunggu sirene.</li>
        <li>Evakuasi berjalan kaki/motor menjauhi pantai dan naik ke tempat tinggi; jangan kembali sebelum ada pernyataan aman dari BMKG.</li>
      </ul>`,
  });

  return { level, pantai, elev, sub, krb, pesisir: !!pantai && pantai.km <= 5 && (elev == null || elev < 30) };
}
