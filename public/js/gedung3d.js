// Gedung 3D: bentuk gedung OpenStreetMap ditarik ke atas sesuai tingginya, dilihat dengan perspektif dari
// tengah bawah layar (gaya OSM Buildings). Semua gedung digambar di satu <canvas> di atas peta, hanya pada
// zoom ≥ 15. Warna makin pekat untuk gedung yang lebih tinggi; gedung tanpa data tinggi dianggap 1 lantai
// dan diberi warna netral.
import { map, kontrolLapisan } from './peta.js';
import { getJson } from './util.js';
import { temaAktif, gelapAktif } from './tema.js';

const L = window.L;
const ZOOM_MIN = 15;
const M_PER_LANTAI = 3.2;
const TINGGI_TANPA_DATA = 4;
const TINGGI_PENUH = 60; // gedung ≥ 60 m memakai warna paling pekat

// [tanpa data, rendah, tinggi, garis tepi]
const PALET = {
  awan: { terang: ['#d9dee8', '#b9cdfc', '#2f6bff', 'rgba(24,32,47,0.18)'], gelap: ['#2c3342', '#34497a', '#7aa0ff', 'rgba(0,0,0,0.45)'] },
  mochi: { terang: ['#e9e1ef', '#d6cdfa', '#7d6cf0', 'rgba(59,53,80,0.16)'], gelap: ['#352f45', '#4a4170', '#b3a8ff', 'rgba(0,0,0,0.4)'] },
  stiker: { terang: ['#f6e3bb', '#ffc2d4', '#d6336c', '#2b2340'], gelap: ['#3a3058', '#7a3a63', '#ff8fb3', '#f2e6cc'] },
};

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function campur(a, b, f) {
  const [x, y] = [hex(a), hex(b)];
  return x.map((v, i) => Math.round(v + (y[i] - v) * f));
}
const rgb = ([r, g, b], k = 1) => `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;

map.createPane('gedung');
map.getPane('gedung').style.zIndex = 350; // di atas peta dasar & zona, di bawah rute (400) dan penanda (600)
map.getPane('gedung').style.pointerEvents = 'none';

let data = []; // { p0: [x0,y0,x1,y1,...] (piksel dunia pada zoom 0), cx, cy, h, diketahui, warna }
let muatKe = 0;

const Gedung3D = L.Layer.extend({
  onAdd(m) {
    this._map = m;
    // Data baru diunduh saat lapisan dinyalakan
    if (lokasi && !data.length) muatData();
    this._c = L.DomUtil.create('canvas', 'gedung-3d', m.getPane('gedung'));
    this._c.style.position = 'absolute';
    m.on('move zoomend resize viewreset', this.gambarUlang, this);
    m.on('zoomstart', this._sembunyi, this);
    this.gambarUlang();
  },
  onRemove(m) {
    m.off('move zoomend resize viewreset', this.gambarUlang, this);
    m.off('zoomstart', this._sembunyi, this);
    this._c.remove();
    this._c = null;
  },
  _sembunyi() {
    if (this._c) this._c.style.visibility = 'hidden';
  },
  gambarUlang() {
    if (!this._c || this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._gambar();
    });
  },
  _gambar() {
    const m = this._map;
    const c = this._c;
    if (!m || !c) return;
    const size = m.getSize();
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== size.x * dpr || c.height !== size.y * dpr) {
      c.width = size.x * dpr;
      c.height = size.y * dpr;
      c.style.width = `${size.x}px`;
      c.style.height = `${size.y}px`;
    }
    const kiriAtas = m.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(c, kiriAtas);
    c.style.visibility = '';
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.x, size.y);
    const z = m.getZoom();
    if (z < ZOOM_MIN || !data.length) return;

    // Titik layar = piksel dunia zoom 0 × 2^z − asal piksel − posisi panel peta
    const s = 2 ** z;
    const asal = m.getPixelOrigin();
    const ox = asal.x + kiriAtas.x;
    const oy = asal.y + kiriAtas.y;
    const pxPerM = s * 256 / (40075016.686 * Math.cos((m.getCenter().lat * Math.PI) / 180));
    const cam = { x: size.x / 2, y: size.y * 1.05 };
    const camZ = Math.max(size.x, size.y) * 0.85;
    const pal = PALET[temaAktif()]?.[gelapAktif() ? 'gelap' : 'terang'] || PALET.awan.terang;
    const tegas = temaAktif() === 'stiker';
    const margin = 300;

    const tampak = [];
    for (const b of data) {
      const x = b.cx * s - ox;
      const y = b.cy * s - oy;
      if (x < -margin || y < -margin || x > size.x + margin || y > size.y + margin) continue;
      tampak.push({ b, d: (x - cam.x) ** 2 + (y - cam.y) ** 2 });
    }
    // Yang jauh dari kamera digambar dulu agar gedung di depan menutupinya
    tampak.sort((a, b) => b.d - a.d);

    g.lineJoin = 'round';
    for (const { b } of tampak) {
      const n = b.p0.length / 2;
      const hPx = Math.min(b.h * pxPerM, camZ * 0.55);
      const f = camZ / (camZ - hPx);
      const dasar = new Array(n);
      const atap = new Array(n);
      for (let i = 0; i < n; i++) {
        const x = b.p0[2 * i] * s - ox;
        const y = b.p0[2 * i + 1] * s - oy;
        dasar[i] = [x, y];
        atap[i] = [cam.x + (x - cam.x) * f, cam.y + (y - cam.y) * f];
      }
      // Arah putaran poligon menentukan sisi luar dinding
      let luas = 0;
      for (let i = 0; i < n; i++) {
        const [x1, y1] = dasar[i];
        const [x2, y2] = dasar[(i + 1) % n];
        luas += x1 * y2 - x2 * y1;
      }
      const arah = Math.sign(luas) || 1;
      g.strokeStyle = pal[3];
      g.lineWidth = tegas ? 1.2 : 0.6;
      for (let i = 0; i < n; i++) {
        const a = dasar[i];
        const bb = dasar[(i + 1) % n];
        // Normal luar dinding; hanya dinding yang menghadap kamera yang terlihat
        const nx = (bb[1] - a[1]) * arah;
        const ny = -(bb[0] - a[0]) * arah;
        const mx = (a[0] + bb[0]) / 2;
        const my = (a[1] + bb[1]) / 2;
        if (nx * (cam.x - mx) + ny * (cam.y - my) <= 0) continue;
        // Bayangan sederhana: dinding menghadap selatan/timur lebih terang
        const terang = 0.62 + 0.18 * (ny / (Math.hypot(nx, ny) || 1)) + 0.08 * (nx / (Math.hypot(nx, ny) || 1));
        g.fillStyle = rgb(b.warna, terang);
        g.beginPath();
        g.moveTo(a[0], a[1]);
        g.lineTo(bb[0], bb[1]);
        const ra = atap[i];
        const rb = atap[(i + 1) % n];
        g.lineTo(rb[0], rb[1]);
        g.lineTo(ra[0], ra[1]);
        g.closePath();
        g.fill();
        if (tegas) g.stroke();
      }
      g.fillStyle = rgb(b.warna);
      g.beginPath();
      atap.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
      g.stroke();
    }
  },
});

// Mati secara bawaan; bisa dinyalakan lewat tombol lapisan.
export const lapisanGedung3D = new Gedung3D();
kontrolLapisan.addOverlay(lapisanGedung3D, 'Gedung 3D (perbesar peta)');

function warnai() {
  const pal = PALET[temaAktif()]?.[gelapAktif() ? 'gelap' : 'terang'] || PALET.awan.terang;
  for (const b of data) {
    b.warna = b.diketahui ? campur(pal[1], pal[2], Math.min(1, b.h / TINGGI_PENUH)) : hex(pal[0]);
  }
}
document.addEventListener('tema:ganti', () => {
  warnai();
  lapisanGedung3D.gambarUlang();
});

let lokasi = null;

/** Catat lokasi baru (dipanggil main.js); data hanya diunduh bila lapisan sedang menyala. */
export function muatGedung3D(lat, lon) {
  lokasi = { lat, lon };
  muatKe++;
  data = [];
  lapisanGedung3D.gambarUlang();
  if (map.hasLayer(lapisanGedung3D)) muatData();
}

async function muatData() {
  const ke = ++muatKe;
  const { lat, lon } = lokasi;
  let d;
  try {
    d = await getJson(`/api/gedung?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, { timeout: 150000 });
  } catch (err) {
    console.warn('gedung 3D', err);
    return;
  }
  if (ke !== muatKe) return;
  const crs = map.options.crs;
  data = d.gedung.map((x) => {
    const p0 = [];
    let sx = 0;
    let sy = 0;
    // Titik terakhir sama dengan titik pertama (poligon tertutup), jadi dilewati
    const n = x.g.length / 2 - 1;
    for (let i = 0; i < n; i++) {
      const p = crs.latLngToPoint(L.latLng(x.g[2 * i], x.g[2 * i + 1]), 0);
      p0.push(p.x, p.y);
      sx += p.x;
      sy += p.y;
    }
    const diketahui = x.t != null || x.l != null;
    const h = x.t ?? (x.l != null ? x.l * M_PER_LANTAI : TINGGI_TANPA_DATA);
    return { p0, cx: sx / n, cy: sy / n, h, diketahui, nama: x.n };
  }).filter((b) => b.p0.length >= 6);
  warnai();
  lapisanGedung3D.gambarUlang();
}
