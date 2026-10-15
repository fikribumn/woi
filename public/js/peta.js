// Peta Leaflet: peta dasar, lapisan data, lapisan resmi Badan Geologi, dan lingkaran radius per bahaya.
import { RADIUS, DEFAULT_LOC } from './config.js';
import { temaAktif, gelapAktif } from './tema.js';

const L = window.L;

export const map = L.map('map', { zoomControl: false }).setView([DEFAULT_LOC.lat, DEFAULT_LOC.lon], 12);
L.control.zoom({ position: 'bottomright' }).addTo(map);

// Peta dasar Esri Canvas (gratis tanpa API key) agar zona berwarna menonjol; label di lapisan terpisah
// di atas zona. Nuansa tiap tema (krem untuk Mochi, kertas kuning untuk Stiker) diberikan lewat CSS
// filter pada .peta-dasar. Mode gelap memakai versi Dark Gray.
// Catatan: CARTO basemaps tidak dipakai karena kini mewajibkan API key.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
function urlDasar() {
  const gaya = gelapAktif() ? 'World_Dark_Gray' : 'World_Light_Gray';
  return { dasar: `${ESRI}/${gaya}_Base/MapServer/tile/{z}/{y}/{x}`, label: `${ESRI}/${gaya}_Reference/MapServer/tile/{z}/{y}/{x}` };
}
const opsiEsri = { maxZoom: 19, maxNativeZoom: 16 };
const url0 = urlDasar();
const dasar = L.tileLayer(url0.dasar, { ...opsiEsri, className: 'peta-dasar', attribution: 'Esri, HERE, Garmin, &copy; OpenStreetMap' });
const label = L.tileLayer(url0.label, { ...opsiEsri, className: 'peta-label', zIndex: 260 });
const kanvas = L.layerGroup([dasar, label]).addTo(map);
document.addEventListener('tema:ganti', () => {
  const u = urlDasar();
  if (dasar._url !== u.dasar) dasar.setUrl(u.dasar);
  if (label._url !== u.label) label.setUrl(u.label);
});
const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap',
});
const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  maxZoom: 17,
  attribution: '&copy; OpenStreetMap, SRTM | &copy; OpenTopoMap (CC-BY-SA)',
});

/**
 * Lapisan gambar dinamis dari ArcGIS MapServer (Geoportal ESDM). Satu gambar per tampilan peta,
 * diminta ulang setelah peta digeser. Gambar tidak terkena CORS sehingga bisa langsung dari server ESDM.
 */
const EsriDinamis = L.Layer.extend({
  initialize(url, opts = {}) {
    this._url = url;
    this._opacity = opts.opacity ?? 0.55;
    this.options.attribution = opts.attribution;
  },
  onAdd(m) {
    this._map = m;
    m.on('moveend', this._muat, this);
    this._muat();
  },
  onRemove(m) {
    m.off('moveend', this._muat, this);
    if (this._img) m.removeLayer(this._img);
    if (this._baru) m.removeLayer(this._baru);
    this._img = null;
    this._baru = null;
  },
  _muat() {
    const m = this._map;
    if (!m) return;
    const b = m.getBounds();
    const s = m.getSize();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');
    const src = `${this._url}/export?bbox=${bbox}&bboxSR=4326&imageSR=3857&size=${s.x},${s.y}`
      + '&format=png32&transparent=true&dpi=96&f=image';
    if (this._baru) m.removeLayer(this._baru);
    const baru = L.imageOverlay(src, b, { opacity: this._opacity, interactive: false, zIndex: 5 });
    this._baru = baru;
    baru.once('load', () => {
      if (this._baru !== baru) return;
      if (this._img) m.removeLayer(this._img);
      this._img = baru;
      this._baru = null;
    });
    baru.addTo(m);
  },
});

const ESDM = 'https://geoportal.esdm.go.id/gis4/rest/services';
const esdm = (svc, opacity) => new EsriDinamis(`${ESDM}/${svc}/MapServer`, { opacity, attribution: 'Badan Geologi – ESDM' });

