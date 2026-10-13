// Kualitas udara: model CAMS lewat Open-Meteo Air Quality (bukan stasiun ukur).
import { getJson, setCard, fakta } from './util.js';

// Kategori mengikuti US AQI dengan label setara ISPU.
function kategori(aqi) {
  if (aqi <= 50) return { nama: 'Baik', level: 'rendah' };
  if (aqi <= 100) return { nama: 'Sedang', level: 'sedang' };
  if (aqi <= 150) return { nama: 'Tidak sehat (kelompok sensitif)', level: 'tinggi' };
  if (aqi <= 200) return { nama: 'Tidak sehat', level: 'tinggi' };
  if (aqi <= 300) return { nama: 'Sangat tidak sehat', level: 'bahaya' };
  return { nama: 'Berbahaya', level: 'bahaya' };
}

export async function muatUdara(ctx) {
  const { lat, lon } = ctx;
  const d = await getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}`
    + '&current=us_aqi,pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,ozone,sulphur_dioxide'
    + '&hourly=us_aqi,pm2_5&forecast_days=2&timezone=auto');
  if (ctx.batal()) return null;

  const c = d.current;
  const kat = kategori(c.us_aqi);
  const offset = d.utc_offset_seconds * 1000;
  const now = Date.now();
  let maks24 = { aqi: -1, jam: null };
  d.hourly.time.forEach((t, i) => {
    const ms = Date.parse(`${t}Z`) - offset;
    if (ms > now && ms <= now + 24 * 3600e3 && d.hourly.us_aqi[i] > maks24.aqi) maks24 = { aqi: d.hourly.us_aqi[i], jam: ms };
  });
  const katMaks = maks24.aqi >= 0 ? kategori(maks24.aqi) : null;
  // Pedoman WHO 2021: PM2.5 rata-rata 24 jam 15 µg/m³
  const kaliWho = c.pm2_5 / 15;

  let summary = `Indeks kualitas udara <b>${c.us_aqi}</b> — <b>${kat.nama}</b>. PM2.5 ${c.pm2_5.toFixed(0)} µg/m³ (${kaliWho >= 1.5 ? `${kaliWho.toFixed(1)}× ` : ''}${kaliWho >= 1 ? 'di atas' : 'di bawah'} pedoman WHO).`;
  if (katMaks && maks24.aqi > c.us_aqi + 20) {
    summary += ` Diperkirakan memburuk hingga <b>${maks24.aqi}</b> (${katMaks.nama}) sekitar ${new Date(maks24.jam).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}.`;
  }

  setCard('card-udara', {
    badge: kat.nama,
    level: kat.level,
    radius: 'Titik lokasi (resolusi model ±10–40 km)',
    summary,
    detail: `
      <div class="facts">
        ${fakta('PM2.5', `${c.pm2_5.toFixed(0)} µg/m³`, 'partikel halus (asap, kendaraan)')}
        ${fakta('PM10', `${c.pm10.toFixed(0)} µg/m³`, 'debu, abu vulkanik')}
        ${fakta('CO', `${Math.round(c.carbon_monoxide)} µg/m³`, 'karbon monoksida')}
        ${fakta('NO₂ · O₃ · SO₂', `${Math.round(c.nitrogen_dioxide)} · ${Math.round(c.ozone)} · ${Math.round(c.sulphur_dioxide)}`, 'µg/m³')}
      </div>
      <p class="meta muted">Data model atmosfer CAMS (Copernicus) lewat Open-Meteo, bukan stasiun ukur. Bandingkan dengan ISPU KLHK bila tersedia.</p>
      <ul class="tips">
        <li>AQI &gt; 100: kurangi aktivitas luar ruang untuk anak, lansia, dan penderita asma/jantung.</li>
        <li>AQI &gt; 150: pakai masker N95 di luar ruangan, gunakan penyaring udara di dalam rumah.</li>
      </ul>`,
  });

  return { level: kat.level, aqi: c.us_aqi, pm25: c.pm2_5 };
}
