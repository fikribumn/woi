// Gempa bumi: aktivitas terkini (BMKG + USGS), sesar aktif (Badan Geologi), zona subduksi (GEM),
// dan Kawasan Rawan Bencana gempa (Badan Geologi).
import { esc, jarakKm, arahKe, fmtTanggal, fmtKm, waktuRelatif, getJson, setCard, fakta, jarakKeGaris, levelMaks, $ } from './util.js';
import { RADIUS } from './config.js';
import { lapisan, garisJarak } from './peta.js';

const L = window.L;
const ROMAWI = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

// Perkiraan intensitas (MMI) — model Atkinson & Wald (2007), sangat kasar.
function perkiraanMMI(mag, jarakHiposenterKm) {
  const R = Math.sqrt(jarakHiposenterKm ** 2 + 14 ** 2);
  const B = Math.max(0, Math.log10(R / 50));
  const mmi = 12.27 + 2.27 * (mag - 6) + 0.1304 * (mag - 6) ** 2 - 1.3 * Math.log10(R) - 0.000707 * R + 1.95 * B - 0.577 * mag * Math.log10(R);
  return Math.max(1, Math.min(12, mmi));
}

function labelMMI(mmi) {
  const r = Math.round(mmi);
  const ket = r <= 1 ? 'tidak terasa' : r <= 3 ? 'terasa lemah' : r <= 4 ? 'terasa jelas' : r <= 5 ? 'terasa kuat' : r <= 6 ? 'kerusakan ringan' : 'berpotensi merusak';
  return `${ROMAWI[r - 1]} (${ket})`;
}

function parseBmkg(list, sumber) {
  return (list || []).map((g) => {
    const [lat, lon] = g.Coordinates.split(',').map(Number);
    return {
      waktu: Date.parse(g.DateTime), lat, lon,
      mag: parseFloat(g.Magnitude), kedalaman: parseFloat(g.Kedalaman),
      tempat: g.Wilayah, potensi: g.Potensi || '', dirasakan: g.Dirasakan || '', sumber,
    };
  });
}

async function ambilGempa() {
  const [terkini, dirasakan, auto, usgs] = await Promise.allSettled([
    getJson('https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json'),
    getJson('https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json'),
    getJson('https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json'),
    getJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson'),
  ]);
  const semua = [];
  if (auto.status === 'fulfilled') semua.push(...parseBmkg([auto.value.Infogempa.gempa], 'BMKG'));
  if (terkini.status === 'fulfilled') semua.push(...parseBmkg(terkini.value.Infogempa.gempa, 'BMKG'));
  if (dirasakan.status === 'fulfilled') semua.push(...parseBmkg(dirasakan.value.Infogempa.gempa, 'BMKG'));
  if (usgs.status === 'fulfilled') {
    semua.push(...usgs.value.features.map((f) => ({
      waktu: f.properties.time, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
      mag: f.properties.mag, kedalaman: f.geometry.coordinates[2], tempat: f.properties.place,
      potensi: '', dirasakan: '', sumber: 'USGS',
    })));
  }
  if (semua.length === 0) throw new Error('Semua sumber data gempa gagal diakses');

  // Hapus duplikat (BMKG didahulukan): selisih waktu < 2 menit dan jarak < 100 km.
  const unik = [];
  for (const g of semua) {
    if (!Number.isFinite(g.lat) || !Number.isFinite(g.mag)) continue;
    const dup = unik.find((u) => Math.abs(u.waktu - g.waktu) < 120000 && jarakKm(u.lat, u.lon, g.lat, g.lon) < 100);
    if (dup) {
      if (!dup.dirasakan && g.dirasakan) dup.dirasakan = g.dirasakan;
      continue;
    }
    unik.push(g);
  }
  const sebagian = [terkini, dirasakan, usgs].some((r) => r.status === 'rejected');
  return { unik, sebagian };
}

let subduksiCache = null;
async function ambilSubduksi() {
  subduksiCache ??= getJson('data/subduksi.json');
  return subduksiCache;
}

