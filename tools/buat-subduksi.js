// Membuat public/data/subduksi.json: jalur zona subduksi (megathrust) di sekitar Indonesia,
// diambil dari GEM Global Active Faults Database (Styron & Pagani 2020, CC BY-SA 4.0).
// Sesar daratan diambil langsung dari Badan Geologi lewat /api/sesar, jadi di sini hanya subduksi.
// Pakai: node tools/buat-subduksi.js
const fs = require('fs');
const path = require('path');

const SUMBER = 'https://raw.githubusercontent.com/GEMScienceTools/gem-global-active-faults/master/geojson/gem_active_faults_harmonized.geojson';
const BBOX = { minLon: 90, maxLon: 145, minLat: -15, maxLat: 10 };
const r3 = (n) => Math.round(n * 1000) / 1000;

(async () => {
  const res = await fetch(SUMBER);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const gj = await res.json();
  const segmen = [];
  for (const f of gj.features) {
    // Hanya model batas lempeng Bird (2003); katalog lain memuat segmen daratan yang salah diberi label subduksi.
    if (!/subduction/i.test(f.properties.slip_type || '') || f.properties.catalog_name !== 'Bird 2003' || !f.geometry) continue;
    const g = f.geometry;
    const garis = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const l of garis) {
      if (!l.some(([x, y]) => x >= BBOX.minLon && x <= BBOX.maxLon && y >= BBOX.minLat && y <= BBOX.maxLat)) continue;
      segmen.push(l.map(([x, y]) => [r3(y), r3(x)])); // [lat, lon]
    }
  }
  const out = path.join(__dirname, '..', 'public', 'data', 'subduksi.json');
  fs.writeFileSync(out, JSON.stringify({
    sumber: 'GEM Global Active Faults Database (Styron & Pagani 2020), CC BY-SA 4.0',
    segmen,
  }));
  console.log(`${segmen.length} segmen subduksi -> ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
})();
