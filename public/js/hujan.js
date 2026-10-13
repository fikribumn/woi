// Hujan, longsor, dan banjir: curah hujan (Open-Meteo), kemiringan lereng (DEM), Zona Kerentanan
// Gerakan Tanah & prakiraan bulanan (Badan Geologi), dan jarak ke sungai (OpenStreetMap).
import { esc, getJson, setCard, fakta, fmtKm, jarakKeGaris, arahKe, levelMaks, catatanGagal } from './util.js';
import { RADIUS } from './config.js';
import { garisJarak } from './peta.js';

function kategoriHujanHarian(mm) {
  if (mm < 0.5) return 'Tidak hujan';
  if (mm < 20) return 'Ringan';
  if (mm < 50) return 'Sedang';
  if (mm < 100) return 'Lebat';
  if (mm < 150) return 'Sangat lebat';
  return 'Ekstrem';
}

async function lerengHalus(lat, lon) {
  // Elevasi di pusat dan 4 titik ±300 m untuk kemiringan lereng setempat.
  const d = 300;
  const dLat = d / 111320;
  const dLon = d / (111320 * Math.cos((lat * Math.PI) / 180));
  const lats = [lat, lat + dLat, lat - dLat, lat, lat];
  const lons = [lon, lon, lon, lon + dLon, lon - dLon];
  const r = await getJson(`https://api.open-meteo.com/v1/elevation?latitude=${lats.join(',')}&longitude=${lons.join(',')}`);
  const [c, n, s, e, w] = r.elevation;
  const derajat = (Math.atan(Math.hypot((n - s) / (2 * d), (e - w) / (2 * d))) * 180) / Math.PI;
  return { elevasi: c, derajat };
}

// Kelas kerentanan gerakan tanah Badan Geologi -> skor 0..3
const SKOR_ZKGT = (u) => (!u ? null : /sangat rendah/i.test(u) ? 0 : /rendah/i.test(u) ? 1 : /menengah/i.test(u) ? 2 : /tinggi/i.test(u) ? 3 : null);

export function ringkasHujan(cuaca) {
  const offset = cuaca.utc_offset_seconds * 1000;
  const keEpoch = (t) => Date.parse(`${t}Z`) - offset;
  const now = Date.now();
  let lalu72 = 0;
  let lalu7h = 0;
  let depan24 = 0;
  let peluang24 = 0;
  cuaca.hourly.time.forEach((t, i) => {
    const ms = keEpoch(t);
    const p = cuaca.hourly.precipitation[i] || 0;
    if (ms <= now && ms > now - 72 * 3600e3) lalu72 += p;
    if (ms <= now && ms > now - 7 * 24 * 3600e3) lalu7h += p;
    if (ms > now && ms <= now + 24 * 3600e3) {
      depan24 += p;
      peluang24 = Math.max(peluang24, cuaca.hourly.precipitation_probability[i] || 0);
    }
  });
  const hariIni = new Date(now + offset).toISOString().slice(0, 10);
  const harian = cuaca.daily.time.map((t, i) => ({
    tanggal: t, mm: cuaca.daily.precipitation_sum[i] || 0, peluang: cuaca.daily.precipitation_probability_max[i], lalu: t < hariIni,
  }));
  return { lalu72, lalu7h, depan24, peluang24, harian, hariIni };
}

