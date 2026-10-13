// Gunung api: status live MAGMA, jarak/arah, Kawasan Rawan Bencana (KRB) resmi, dan potensi hujan abu
// berdasarkan arah angin.
import { esc, jarakKm, arahKe, namaArah, bearing, selisihSudut, fmtTanggal, fmtKm, getJson, setCard, levelMaks } from './util.js';
import { RADIUS, LEVEL_GUNUNG, RADIUS_BAHAYA_GUNUNG } from './config.js';
import { GUNUNG } from './data-gunung.js';
import { lapisan, garisJarak, ikonSegitiga } from './peta.js';

const L = window.L;
const normal = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
const KELAS_KRB = { '0703': 3, '0603': 3, '0702': 2, '0602': 2, '0701': 1, '0601': 1 };

export async function muatGunung(ctx) {
  const { lat, lon } = ctx;
  const [liveR, geoR, cuacaR] = await Promise.allSettled([getJson('/api/gunung'), ctx.geologi, ctx.cuaca]);
  if (ctx.batal()) return null;

  let daftar = GUNUNG.map((v) => ({ ...v, laporan: null }));
  let catatan;
  if (liveR.status === 'fulfilled') {
    const byName = new Map(liveR.value.items.map((i) => [normal(i.nama), i]));
    daftar = daftar.map((v) => {
      const l = byName.get(normal(v.nama));
      return l ? { ...v, level: l.level, wilayah: l.wilayah, laporan: l.laporan } : v;
    });
    catatan = `Status live MAGMA, diambil ${fmtTanggal(Date.parse(liveR.value.diperbarui))}.`;
  } else {
    catatan = 'Status live tidak tersedia (jalankan lewat <code>npm start</code>); memakai data cadangan per 8 Okt 2026.';
  }

  const terurut = daftar
    .map((v) => ({ ...v, jarak: jarakKm(lat, lon, v.lat, v.lon), arah: arahKe(lat, lon, v.lat, v.lon) }))
    .sort((a, b) => a.jarak - b.jarak);

  for (const v of terurut) {
    const lv = LEVEL_GUNUNG[v.level];
    L.marker([v.lat, v.lon], { icon: ikonSegitiga(lv.warna), title: v.nama })
      .bindPopup(`<b>${esc(v.nama)}</b><br>Level ${v.level} (${lv.nama})<br>${fmtKm(v.jarak)} dari lokasi${v.laporan ? `<br><a href="${esc(v.laporan)}" target="_blank" rel="noopener">Laporan MAGMA</a>` : ''}`)
      .addTo(lapisan.gunung);
  }

  // ----- KRB resmi di titik lokasi -----
  const krbList = geoR.status === 'fulfilled' && Array.isArray(geoR.value.krb_gunung) ? geoR.value.krb_gunung : [];
  const krb = krbList
    .map((k) => ({ ...k, kelas: KELAS_KRB[k.lcode] || 0 }))
    .sort((a, b) => b.kelas - a.kelas)[0] || null;
  const gunungKrb = krb ? terurut.find((v) => normal(v.nama) === normal(krb.namobj || '')) : null;

  // ----- Angin: abu terbawa ke arah angin bertiup -----
  const angin = cuacaR.status === 'fulfilled' ? cuacaR.value.current : null;
  const searahAngin = (v) => {
    if (!angin || angin.wind_speed_10m < 3) return false;
    const arahAbu = (angin.wind_direction_10m + 180) % 360; // arah angin "dari" -> abu bergerak ke sebaliknya
    return selisihSudut(arahAbu, bearing(v.lat, v.lon, lat, lon)) <= 35;
  };

  const sekitar = terurut.filter((v) => v.jarak <= RADIUS.gunung.km);
  const dalamRadius = sekitar.filter((v) => v.level >= 2 && v.jarak <= RADIUS_BAHAYA_GUNUNG[v.level] + 2);
  const aktifDekat = sekitar.filter((v) => v.level >= 2);
  const siagaDekat = sekitar.filter((v) => v.level >= 3 && v.jarak <= 100);

  let level = 'rendah';
  let badge = 'Aman';
  let summary;
  const krbTeks = krb ? ` Lokasi berada di <b>KRB ${['', 'I', 'II', 'III'][krb.kelas]} ${esc(krb.namobj)}</b> — ${esc(krb.remark)}.` : '';

  if (dalamRadius.length) {
    const v = dalamRadius[0];
    level = 'bahaya';
    badge = 'Zona bahaya';
    summary = `Lokasi hanya <b>${fmtKm(v.jarak)}</b> dari kawah <b>${esc(v.nama)}</b> (Level ${v.level} – ${LEVEL_GUNUNG[v.level].nama}). Patuhi radius larangan PVMBG dan siapkan evakuasi.${krbTeks}`;
  } else if (krb && gunungKrb && gunungKrb.level >= 2) {
    level = krb.kelas >= 2 || gunungKrb.level >= 3 ? 'bahaya' : 'tinggi';
    badge = `KRB ${['', 'I', 'II', 'III'][krb.kelas]}`;
    summary = `<b>${esc(gunungKrb.nama)}</b> berstatus Level ${gunungKrb.level} (${LEVEL_GUNUNG[gunungKrb.level].nama}) dan lokasi Anda masuk Kawasan Rawan Bencananya.${krbTeks}`;
  } else if (siagaDekat.length) {
    const v = siagaDekat[0];
    level = 'tinggi';
    badge = searahAngin(v) ? 'Waspada abu' : 'Pantau';
    summary = `<b>${esc(v.nama)}</b> berstatus <b>Level ${v.level} (${LEVEL_GUNUNG[v.level].nama})</b>, ${fmtKm(v.jarak)} ke arah ${v.arah}. `
      + (searahAngin(v)
        ? 'Angin saat ini bertiup <b>dari gunung ke arah lokasi Anda</b>, sehingga hujan abu mungkin terjadi — siapkan masker.'
        : 'Lokasi di luar zona bahaya, dan angin saat ini tidak mengarah ke lokasi Anda.') + krbTeks;
  } else if (aktifDekat.length) {
    const v = aktifDekat[0];
    level = 'sedang';
    badge = 'Pantau';
    summary = `Ada ${aktifDekat.length} gunung api berstatus Waspada atau lebih dalam radius ${RADIUS.gunung.km} km. Terdekat: <b>${esc(v.nama)}</b> (${fmtKm(v.jarak)}, ${v.arah}).${krbTeks}`;
  } else {
    summary = (sekitar.length
      ? `Ada ${sekitar.length} gunung api dalam radius ${RADIUS.gunung.km} km dan semuanya berstatus Normal.`
      : `Tidak ada gunung api aktif dalam radius ${RADIUS.gunung.km} km.`) + krbTeks;
    if (krb) level = levelMaks(level, 'sedang');
  }

  const terdekatAktif = aktifDekat[0] || null;
  const tampil = terurut[0];
  if (tampil && tampil.jarak <= RADIUS.gunung.km) {
    garisJarak([lat, lon], [tampil.lat, tampil.lon], LEVEL_GUNUNG[tampil.level].warna, `${tampil.nama}: ${fmtKm(tampil.jarak)}`);
  }
  if (terdekatAktif && terdekatAktif !== tampil) {
    garisJarak([lat, lon], [terdekatAktif.lat, terdekatAktif.lon], LEVEL_GUNUNG[terdekatAktif.level].warna, `${terdekatAktif.nama}: ${fmtKm(terdekatAktif.jarak)}`);
  }

  const items = terurut.slice(0, 6).map((v) => {
    const lv = LEVEL_GUNUNG[v.level];
    return `<li>
      <div><span class="dot" style="background:${lv.warna}"></span><b>${esc(v.nama)}</b>
        <div class="meta">Level ${v.level} – ${lv.nama}${v.level >= 2 ? ` · radius bahaya ±${RADIUS_BAHAYA_GUNUNG[v.level]} km` : ''}${v.laporan ? ` · <a href="${esc(v.laporan)}" target="_blank" rel="noopener">laporan</a>` : ''}</div></div>
      <div class="right">${fmtKm(v.jarak)}<div class="meta">${v.arah}${v.level >= 2 && searahAngin(v) ? ' · ⚠ searah angin' : ''}</div></div>
    </li>`;
  }).join('');

  setCard('card-gunung', {
    badge,
    level,
    radius: `Radius ${RADIUS.gunung.km} km · zona bahaya 3–7 km sesuai level`,
    summary,
    detail: `<ul class="list">${items}</ul>
      ${angin ? `<p class="meta">Angin permukaan: ${Math.round(angin.wind_speed_10m)} km/j dari ${namaArah(angin.wind_direction_10m)}. Abu di ketinggian bisa bergerak berbeda.</p>` : ''}
      <p class="meta muted">${catatan} Radius bahaya hanya perkiraan umum; aktifkan lapisan <i>KRB gunung api</i> di peta untuk zona resmi.</p>
      <ul class="tips">
        <li>Hujan abu: pakai masker &amp; kacamata, tutup tandon air, bersihkan atap dari abu agar tidak runtuh.</li>
        <li>Tinggal di dekat sungai yang berhulu di gunung aktif? Waspadai banjir lahar saat hujan.</li>
      </ul>`,
  });

  return { level, daftar: terurut, terdekat: terurut[0], terdekatAktif, krb, gunungKrb };
}