export const lapisanResmi = {
  'Geologi (litologi)': esdm('BGS_PM/Geologi_Litologi', 0.5),
  'Patahan aktif': esdm('BGS_PM/Patahan_Aktif_Skala_Besar', 0.9),
  'Zona kerentanan gerakan tanah': esdm('BGV_GT/Zona_Kerentanan_Gerakan_Tanah', 0.5),
  'Prakiraan gerakan tanah bulan ini': esdm('BGV_GT/Prakiraan_Gerakan_Tanah_Bulanan', 0.5),
  'KRB gempa bumi': esdm('BGV_GT/KRB_Gempa_Bumi', 0.45),
  'KRB gunung api': esdm('BGV_GA/KRB_Gunung_Api_Area', 0.5),
  'KRB tsunami': esdm('BGV_GT/KRB_Tsunami', 0.55),
  'Kerentanan likuefaksi': esdm('BGE_GT/Kerentanan_Likuefaksi', 0.45),
};

export const lapisan = {
  gempa: L.layerGroup().addTo(map),
  sesar: L.layerGroup().addTo(map),
  gunung: L.layerGroup().addTo(map),
  api: L.layerGroup().addTo(map),
  bangunan: L.layerGroup(),
  aman: L.layerGroup().addTo(map),
  jarak: L.layerGroup().addTo(map),
  evakuasi: L.layerGroup().addTo(map),
};

const radiusLayer = {};
for (const [k, r] of Object.entries(RADIUS)) {
  radiusLayer[k] = L.layerGroup();
}

export const kontrolLapisan = L.control.layers(
  { 'Sesuai tema': kanvas, 'OpenStreetMap': osm, 'Topografi': topo },
  {
    'Gempa terkini': lapisan.gempa,
    'Sesar & subduksi': lapisan.sesar,
    'Gunung api': lapisan.gunung,
    'Titik api (FIRMS)': lapisan.api,
    'Bangunan bertingkat': lapisan.bangunan,
    'Tempat aman': lapisan.aman,
    'Garis jarak ke sumber bahaya': lapisan.jarak,
    ...Object.fromEntries(Object.entries(lapisanResmi).map(([n, l]) => [`<span class="ov-resmi">${n}</span>`, l])),
    ...Object.fromEntries(Object.entries(RADIUS).map(([k, r]) => [
      `<span class="ov-radius" style="--c:${r.warna}">Radius ${r.label} · ${r.km < 1 ? `${r.km * 1000} m` : `${r.km} km`}</span>`,
      radiusLayer[k],
    ])),
  },
  { collapsed: true },
).addTo(map);

// Radius bawaan yang langsung terlihat: batas area zona berwarna
radiusLayer.zona.addTo(map);

let markerSaya = null;

export function setPusat(lat, lon) {
  if (markerSaya) markerSaya.remove();
  const ikon = L.divIcon({ className: '', html: '<div class="pin-saya"></div>', iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -12] });
  // Pin bisa diseret untuk memindahkan lokasi yang dianalisis (ditangani pindah.js lewat event 'lokasi:seret').
  markerSaya = L.marker([lat, lon], { icon: ikon, zIndexOffset: 1000, draggable: true, autoPan: true, title: 'Seret untuk memindahkan lokasi' })
    .addTo(map)
    .bindPopup('Lokasi yang diperiksa. Seret pin ini untuk pindah posisi.');
  markerSaya.on('dragend', (e) => {
    const p = e.target.getLatLng();
    document.dispatchEvent(new CustomEvent('lokasi:seret', { detail: { lat: p.lat, lon: p.lng } }));
  });
  for (const [k, r] of Object.entries(RADIUS)) {
    radiusLayer[k].clearLayers();
    L.circle([lat, lon], {
      radius: r.km * 1000,
      color: r.warna,
      weight: 1.5,
      dashArray: '6 6',
      fill: false,
      interactive: false,
    }).addTo(radiusLayer[k]);
  }
  map.setView([lat, lon], Math.max(map.getZoom(), 12));
}

export function bersihkanLapisan() {
  for (const k of ['gempa', 'sesar', 'gunung', 'api', 'bangunan', 'aman', 'jarak']) lapisan[k].clearLayers();
}

/** Garis putus-putus dari lokasi ke sumber bahaya, dengan label jarak. */
export function garisJarak(dari, ke, warna, label) {
  L.polyline([dari, ke], { color: warna, weight: 2, dashArray: '4 6', opacity: 0.9 })
    .bindTooltip(label, { sticky: true })
    .addTo(lapisan.jarak);
}

export function ikonSegitiga(warna) {
  return L.divIcon({ className: '', html: `<div class="volc-icon" style="--c:${warna}"></div>`, iconSize: [16, 14], iconAnchor: [8, 14] });
}

export function ikonTitik(kelas, isi = '') {
  return L.divIcon({ className: '', html: `<div class="pin ${kelas}">${isi}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] });
}
