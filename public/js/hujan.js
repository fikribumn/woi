// Hujan, longsor, dan banjir: curah hujan (Open-Meteo), kemiringan lereng (DEM), Zona Kerentanan
// Gerakan Tanah & prakiraan bulanan (Badan Geologi), dan jarak ke sungai (OpenStreetMap).
import { esc, getJson, setCard, fakta, fmtKm, jarakKeGaris, arahKe, levelMaks, catatanGagal } from './util.js';
import { RADIUS } from './config.js';
import { garisJarak } from './peta.js';
import { siapLaporan, laporanDekat, ATRIBUSI } from './laporan.js';

/**
 * Prakiraan debit sungai GloFAS (Open-Meteo Flood API, grid ±5 km): debit hari ini, puncak 7 hari ke depan,
 * dan rasionya terhadap rata-rata 7 hari terakhir. Hanya andal untuk sungai besar.
 */
async function debitSungai(lat, lon) {
  const d = await getJson(`https://flood-api.open-meteo.com/v1/flood?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&daily=river_discharge&past_days=7&forecast_days=16`, { timeout: 20000 });
  const t = d.daily?.time || [];
  const q = d.daily?.river_discharge || [];
  const hariIni = new Date().toISOString().slice(0, 10);
  const i0 = t.indexOf(hariIni);
  if (i0 < 0 || q[i0] == null) return null;
  const lalu = q.slice(Math.max(0, i0 - 7), i0).filter((v) => v != null);
  const depan = q.slice(i0, i0 + 8).map((v, k) => ({ v, tanggal: t[i0 + k] })).filter((x) => x.v != null);
  const puncak = depan.reduce((a, b) => (b.v > a.v ? b : a), depan[0]);
  const rata = lalu.length ? lalu.reduce((a, b) => a + b, 0) / lalu.length : q[i0];
  const rasio = puncak.v / Math.max(rata, 0.5);
  return { kini: q[i0], puncak, rasio, kecil: rata < 2 && puncak.v < 2 };
}

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
  const [cuacaR, lerengR, geoR, osmR, gridR, debitR] = await Promise.allSettled([
    ctx.cuaca, lerengHalus(lat, lon), ctx.geologi, ctx.osm, ctx.gridLokal, debitSungai(lat, lon),
    // Laporan warga dipakai bila sudah termuat (maks. tunggu 8 detik)
    Promise.race([siapLaporan, new Promise((r) => setTimeout(r, 8000))]),
  ]);
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

  // Debit sungai (GloFAS): lonjakan ≥ 3× rata-rata seminggu terakhir menaikkan kewaspadaan banjir
  const debit = debitR.status === 'fulfilled' ? debitR.value : null;
  const debitNaik = debit && !debit.kecil && debit.rasio >= 3;
  if (debitNaik && lvBanjir === 'rendah') lvBanjir = 'sedang';
  if (debitNaik && (dekatSungai || cekungan)) lvBanjir = levelMaks(lvBanjir, 'tinggi');

  // Laporan banjir warga: ≤ 2 km dalam 6 jam terakhir berarti banjir sedang terjadi di dekat lokasi
  const laporanBanjir = laporanDekat(lat, lon, { jenis: 'flood', km: 5, umurMs: 24 * 3600e3 });
  const banjirKini = laporanBanjir.filter((l) => l.jarak <= 2 && Date.now() - Date.parse(l.waktu) <= 6 * 3600e3);
  if (banjirKini.length) lvBanjir = levelMaks(lvBanjir, 'tinggi');

  const level = levelMaks(lvLongsor, lvBanjir);
  const nama = { rendah: 'Rendah', sedang: 'Sedang', tinggi: 'Tinggi', bahaya: 'Sangat tinggi' };
  const badge = nama[level];
  let summary = `<b>Longsor ${nama[lvLongsor].toLowerCase()}, banjir ${nama[lvBanjir].toLowerCase()}.</b> ${ketLongsor}`;
  if (lvBanjir !== 'rendah') {
    summary += ` <b>Waspada banjir</b>${dekatSungai ? ` — lokasi ${fmtKm(sungai.km)} dari sungai` : ''}${cekungan ? `${dekatSungai ? ' dan' : ' —'} berada di daerah lebih rendah dari sekitarnya` : ''}.`;
  }
  if (banjirKini.length) summary += ` <b>Ada ${banjirKini.length} laporan banjir warga dalam 2 km</b> pada 6 jam terakhir.`;
  if (debitNaik) summary += ` Debit sungai diperkirakan naik ±${debit.rasio.toFixed(1)}× dalam 7 hari ke depan.`;

  const tglPendek = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
  const statusDebit = !debit ? '' : debit.rasio >= 3 ? 'naik tajam' : debit.rasio >= 1.5 ? 'naik' : debit.rasio <= 0.7 ? 'turun' : 'stabil';
  const faktaDebit = debit
    ? fakta('Debit sungai (GloFAS)', `${debit.kini.toFixed(debit.kini < 10 ? 1 : 0)} m³/s`,
      `puncak 7 hari ${debit.puncak.v.toFixed(debit.puncak.v < 10 ? 1 : 0)} m³/s (${tglPendek(debit.puncak.tanggal)}), ${statusDebit}${debit.kecil ? ' · sungai kecil, kurang andal' : ''}`)
    : fakta('Debit sungai (GloFAS)', '—', debitR.status === 'rejected' ? 'gagal dimuat' : 'tidak ada data');
  const faktaLaporan = fakta('Laporan banjir warga (24 jam, ≤ 5 km)', String(laporanBanjir.length),
    laporanBanjir[0] ? `terdekat ${fmtKm(laporanBanjir[0].jarak)} ke arah ${arahKe(lat, lon, laporanBanjir[0].lat, laporanBanjir[0].lon)}${laporanBanjir[0].kedalaman ? `, ±${laporanBanjir[0].kedalaman} cm` : ''}` : 'tidak ada laporan (bukan berarti pasti aman)');

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
        ${faktaDebit}
        ${faktaLaporan}
      </div>
      <p class="meta">Laporan warga: ${ATRIBUSI}. Titik laporan tampil di peta (lapisan "Laporan warga"). Debit sungai: GloFAS via Open-Meteo, hanya andal untuk sungai besar.</p>
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
