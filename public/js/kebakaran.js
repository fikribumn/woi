// Kebakaran hutan/lahan: titik panas satelit (NASA FIRMS), arah angin (asap), dan kondisi kekeringan.
import { esc, jarakKm, bearing, arahKe, namaArah, selisihSudut, fmtKm, fmtTanggal, waktuRelatif, getJson, setCard, fakta } from './util.js';
import { RADIUS } from './config.js';
import { lapisan, garisJarak } from './peta.js';
import { ringkasHujan } from './hujan.js';

const L = window.L;

export async function muatKebakaran(ctx) {
  const { lat, lon } = ctx;
  const [apiR, cuacaR] = await Promise.allSettled([getJson(`/api/titik-api?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&r=${RADIUS.kebakaran.km}`, { timeout: 90000 }), ctx.cuaca]);
  if (ctx.batal()) return null;
  if (apiR.status === 'rejected') throw new Error(`Data titik api: ${apiR.reason.message}`);

  const titik = apiR.value.titik
    .map(([tLat, tLon, frp, conf, waktu, sat]) => ({ lat: tLat, lon: tLon, frp, conf, waktu, sat, jarak: jarakKm(lat, lon, tLat, tLon) }))
    .filter((t) => t.jarak <= RADIUS.kebakaran.km)
    .sort((a, b) => a.jarak - b.jarak);

  for (const t of titik) {
    L.circleMarker([t.lat, t.lon], {
      radius: Math.min(9, 3 + Math.sqrt(t.frp || 1) / 2), color: '#b45309', weight: 1,
      fillColor: t.conf === 'high' || t.conf === 'h' ? '#dc2626' : '#f59e0b', fillOpacity: 0.75,
    })
      .bindPopup(`<b>Titik panas</b><br>${fmtTanggal(t.waktu)} (${waktuRelatif(t.waktu)})<br>Kepercayaan: ${esc(t.conf)} · FRP ${t.frp} MW<br>Jarak ${fmtKm(t.jarak)} · satelit ${esc(t.sat)}`)
      .addTo(lapisan.api);
  }

  const cuaca = cuacaR.status === 'fulfilled' ? cuacaR.value : null;
  const kini = cuaca?.current;
  const h = cuaca ? ringkasHujan(cuaca) : null;
  const kering = h && h.lalu7h < 5 && kini && kini.relative_humidity_2m < 70;

  // Asap: titik api yang berada di arah datangnya angin (±40°) dalam 100 km
  const asalAngin = kini?.wind_direction_10m;
  const hulu = kini && kini.wind_speed_10m >= 3
    ? titik.filter((t) => selisihSudut(asalAngin, bearing(lat, lon, t.lat, t.lon)) <= 40)
    : [];

  const n10 = titik.filter((t) => t.jarak <= 10).length;
  const n50 = titik.filter((t) => t.jarak <= 50).length;
  const terdekat = titik[0] || null;
  if (terdekat) garisJarak([lat, lon], [terdekat.lat, terdekat.lon], '#f59e0b', `Titik api terdekat: ${fmtKm(terdekat.jarak)}`);

  let level = 'rendah';
  if (n10 >= 1 || (n50 >= 10 && hulu.length >= 5)) level = 'tinggi';
  else if (n50 >= 3 || hulu.length >= 5) level = 'sedang';
  if (terdekat && terdekat.jarak <= 3) level = 'bahaya';
  if (level === 'rendah' && kering) level = 'sedang';
  const badge = { rendah: 'Rendah', sedang: 'Waspada', tinggi: 'Tinggi', bahaya: 'Sangat dekat' }[level];

  let summary = titik.length
    ? `<b>${titik.length}</b> titik panas terdeteksi satelit dalam radius ${RADIUS.kebakaran.km} km (48 jam terakhir); terdekat <b>${fmtKm(terdekat.jarak)}</b> ke arah ${arahKe(lat, lon, terdekat.lat, terdekat.lon)}.`
    : `Tidak ada titik panas dalam radius ${RADIUS.kebakaran.km} km selama 48 jam terakhir.`;
  if (hulu.length) summary += ` <b>${hulu.length}</b> titik berada di arah datangnya angin, sehingga <b>asap berpotensi terbawa ke lokasi Anda</b>.`;
  if (kering) summary += ' Kondisi sedang kering (hujan 7 hari &lt; 5 mm) — lahan mudah terbakar.';

  setCard('card-kebakaran', {
    badge,
    level,
    radius: `Radius ${RADIUS.kebakaran.km} km`,
    summary,
    detail: `
      <div class="facts">
        ${fakta('Titik panas ≤ 10 km', n10)}
        ${fakta('Titik panas ≤ 50 km', n50)}
        ${fakta('Angin', kini ? `${Math.round(kini.wind_speed_10m)} km/j` : '—', kini ? `dari ${namaArah(kini.wind_direction_10m)}` : '')}
        ${fakta('Kelembapan · hujan 7 hari', kini ? `${kini.relative_humidity_2m}%` : '—', h ? `${h.lalu7h.toFixed(0)} mm` : '')}
      </div>
      <p class="meta muted">Titik panas = anomali suhu dari satelit VIIRS; sebagian bisa berupa pembakaran terkendali atau industri. ${esc(apiR.value.sumber)}.</p>
      <ul class="tips">
        <li>Jangan membakar sampah/lahan saat musim kering. Laporkan kebakaran ke 112 / Manggala Agni / BPBD.</li>
        <li>Saat asap tebal: tetap di dalam ruangan, tutup jendela, pakai masker N95.</li>
      </ul>`,
  });

  return { level, terdekat, hulu: hulu.length, asalAngin, titik };
}
