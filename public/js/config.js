// Radius analisis tiap jenis bahaya (km). Tiap bahaya punya jangkauan pengaruh yang berbeda:
// gempa besar terasa ratusan km, asap kebakaran puluhan km, sedangkan banjir/longsor sangat lokal.
export const RADIUS = {
  zona: { km: 15, warna: '#16a34a', label: 'Area zona bahaya berwarna' },
  gempa: { km: 300, warna: '#dc2626', label: 'Gempa (aktivitas & guncangan)' },
  sesar: { km: 100, warna: '#7c3aed', label: 'Sesar aktif' },
  gunung: { km: 150, warna: '#ea580c', label: 'Gunung api (abu vulkanik)' },
  kebakaran: { km: 100, warna: '#f59e0b', label: 'Titik api & asap' },
  tsunami: { km: 25, warna: '#0ea5e9', label: 'Tsunami (garis pantai)' },
  longsor: { km: 3, warna: '#0d9488', label: 'Longsor & banjir (lereng/sungai)' },
  aman: { km: 3, warna: '#16a34a', label: 'Pencarian tempat aman' },
  bangunan: { km: 0.6, warna: '#64748b', label: 'Data bangunan' },
};

export const DEFAULT_LOC = { lat: -6.2, lon: 106.816, label: 'Jakarta (lokasi bawaan)' };
export const AUTO_REFRESH_MS = 10 * 60 * 1000;

export const LEVEL_GUNUNG = {
  1: { nama: 'Normal', warna: '#16a34a', badge: 'rendah' },
  2: { nama: 'Waspada', warna: '#ca8a04', badge: 'sedang' },
  3: { nama: 'Siaga', warna: '#ea580c', badge: 'tinggi' },
  4: { nama: 'Awas', warna: '#dc2626', badge: 'bahaya' },
};
// Perkiraan umum radius larangan per level (km); rekomendasi resmi PVMBG berbeda tiap gunung.
export const RADIUS_BAHAYA_GUNUNG = { 1: 0, 2: 3, 3: 5, 4: 7 };
