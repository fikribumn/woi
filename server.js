// Server kecil tanpa dependensi: menyajikan folder public/ dan menjadi perantara (proxy + cache)
// untuk sumber data yang tidak bisa diakses langsung dari browser (CORS). Daftar endpoint /api/* dan
// logikanya ada di public/js/api-inti.mjs, yang juga dipakai aplikasi Android (android/).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UA = 'TerraWoi/0.3 (aplikasi pemantau lokal)';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------- Endpoint /api/* (logika bersama dengan aplikasi Android: public/js/api-inti.mjs) ----------
async function ambil(url, { timeout = 30000, json = false } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status} dari ${new URL(url).host}`);
  return json ? res.json() : res.text();
}

// Hasil Overpass juga disimpan ke disk (7 hari) karena server publik sering sibuk dan cache memori hilang saat restart.
const CACHE_OSM = path.join(__dirname, '.cache', 'osm');
const disk = {
  async baca(kunci, umurMs) {
    const berkas = path.join(CACHE_OSM, `${kunci}.json`);
    if (Date.now() - fs.statSync(berkas).mtimeMs >= umurMs) return null;
    return JSON.parse(fs.readFileSync(berkas, 'utf8'));
  },
  async tulis(kunci, nilai) {
    fs.mkdirSync(CACHE_OSM, { recursive: true });
    fs.writeFileSync(path.join(CACHE_OSM, `${kunci}.json`), JSON.stringify(nilai));
  },
};

const api = import('./public/js/api-inti.mjs').then(({ buatApi }) => buatApi({ ambil, disk }));

// ---------- HTTP ----------
function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Tidak ditemukan');
    }
    const ext = path.extname(filePath);
    const header = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (DEV) {
      header['Cache-Control'] = 'no-store';
      if (ext === '.html') data = String(data).replace('</body>', `${SKRIP_RELOAD}</body>`);
    }
    res.writeHead(200, header);
    res.end(data);
  });
}

// ---------- Mode pengembangan (npm run dev): muat ulang browser otomatis ----------
// Perubahan di public/ dikirim lewat Server-Sent Events: CSS diganti di tempat, berkas lain memuat ulang halaman.
// server.js sendiri dijalankan dengan `node --watch`, jadi browser memuat ulang begitu tersambung kembali.
const DEV = process.argv.includes('--dev');
const pendengar = new Set();
const SKRIP_RELOAD = `<script>(() => {
  let putus = false;
  const es = new EventSource('/__reload');
  es.onerror = () => { putus = true; };
  es.onopen = () => { if (putus) location.reload(); };
  es.onmessage = (e) => {
    if (e.data.endsWith('.css')) {
      for (const l of document.querySelectorAll('link[rel=stylesheet]')) {
        if (l.href.startsWith(location.origin)) l.href = l.href.split('?')[0] + '?v=' + Date.now();
      }
    } else location.reload();
  };
})();</script>`;

function pantauPerubahan() {
  let tunda = null;
  let berkas = '';
  fs.watch(PUBLIC_DIR, { recursive: true }, (_, nama) => {
    berkas = String(nama || '');
    clearTimeout(tunda);
    tunda = setTimeout(() => {
      console.log(`[dev] berubah: ${berkas}`);
      for (const res of pendengar) res.write(`data: ${berkas}\n\n`);
    }, 120);
  });
}

function sambungReload(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write('retry: 500\n\n');
  pendengar.add(res);
  req.on('close', () => pendengar.delete(res));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (DEV && u.pathname === '/__reload') return sambungReload(req, res);
  const a = await api;
  if (!a.punya(u.pathname)) return serveStatic(req, res);
  const { status, body } = await a.tangani(u);
  sendJson(res, status, body);
});

if (require.main === module) {
  if (DEV) pantauPerubahan();
  server.listen(PORT, () => console.log(`TERRA WOI berjalan di http://localhost:${PORT}${DEV ? ' (mode dev: muat ulang otomatis)' : ''}`));
}
