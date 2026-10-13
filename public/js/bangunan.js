// Data tinggi bangunan di sekitar lokasi (OpenStreetMap: building:levels / height).
import { esc, setCard, fakta, fmtKm } from './util.js';
import { RADIUS } from './config.js';
import { lapisan, ikonTitik } from './peta.js';

const L = window.L;

export async function muatBangunan(ctx) {
  const osm = await ctx.osm;
  if (ctx.batal()) return null;

  const b = osm.bangunan;
  const total = osm.totalBangunan ?? 0;
  const kelompok = [
    { label: '1–2 lantai', min: 1, max: 2 },
    { label: '3–4 lantai', min: 3, max: 4 },
    { label: '5–9 lantai', min: 5, max: 9 },
    { label: '10–19 lantai', min: 10, max: 19 },
    { label: '≥ 20 lantai', min: 20, max: Infinity },
  ].map((k) => ({ ...k, n: b.filter((x) => x.lantai >= k.min && x.lantai <= k.max).length }));

  const tinggi = b.filter((x) => x.lantai >= 4).sort((p, q) => q.lantai - p.lantai);
  for (const x of tinggi) {
    L.marker([x.lat, x.lon], { icon: ikonTitik('pin-gedung', x.lantai) })
      .bindPopup(`<b>${esc(x.nama || 'Gedung')}</b><br>${x.lantai} lantai${x.tags.height ? ` · tinggi ${esc(x.tags.height)} m` : ''}<br>${fmtKm(x.jarak)} dari lokasi`)
      .addTo(lapisan.bangunan);
  }

  const cakupan = total ? Math.round((b.length / total) * 100) : 0;
  const maks = tinggi[0] || b.slice().sort((p, q) => q.lantai - p.lantai)[0];
  const rataLantai = b.length ? b.reduce((s, x) => s + x.lantai, 0) / b.length : null;
  const skalaMaks = Math.max(1, ...kelompok.map((k) => k.n));

  let summary = `Terdapat <b>${total.toLocaleString('id-ID')}</b> bangunan terpetakan dalam radius ${RADIUS.bangunan.km * 1000} m; `
    + `<b>${b.length.toLocaleString('id-ID')}</b> (${cakupan}%) memiliki data jumlah lantai/tinggi.`;
  if (maks) summary += ` Tertinggi: <b>${esc(maks.nama || 'gedung tanpa nama')}</b> (${maks.lantai} lantai, ${fmtKm(maks.jarak)}).`;
  if (tinggi.length) summary += ` Ada <b>${tinggi.length}</b> gedung ≥ 4 lantai yang dapat menjadi kandidat <b>evakuasi vertikal</b> tsunami (jika strukturnya tahan gempa).`;

  setCard('card-bangunan', {
    badge: b.length ? `${b.length} gedung berdata` : 'Data minim',
    level: '',
    radius: `Radius ${RADIUS.bangunan.km * 1000} m`,
    summary,
    detail: `
      <div class="facts">
        ${fakta('Bangunan terpetakan', total.toLocaleString('id-ID'))}
        ${fakta('Rata-rata lantai', rataLantai ? rataLantai.toFixed(1) : '—', 'dari bangunan berdata')}
      </div>
      ${b.length ? `<div class="bars"><h3>Sebaran jumlah lantai</h3>${kelompok.map((k) => `
        <div class="bar-row"><span>${k.label}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${(k.n / skalaMaks) * 100}%"></span></span>
          <span class="num">${k.n}</span></div>`).join('')}</div>` : ''}
      ${tinggi.length ? `<ul class="list">${tinggi.slice(0, 5).map((x) => `<li><div><b>${esc(x.nama || 'Gedung tanpa nama')}</b><div class="meta">${x.lantai} lantai${x.tags.height ? ` · ${esc(x.tags.height)} m` : ''}</div></div><div class="right">${fmtKm(x.jarak)}</div></li>`).join('')}</ul>` : ''}
      <ul class="tips">
        <li>Gedung 5–15 lantai di atas tanah lunak (aluvium) dapat beresonansi dengan gempa jauh — guncangan terasa lebih lama di lantai atas.</li>
        <li>Saat gempa di gedung tinggi: jangan pakai lift; lindungi diri dulu, evakuasi lewat tangga setelah guncangan berhenti.</li>
      </ul>
      <p class="meta muted">Sumber: OpenStreetMap. Data lantai di Indonesia belum lengkap; bangunan tanpa data tidak dihitung. Aktifkan lapisan <i>Bangunan bertingkat</i> di peta.</p>`,
  });

  return { total, berdata: b.length, tinggi, maks };
}