export async function muatHujan(ctx) {
  const { lat, lon } = ctx;
  const [cuacaR, lerengR, geoR, osmR, gridR] = await Promise.allSettled([ctx.cuaca, lerengHalus(lat, lon), ctx.geologi, ctx.osm, ctx.gridLokal]);
  if (ctx.batal()) return null;
  if (cuacaR.status === 'rejected') throw cuacaR.reason;

  const h = ringkasHujan(cuacaR.value);
  const lereng = lerengR.status === 'fulfilled' ? lerengR.value : null;
  const geo = geoR.status === 'fulfilled' ? geoR.value : null;
  const zkgt = Array.isArray(geo?.gerakan_tanah) ? geo.gerakan_tanah[0] : null;
  const prakiraan = Array.isArray(geo?.prakiraan_gt) ? geo.prakiraan_gt[0] : null;

  const maksDepan = Math.max(0, ...h.harian.filter((d) => !d.lalu).map((d) => d.mm));
  const basah = h.lalu72 + h.depan24;
  const skorHujan = basah >= 200 || maksDepan >= 150 ? 3 : basah >= 100 || maksDepan >= 100 ? 2 : basah >= 50 || maksDepan >= 50 ? 1 : 0;
  const skorLereng = !lereng ? null : lereng.derajat >= 25 ? 3 : lereng.derajat >= 15 ? 2 : lereng.derajat >= 8 ? 1 : 0;
  // Kerentanan tanah: utamakan peta resmi, lereng DEM sebagai cadangan; ambil yang lebih tinggi.
  const skorZkgt = SKOR_ZKGT(zkgt?.unsur);
  const skorTanah = Math.max(skorZkgt ?? -1, skorLereng ?? -1, skorZkgt == null && skorLereng == null ? 1 : -1);

  let lvLongsor;
  let ketLongsor;
  if (skorTanah === 0) {
    lvLongsor = 'rendah';
    ketLongsor = 'Wilayah relatif datar/stabil sehingga longsor kecil kemungkinannya.';
  } else if (skorHujan === 0) {
    lvLongsor = 'rendah';
    ketLongsor = 'Tanah cukup rentan, tetapi curah hujan saat ini rendah. Waspada bila hujan lebat berhari-hari.';
  } else {
    const total = skorHujan + skorTanah;
    if (total >= 5) {
      lvLongsor = 'bahaya';
      ketLongsor = '<b>Potensi longsor tinggi</b>: tanah rentan dan jenuh air akibat hujan lebat. Hindari tebing dan bantaran sungai.';
    } else if (total >= 3) {
      lvLongsor = 'tinggi';
      ketLongsor = '<b>Potensi longsor menengah</b>. Perhatikan retakan tanah dan rembesan air pada lereng.';
    } else {
      lvLongsor = 'sedang';
      ketLongsor = 'Ada hujan pada tanah yang cukup rentan, tetapi belum signifikan. Pantau cuaca.';
    }
  }

  // ----- Banjir: dekat sungai + rendah relatif sekitar + hujan -----
  let sungai = null;
  if (osmR.status === 'fulfilled' && osmR.value.sungai.length) {
    let terbaik = null;
    for (const s of osmR.value.sungai) {
      const d = jarakKeGaris(lat, lon, [s.garis]);
      if (!terbaik || d.km < terbaik.km) terbaik = { ...d, nama: s.nama };
    }
    sungai = terbaik;
    if (sungai) garisJarak([lat, lon], sungai.titik, '#0284c7', `Sungai${sungai.nama ? ` ${sungai.nama}` : ''}: ${fmtKm(sungai.km)}`);
  }
  let posisiRelatif = null; // beda tinggi terhadap median sekitar (±3 km)
  if (gridR.status === 'fulfilled') {
    const el = gridR.value.titik.map((t) => t.elev).sort((a, b) => a - b);
    posisiRelatif = gridR.value.pusat.elev - el[Math.floor(el.length / 2)];
  }
  const dekatSungai = sungai && sungai.km <= 0.3;
  const cekungan = posisiRelatif != null && posisiRelatif < -5;
  let lvBanjir = 'rendah';
  if (skorHujan >= 2 && (dekatSungai || cekungan)) lvBanjir = 'tinggi';
  else if ((skorHujan >= 1 && (dekatSungai || cekungan)) || skorHujan >= 2) lvBanjir = 'sedang';

  const level = levelMaks(lvLongsor, lvBanjir);
  const nama = { rendah: 'Rendah', sedang: 'Sedang', tinggi: 'Tinggi', bahaya: 'Sangat tinggi' };
  const badge = nama[level];
  let summary = `<b>Longsor ${nama[lvLongsor].toLowerCase()}, banjir ${nama[lvBanjir].toLowerCase()}.</b> ${ketLongsor}`;
  if (lvBanjir !== 'rendah') {
    summary += ` <b>Waspada banjir</b>${dekatSungai ? ` — lokasi ${fmtKm(sungai.km)} dari sungai` : ''}${cekungan ? `${dekatSungai ? ' dan' : ' —'} berada di daerah lebih rendah dari sekitarnya` : ''}.`;
  }

  const skalaMaks = Math.max(50, ...h.harian.map((d) => d.mm));
  const bars = h.harian.filter((d) => d.tanggal >= h.harian[h.harian.length - 7]?.tanggal).map((d) => {
    const label = d.tanggal === h.hariIni ? 'Hari ini' : new Date(`${d.tanggal}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' });
    return `<div class="bar-row ${d.lalu ? 'past' : ''}" title="${kategoriHujanHarian(d.mm)}${d.peluang != null ? ` · peluang ${d.peluang}%` : ''}">
      <span>${label}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(d.mm / skalaMaks) * 100}%"></span></span>
      <span class="num">${d.mm.toFixed(1)} mm</span>
    </div>`;
  }).join('');

  setCard('card-hujan', {
    badge,
    level,
    radius: `Radius analisis ${RADIUS.longsor.km} km (lereng & sungai)`,
    summary,
    detail: `
      <div class="facts">
        ${fakta('Hujan 72 jam terakhir', `${h.lalu72.toFixed(0)} mm`)}
        ${fakta('Prakiraan 24 jam', `${h.depan24.toFixed(0)} mm`, `peluang hujan ${h.peluang24}%`)}
        ${fakta('Zona kerentanan gerakan tanah', zkgt ? esc(zkgt.unsur) : '—', zkgt ? `Badan Geologi${zkgt.tahun ? `, ${zkgt.tahun}` : ''}` : 'tidak ada data')}
        ${fakta('Kemiringan lereng (±300 m)', lereng ? `${lereng.derajat.toFixed(1)}°` : '—', lereng ? `elevasi ${Math.round(lereng.elevasi)} m` : '')}
        ${fakta('Sungai terdekat', sungai ? fmtKm(sungai.km) : '—', sungai ? `${esc(sungai.nama || 'tanpa nama')} · arah ${arahKe(lat, lon, ...sungai.titik)}` : `tidak ada dalam ${RADIUS.longsor.km} km`)}
        ${fakta('Posisi terhadap sekitar', posisiRelatif == null ? '—' : `${posisiRelatif >= 0 ? '+' : ''}${Math.round(posisiRelatif)} m`, 'dibanding median ±3 km')}
      </div>
      ${prakiraan ? `<p class="meta"><b>${esc(geo.prakiraan_gt_judul || 'Prakiraan gerakan tanah bulanan')}</b>: potensi <b>${esc(prakiraan.zona_perki || prakiraan.unsur)}</b>. ${esc((prakiraan.keterangan || '').replace(/\*$/, '…'))}</p>` : ''}
      ${catatanGagal('Data Badan Geologi', geoR.status === 'rejected' ? { error: geoR.reason.message } : geo?.gerakan_tanah)}
      <div class="bars">
        <h3>Curah hujan harian (pudar = sudah lewat)</h3>
        ${bars}
      </div>
      <ul class="tips">
        <li>Tanda longsor: retakan baru di tanah/dinding, pohon/tiang miring, mata air keruh tiba-tiba, suara gemuruh.</li>
        <li>Saat hujan lebat &gt; 2 jam di daerah lereng, menjauh dari tebing dan aliran sungai.</li>
      </ul>`,
  });

  return { level, lvLongsor, lvBanjir, sungai, skorHujan, ringkas: h };
}
