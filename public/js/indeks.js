// Indeks spasial sederhana (bin lintang/bujur) untuk mencari titik terdekat dengan cepat.

export class IndeksTitik {
  constructor(selDerajat = 0.01) {
    this.sel = selDerajat;
    this.bin = new Map();
    this.jumlah = 0;
  }

  tambah(lat, lon, data = null) {
    const k = `${Math.floor(lat / this.sel)},${Math.floor(lon / this.sel)}`;
    let b = this.bin.get(k);
    if (!b) this.bin.set(k, (b = []));
    b.push({ lat, lon, data });
    this.jumlah++;
  }

  /** Titik terdekat dalam maksKm. Mengembalikan { km, lat, lon, data } atau null. */
  terdekat(lat, lon, maksKm) {
    if (!this.jumlah) return null;
    const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
    const r = Math.ceil(maksKm / (this.sel * Math.min(kx, 110.57)));
    const bi = Math.floor(lat / this.sel);
    const bj = Math.floor(lon / this.sel);
    let terbaik = null;
    let d2Min = maksKm * maksKm;
    for (let i = bi - r; i <= bi + r; i++) {
      for (let j = bj - r; j <= bj + r; j++) {
        const b = this.bin.get(`${i},${j}`);
        if (!b) continue;
        for (const t of b) {
          const dx = (t.lon - lon) * kx;
          const dy = (t.lat - lat) * 110.57;
          const d2 = dx * dx + dy * dy;
          if (d2 <= d2Min) {
            d2Min = d2;
            terbaik = t;
          }
        }
      }
    }
    return terbaik ? { km: Math.sqrt(d2Min), lat: terbaik.lat, lon: terbaik.lon, data: terbaik.data } : null;
  }
}

/** Menyisipkan titik pada garis sehingga jarak antartitik ≤ langkahKm. Garis: [[lat,lon],...]. */
export function rapatkan(garis, langkahKm) {
  const out = [];
  for (let i = 0; i < garis.length; i++) {
    const [a, b] = garis[i];
    out.push([a, b]);
    if (i + 1 >= garis.length) break;
    const [c, d] = garis[i + 1];
    const km = Math.hypot((c - a) * 110.57, (d - b) * 111.32 * Math.cos((a * Math.PI) / 180));
    const n = Math.floor(km / langkahKm);
    for (let k = 1; k <= n; k++) out.push([a + ((c - a) * k) / (n + 1), b + ((d - b) * k) / (n + 1)]);
  }
  return out;
}
