// Ringkasan jarak dari lokasi ke tiap sumber bahaya, dibandingkan dengan jarak pengaruhnya.
import { esc, arahKe, fmtKm, $ } from './util.js';
import { RADIUS_BAHAYA_GUNUNG, LEVEL_GUNUNG } from './config.js';
import { map } from './peta.js';

const nilai = (r) => (r?.status === 'fulfilled' ? r.value : null);

export async function muatJarak(ctx, hasil) {
  const g = nilai(hasil.gempa);
  const gn = nilai(hasil.gunung);
  const kb = nilai(hasil.kebakaran);
  const hj = nilai(hasil.hujan);
  const ts = nilai(hasil.tsunami);
  let grid = null;
  try { grid = await ctx.gridLokal; } catch { /* abaikan */ }
  if (ctx.batal()) return;

  const curam = grid?.titik.filter((t) => t.lereng >= 25).sort((a, b) => a.jarak - b.jarak)[0] || null;

  // [ikon (tidak ditampilkan), sumber, nama, km, [lat,lon], ambangPengaruhKm, keteranganPengaruh]
  const baris = [
    g?.sesarTerdekat && ['〰️', 'Sesar aktif', g.sesarTerdekat.nama, g.sesarTerdekat.km, g.sesarTerdekat.titik, 10, 'guncangan sangat kuat & rekahan ≤ 10 km'],
    g?.subduksiTerdekat && ['🌐', 'Zona subduksi (megathrust)', 'Batas lempeng', g.subduksiTerdekat.km, g.subduksiTerdekat.titik, 250, 'gempa besar & tsunami ≤ 250 km'],
    g?.gempaTerdekat && ['🔴', 'Episenter terdekat (7 hari)', `M${g.gempaTerdekat.mag.toFixed(1)} ${g.gempaTerdekat.tempat}`, g.gempaTerdekat.jarak, [g.gempaTerdekat.lat, g.gempaTerdekat.lon], 50, 'terasa kuat ≤ 50 km (M5)'],
    gn?.terdekatAktif && ['🌋', 'Gunung api aktif (≥ Waspada)', `${gn.terdekatAktif.nama} – ${LEVEL_GUNUNG[gn.terdekatAktif.level].nama}`, gn.terdekatAktif.jarak, [gn.terdekatAktif.lat, gn.terdekatAktif.lon], RADIUS_BAHAYA_GUNUNG[gn.terdekatAktif.level], `radius bahaya ±${RADIUS_BAHAYA_GUNUNG[gn.terdekatAktif.level]} km`],
    gn?.terdekat && gn.terdekat !== gn.terdekatAktif && ['⛰️', 'Gunung api terdekat', `${gn.terdekat.nama} – ${LEVEL_GUNUNG[gn.terdekat.level].nama}`, gn.terdekat.jarak, [gn.terdekat.lat, gn.terdekat.lon], RADIUS_BAHAYA_GUNUNG[gn.terdekat.level], gn.terdekat.level >= 2 ? `radius bahaya ±${RADIUS_BAHAYA_GUNUNG[gn.terdekat.level]} km` : 'status Normal'],
    kb?.terdekat && ['🔥', 'Titik api (48 jam)', `FRP ${kb.terdekat.frp} MW`, kb.terdekat.jarak, [kb.terdekat.lat, kb.terdekat.lon], 10, 'ancaman api & asap pekat ≤ 10 km'],
    hj?.sungai && ['🏞️', 'Sungai', hj.sungai.nama || 'tanpa nama', hj.sungai.km, hj.sungai.titik, 0.3, 'dataran banjir ≤ 300 m'],
    ts?.pantai && ['🌊', 'Garis pantai', 'Laut', ts.pantai.km, ts.pantai.titik, 3, 'genangan tsunami umumnya ≤ 3 km'],
    curam && ['⛰', 'Lereng curam (≥ 25°)', `kemiringan ±${Math.round(curam.lereng)}°`, curam.jarak, [curam.lat, curam.lon], 0.5, 'jangkauan longsoran ≤ 500 m'],
  ].filter(Boolean).sort((a, b) => (a[3] / Math.max(a[5], 0.1)) - (b[3] / Math.max(b[5], 0.1)));

  const card = document.getElementById('card-jarak');
  $('[data-badge]', card).textContent = `${baris.filter((b) => b[3] <= b[5]).length} dalam jangkauan`;
  $('[data-badge]', card).dataset.level = baris.some((b) => b[3] <= b[5]) ? 'tinggi' : 'rendah';
  $('[data-summary]', card).innerHTML = 'Diurutkan dari yang paling dekat relatif terhadap jarak pengaruhnya. Baris merah = lokasi Anda berada di dalam jangkauan pengaruh sumber tersebut. Klik baris untuk melihatnya di peta.';
  $('[data-detail]', card).innerHTML = baris.length ? `
    <div class="table-wrap"><table class="tabel">
      <thead><tr><th>Sumber bahaya</th><th>Jarak</th><th>Arah</th><th>Jangkauan pengaruh</th></tr></thead>
      <tbody>${baris.map((b, i) => `
        <tr data-i="${i}" class="${b[3] <= b[5] ? 'dalam' : ''}">
          <td><b>${esc(b[1])}</b><div class="meta">${esc(b[2])}</div></td>
          <td class="num">${fmtKm(b[3])}</td>
          <td>${arahKe(ctx.lat, ctx.lon, ...b[4])}</td>
          <td class="meta">${esc(b[6])}</td>
        </tr>`).join('')}</tbody>
    </table></div>` : '<p class="muted">Belum ada data jarak.</p>';
  card.querySelectorAll('tr[data-i]').forEach((tr) => tr.addEventListener('click', () => {
    const b = baris[+tr.dataset.i];
    map.fitBounds([[ctx.lat, ctx.lon], b[4]], { padding: [40, 40], maxZoom: 14 });
    document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
}