export async function muatGempa(ctx) {
  const { lat, lon } = ctx;
  const [gempa, sesar, subduksi, geo] = await Promise.allSettled([
    ambilGempa(),
    getJson(`/api/sesar?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&r=${RADIUS.sesar.km}`, { timeout: 60000 }),
    ambilSubduksi(),
    ctx.geologi,
  ]);
  if (ctx.batal()) return null;
  if (gempa.status === 'rejected') throw gempa.reason;

  // ----- Aktivitas -----
  const sekitar = gempa.value.unik
    .map((g) => {
      const jarak = jarakKm(lat, lon, g.lat, g.lon);
      const hipo = Math.sqrt(jarak ** 2 + (g.kedalaman || 10) ** 2);
      return { ...g, jarak, mmi: perkiraanMMI(g.mag, hipo) };
    })
    .filter((g) => g.jarak <= RADIUS.gempa.km)
    .sort((a, b) => b.waktu - a.waktu);

  for (const g of sekitar) {
    L.circleMarker([g.lat, g.lon], {
      radius: Math.max(4, g.mag * 2.2), color: '#b91c1c', weight: 1, fillColor: '#ef4444', fillOpacity: 0.45,
    })
      .bindPopup(`<b>M${g.mag.toFixed(1)}</b> — ${esc(g.tempat)}<br>${fmtTanggal(g.waktu)} · kedalaman ${Math.round(g.kedalaman)} km<br>Jarak ${fmtKm(g.jarak)} · ${esc(g.sumber)}`)
      .addTo(lapisan.gempa);
  }

  const tsunami = sekitar.find((g) => /berpotensi tsunami/i.test(g.potensi) && !/tidak/i.test(g.potensi) && Date.now() - g.waktu < 24 * 3600e3);
  const alertEl = $('#alert-tsunami');
  alertEl.hidden = !tsunami;
  if (tsunami) {
    alertEl.innerHTML = `⚠️ ${esc(tsunami.potensi)} — Gempa M${tsunami.mag.toFixed(1)} ${esc(tsunami.tempat)} (${fmtKm(tsunami.jarak)}). Jika di pantai, segera menjauh ke tempat tinggi dan ikuti arahan BMKG/BPBD.`;
  }

  const minggu = sekitar.filter((g) => Date.now() - g.waktu < 7 * 24 * 3600e3);
  const maksMMI = minggu.reduce((m, g) => Math.max(m, g.mmi), 0);
  let lvAktivitas = 'rendah';
  if (maksMMI >= 5.5 || minggu.some((g) => g.mag >= 6 && g.jarak <= 200)) lvAktivitas = 'tinggi';
  else if (maksMMI >= 3.5 || minggu.filter((g) => g.mag >= 5 && g.jarak <= 200).length >= 2 || minggu.filter((g) => g.jarak <= 150).length >= 5) lvAktivitas = 'sedang';

  // ----- Sesar aktif -----
  let sesarTerdekat = null;
  let daftar = [];
  if (sesar.status === 'fulfilled') {
    daftar = sesar.value.fitur
      .map((f) => ({ ...f, ...jarakKeGaris(lat, lon, f.garis) }))
      .sort((a, b) => a.km - b.km);
    // Utamakan data skala detail (punya nama & sejarah gempa) bila jaraknya sebanding.
    const detail = daftar.find((f) => f.skala === 'detail');
    sesarTerdekat = detail && detail.km <= daftar[0].km + 3 ? detail : daftar[0] || null;
    for (const f of daftar) {
      L.polyline(f.garis, { color: '#7c3aed', weight: f.skala === 'detail' ? 2.5 : 1.5, opacity: 0.85 })
        .bindPopup(`<b>${esc(f.nama)}</b>${f.status ? `<br>Status: ${esc(f.status)}` : ''}${f.panjangKm ? `<br>Panjang ±${f.panjangKm} km` : ''}`
          + `<br>Jarak: ${fmtKm(f.km)}${f.sejarah ? `<br><span class="meta">Sejarah: ${esc(f.sejarah)}</span>` : ''}`)
        .addTo(lapisan.sesar);
    }
    if (sesarTerdekat) garisJarak([lat, lon], sesarTerdekat.titik, '#7c3aed', `Sesar ${sesarTerdekat.nama}: ${fmtKm(sesarTerdekat.km)}`);
  }

  // ----- Subduksi -----
  let subduksiTerdekat = null;
  if (subduksi.status === 'fulfilled') {
    subduksiTerdekat = jarakKeGaris(lat, lon, subduksi.value.segmen);
    for (const s of subduksi.value.segmen) {
      L.polyline(s, { color: '#be185d', weight: 2, dashArray: '8 4', opacity: 0.7 }).bindTooltip('Zona subduksi (megathrust)').addTo(lapisan.sesar);
    }
    if (subduksiTerdekat.km <= 400) garisJarak([lat, lon], subduksiTerdekat.titik, '#be185d', `Zona subduksi: ${fmtKm(subduksiTerdekat.km)}`);
  }

  // ----- KRB gempa (Badan Geologi) -----
  const krb = geo.status === 'fulfilled' && Array.isArray(geo.value.krb_gempa) ? geo.value.krb_gempa[0] : null;
  const kelasKrb = krb?.kelas || null;
  const lvKrb = !kelasKrb ? '' : /tinggi/i.test(kelasKrb) ? 'tinggi' : /menengah/i.test(kelasKrb) ? 'sedang' : 'rendah';

  // Sesar sangat dekat menaikkan bahaya jangka panjang
  const lvSesar = !sesarTerdekat ? '' : sesarTerdekat.km <= 2 ? 'bahaya' : sesarTerdekat.km <= 10 ? 'tinggi' : sesarTerdekat.km <= 30 ? 'sedang' : 'rendah';
  const level = levelMaks(lvAktivitas, lvKrb, lvSesar === 'bahaya' ? 'tinggi' : lvSesar);
  const badge = { rendah: 'Rendah', sedang: 'Sedang', tinggi: 'Tinggi', bahaya: 'Sangat tinggi' }[level] || '—';

  const terkuat = minggu.slice().sort((a, b) => b.mmi - a.mmi)[0];
  let summary = `<b>${minggu.length}</b> gempa M2.5+ dalam radius ${RADIUS.gempa.km} km selama 7 hari terakhir`;
  summary += terkuat ? `; guncangan terkuat di lokasi Anda diperkirakan <b>MMI ${labelMMI(terkuat.mmi)}</b>.` : '.';
  if (kelasKrb) summary += ` Lokasi berada di <b>${esc(kelasKrb)}</b> menurut Badan Geologi.`;
  if (sesarTerdekat && sesarTerdekat.km <= 10) {
    summary += ` <b>${esc(sesarTerdekat.nama)}</b> hanya ${fmtKm(sesarTerdekat.km)} dari lokasi — waspadai guncangan kuat dan rekahan permukaan.`;
  }
  summary += ' <span class="muted">Gempa tidak dapat diprediksi; penilaian ini menggabungkan bahaya jangka panjang dan aktivitas terkini.</span>';

  const items = sekitar.slice(0, 8).map((g) => `
    <li>
      <div><b>M${g.mag.toFixed(1)}</b> ${esc(g.tempat)}
        <div class="meta">${fmtTanggal(g.waktu)} · ${waktuRelatif(g.waktu)} · kedalaman ${Math.round(g.kedalaman)} km · ${esc(g.sumber)}${g.dirasakan ? ` · dirasakan: ${esc(g.dirasakan)}` : ''}</div></div>
      <div class="right">${fmtKm(g.jarak)}<div class="meta">MMI ~${ROMAWI[Math.round(g.mmi) - 1]}</div></div>
    </li>`).join('');

  setCard('card-gempa', {
    badge,
    level,
    radius: `Radius ${RADIUS.gempa.km} km · sesar ${RADIUS.sesar.km} km`,
    summary,
    detail: `
      <div class="facts">
        ${fakta('Aktivitas 7 hari', { rendah: 'Rendah', sedang: 'Sedang', tinggi: 'Tinggi' }[lvAktivitas])}
        ${fakta('KRB gempa (Badan Geologi)', kelasKrb ? esc(kelasKrb.replace('Kawasan Rawan Bencana Gempabumi ', '')) : '—', krb?.namobj ? esc(krb.namobj.replace(/\(Modified.*\)/, '')) : '')}
        ${fakta('Sesar aktif terdekat', sesarTerdekat ? fmtKm(sesarTerdekat.km) : '—', sesarTerdekat ? `${esc(sesarTerdekat.nama)} · arah ${arahKe(lat, lon, ...sesarTerdekat.titik)}` : (sesar.status === 'rejected' ? 'data tidak tersedia' : `tidak ada dalam ${RADIUS.sesar.km} km`))}
        ${fakta('Zona subduksi', subduksiTerdekat ? fmtKm(subduksiTerdekat.km) : '—', subduksiTerdekat ? `megathrust, arah ${arahKe(lat, lon, ...subduksiTerdekat.titik)}` : '')}
      </div>
      ${sesarTerdekat?.sejarah ? `<p class="meta">Sejarah gempa ${esc(sesarTerdekat.nama)}: ${esc(sesarTerdekat.sejarah)}</p>` : ''}
      ${sekitar.length ? `<ul class="list">${items}</ul>` : '<p class="muted">Tidak ada gempa tercatat di sekitar.</p>'}
      ${gempa.value.sebagian ? '<p class="meta muted">Sebagian sumber gagal dimuat; data mungkin tidak lengkap.</p>' : ''}
      <ul class="tips">
        <li>Saat gempa: <b>Merunduk, Lindungi kepala, Bertahan</b>; jauhi kaca dan lemari.</li>
        <li>Di pantai dan guncangan kuat/lama (&gt;20 detik)? Segera evakuasi ke tempat tinggi tanpa menunggu peringatan.</li>
      </ul>`,
  });

  const terdekat = minggu.slice().sort((a, b) => a.jarak - b.jarak)[0] || null;
  return { level, sesarTerdekat, sesarList: daftar, subduksiTerdekat, gempaTerdekat: terdekat, gempaTerkuat: terkuat || null, kelasKrb };
}
