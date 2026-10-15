# TERRA WOI

*(sebelumnya: Waspada Bencana)*

Web app berbasis peta untuk melihat potensi bencana alam di sekitar lokasi Anda (Indonesia), lengkap dengan kondisi geologi, jarak ke sumber bahaya, dan rekomendasi tempat paling aman.

## Tampilan

Ada tiga tema yang bisa dipilih lewat tombol palet (🎨) di kanan atas peta. Pilihan tersimpan di perangkat dan bisa juga diatur lewat URL `?tema=mochi`:

| Tema | Gaya | Peta dasar |
|---|---|---|
| **Awan** (bawaan) | putih, lapang | Esri Canvas terang, zona dihaluskan seperti heatmap |
| **Mochi** | pastel lembut, sudut bulat | Esri Canvas bernuansa krem, zona bertepi lembut |
| **Stiker** | ilustrasi datar, garis tepi tegas dan bayangan keras | Esri Canvas bernuansa kertas kuning, zona lebih tegas |

Semua tema memakai font Poppins. Semua peta dasar gratis tanpa API key. Nuansa tiap tema dibuat dengan CSS filter di `style.css` (`.peta-dasar`).

Mode **Otomatis / Terang / Gelap** ada di panel yang sama. Setiap tema punya set warna terang dan gelap sendiri (`style.css`, blok `[data-tema]` dan `[data-gelap]`). Warna zona tetap hijau, kuning, oranye, merah di semua tema.

Tata letaknya:
- Peta penuh layar, label peta di lapisan terpisah di atas zona berwarna.
- Di desktop, **panel kaca** mengambang di kiri dengan tinggi menyesuaikan isinya. Panel bisa **diciutkan** (tombol di pojok kanan atasnya) menjadi kartu kecil berisi lokasi dan ringkasan risiko. Pilihan ini diingat, dan panel otomatis diciutkan saat Mode Darurat dibuka. Di HP, panel menjadi **bottom sheet** yang mulai dari posisi intip, bisa ditarik ke setengah atau penuh, dan otomatis turun saat peta digeser.
- Beranda mendahulukan tindakan (Titik Kumpul, Tempat Paling Aman, Jarak), lalu **ubin ringkasan** per bencana dengan warna tingkat risiko. Ketuk ubin untuk membuka halaman detail, lalu kembali lewat tombol "‹ Ringkasan".
- Chip pemilih zona, legenda, dan tombol peta (lokasi, lapisan, muat ulang) mengambang di atas peta. Tombol merah **Darurat** ada di kanan bawah.
- Ikon memakai Lucide, dan warna memakai palet sistem iOS.

## Peta zona bahaya berwarna

Peta mengisi layar, dan area dalam radius 15 km dari lokasi diwarnai per titik (±40 m pada zoom 12):

| Warna | Arti |
|---|---|
| 🟩 Hijau | Aman untuk bencana yang dipilih |
| 🟨 Kuning | Waspada |
| 🟧 Oranye | Rawan |
| 🟥 Merah | Bahaya |

Pilih bencana di kotak **Zona bahaya** (kiri bawah peta):

| Pilihan | Dasar perhitungan |
|---|---|
| Gabungan | tingkat tertinggi dari semua bencana |
| Sesar gempa | jarak ke patahan aktif Badan Geologi (≤ 0,5 / 2 / 5 km) |
| Tsunami | elevasi DEM dan jarak ke garis pantai |
| Banjir | jarak dan ketinggian relatif terhadap sungai, dataran pesisir rendah, hujan |
| Longsor | kemiringan lereng dari DEM, hujan |
| Gunung api | radius bahaya sesuai status, sebaran abu searah angin |
| Kebakaran & asap | jarak ke titik api dan jalur asap searah angin |

Ketuk di mana pun pada peta untuk melihat tingkat semua bencana di titik itu. Tombol **Analisis lokasi ini** memindahkan analisis ke titik tersebut. Pilihan zona tersimpan di URL (`&zona=banjir`), dan tab **Tempat Paling Aman** ikut menyesuaikan. Tujuan evakuasi yang berada di zona rawan/bahaya disaring keluar.

Zona dihitung di browser dari DEM Terrarium (AWS Open Data), jadi hasilnya adalah perkiraan, bukan peta resmi. Untuk peta resmi, aktifkan lapisan KRB Badan Geologi lewat tombol lapisan.

| Kartu | Isi | Radius analisis |
|---|---|---|
| 🧭 Tempat Paling Aman | Tujuan evakuasi per bahaya (gempa, tsunami, gunung api, banjir/longsor, kebakaran), ditentukan dari titik kumpul OSM, ruang terbuka, dataran tinggi (grid elevasi), gedung bertingkat, dan arah menjauhi sumber bahaya; rute mengikuti jalan (OSRM, jalan kaki ≤ 4 km, kendaraan bila lebih jauh) beserta waktu tempuh; disertai RS/pemadam/polisi terdekat | ±3 km (tsunami ±10 km) |
| 📏 Jarak ke Sumber Bahaya | Jarak dan arah ke sesar aktif, zona subduksi, episenter, gunung api, titik api, sungai, garis pantai, dan lereng curam, dibandingkan dengan jarak pengaruh masing-masing | — |
| 🌏 Gempa & Sesar | Gempa terkini (BMKG, USGS), perkiraan MMI di lokasi, KRB gempa, sesar aktif terdekat beserta sejarah gempanya, jarak ke megathrust | 300 km / sesar 100 km |
| 🌊 Tsunami | Jarak ke pantai, elevasi, KRB tsunami, jarak ke zona subduksi | 15 km dari pantai |
| 🌧️ Hujan, Longsor & Banjir | Curah hujan, Zona Kerentanan Gerakan Tanah, prakiraan gerakan tanah bulanan, lereng, jarak ke sungai | 3 km |
| 🌋 Gunung Api | Status live MAGMA, KRB gunung api, potensi abu berdasarkan arah angin | 150 km |
| 🔥 Kebakaran Hutan & Lahan | Titik panas satelit 48 jam, potensi asap (arah angin), kekeringan | 100 km |
| 😷 Kualitas Udara | AQI, PM2.5, PM10, CO, NO₂, O₃, SO₂ beserta prakiraan 24 jam | titik lokasi |
| 🪨 Kondisi Geologi | Satuan batuan dan umur (Peta Geologi 1:100.000), likuefaksi, dan artinya bagi bahaya | titik lokasi |
| 🏢 Tinggi Bangunan | Jumlah bangunan, sebaran jumlah lantai, gedung tertinggi, kandidat evakuasi vertikal | 600 m |

Di peta (tombol lapisan, kanan atas) Anda bisa:
- mengaktifkan lapisan resmi Badan Geologi: geologi, patahan aktif, zona kerentanan gerakan tanah, prakiraan gerakan tanah, KRB gempa, KRB gunung api, KRB tsunami, dan likuefaksi;
- menampilkan lingkaran radius analisis tiap bahaya;
- melihat **Gedung 3D** (mati secara bawaan, data baru diunduh saat dinyalakan, tampil pada zoom ≥ 15). Bentuk gedung dalam radius 800 m dari lokasi diambil dari OSM, lalu ditinggikan sesuai `height`/`building:levels`. Warnanya makin pekat untuk gedung yang lebih tinggi, dan gedung tanpa data tinggi dianggap 1 lantai dengan warna netral (`gedung3d.js`, `/api/gedung`).

Rute ke tempat aman dan rute evakuasi selalu mengikuti jalan (OSRM). Permintaan rute diantrekan (maks. 2 sekaligus), dicoba ulang bila gagal, dan disimpan selama sesi. Grid pencarian area aman dikunci ke kisi tetap, jadi GPS yang bergeser beberapa meter tidak mengubah tujuan yang dipilih.

## Laporan banjir & bencana dari warga 🌊

Data dari [PetaBencana.id](https://petabencana.id) (CC BY-NC 4.0, non-komersial, atribusi wajib), lewat `/api/laporan` dengan cache 5 menit (`laporan.js`):
- **Lapisan peta "Laporan warga"**: laporan 48 jam terakhir (banjir, kebakaran, asap, gunung api, gempa, angin) beserta waktu, kedalaman air, teks, dan foto. Ada juga **area banjir resmi Jakarta** (per RT, diwarnai sesuai tinggi genangan). Area yang tidak diperbarui lebih dari 12 jam dianggap sudah surut.
- **Peringatan**: kalau ada laporan banjir baru (≤ 6 jam) dalam radius 5 km, muncul notifikasi di layar, plus notifikasi browser bila diizinkan dan tab tidak sedang dilihat.
- **Kartu Hujan & Banjir** menampilkan jumlah laporan banjir dalam 5 km dan **prakiraan debit sungai GloFAS** (Open-Meteo Flood API). Tingkat banjir naik kalau ada laporan dalam 2 km pada 6 jam terakhir, atau kalau debit diperkirakan naik ≥ 3× rata-rata seminggu.
- **Rute evakuasi** (Mode Darurat & gempa) diberi penalti +15 menit per titik banjir yang dilewati. Titik itu ditandai di peta dan diberi peringatan. Tempat Paling Aman juga menandai rute yang melewati laporan banjir.

Laporan berasal dari warga dan hanya ada kalau ada yang melapor, jadi "tidak ada laporan" tidak berarti aman.

## Pindah posisi 🧭

Lokasi yang dianalisis bisa diganti tanpa GPS, misalnya untuk menguji aplikasi di daerah lain (`pindah.js`):
- **Seret pin biru** ke mana saja, dan analisis langsung diulang di titik baru.
- Tombol **Pindah posisi** (ikon panah empat arah) berisi tombol geser 250 m ke utara/selatan/barat/timur, daftar **kota uji** (Padang, Palu, Jakarta Timur, Sleman, Banda Aceh, Lembang, Palangka Raya, Karo) dengan bahaya yang berbeda-beda, dan tombol kembali ke lokasi GPS.
- Kalau peta digeser jauh dari lokasi, muncul tombol **Kembali ke posisi** untuk memusatkan peta lagi.

## Titik kumpul & tempat evakuasi

Belum ada data titik kumpul nasional yang terbuka, jadi aplikasi menggabungkan beberapa sumber, dari yang paling andal:

| Jenis | Sumber | Penanda |
|---|---|---|
| **Resmi BNPB** | InaRISK – Rencana Evakuasi (TES, TEA, titik kumpul, evakuasi vertikal). Saat ini baru mencakup daerah percontohan, misalnya Badung, Bali | kotak hijau **R** |
| **Ditandai Anda** | Ketuk peta → *Tandai sebagai titik kumpul*. Tersimpan di perangkat (localStorage) | kotak biru **★** |
| **OSM** | `emergency=assembly_point/evacuation_point/shelter`, `evacuation_center=yes` | kotak toska **K** |
| Shelter OSM | `amenity=shelter` (bisa sekadar gazebo) | kotak ungu **S** |
| Potensial | sekolah, tempat ibadah, kantor pemerintah dalam 3 km. **Bukan titik resmi** | titik abu-abu (tampil di zoom ≥ 14) |

Titik-titik ini ditampilkan di halaman **Titik Kumpul & Evakuasi**, ikut diusulkan di **Tempat Paling Aman** (setelah disaring dengan zona bahaya), dan dipakai sebagai kandidat tujuan di **Mode Darurat**. Titik resmi dan titik pribadi diberi prioritas. Untuk tsunami, gedung TES/evakuasi vertikal resmi tetap sah sebagai tujuan walaupun berada di zona genangan.

## Mode Darurat 🚨

Tekan tombol **🚨 Darurat** lalu pilih bencana yang sedang terjadi. Aplikasi akan:
1. Menilai grid titik di sekitar Anda (elevasi DEM, kemiringan lereng, zona semua bencana). Grid berjarak 80–120 m untuk evakuasi jalan kaki dan 300–500 m untuk evakuasi kendaraan.
2. Mencari **area** aman terdekat, bukan titik tunggal: minimal 6 dari 8 titik di sekitarnya juga harus aman. Kriterianya:

| Bencana | Kriteria area aman | Radius | Moda |
|---|---|---|---|
| Tsunami | zona tsunami aman, elevasi ≥ 20 m (≥ 30 m bila subduksi < 300 km), tidak rawan longsor | 6 km | jalan kaki |
| Banjir | ≥ 3 m lebih tinggi dari lokasi, landai, jauh dari sungai | 3 km | jalan kaki |
| Longsor | lereng < 8°, sekitarnya < 15° (tidak di kaki tebing) | 2,5 km | jalan kaki |
| Gempa | dua tahap, lihat di bawah | 1,5 km / 5 km | jalan kaki |
| Gunung api | di luar radius bahaya & jalur abu, tidak di lembah sungai | 25 km | kendaraan |
| Kebakaran | di luar jangkauan api & asap | 15 km | kendaraan |

3. Membuat rute ke 5 kandidat (OSRM, routing.openstreetmap.de), lalu memilih rute tercepat dengan penalti bila melewati zona bahaya.
4. Menampilkan waktu tempuh, jarak, profil elevasi sepanjang rute, peringatan, tombol **Navigasi (Google Maps)**, dan rute alternatif.

Untuk tsunami, waktu tempuh dibandingkan dengan perkiraan kasar waktu tiba tsunami dari zona subduksi. Bila tidak sempat, aplikasi menyarankan evakuasi vertikal ke gedung tinggi terdekat.

**Gempa** punya alur sendiri (`evakuasi-gempa.js`) dengan tiga tab:
1. **Titik kumpul**: tempat dituju begitu guncangan berhenti. Pilihannya ruang terbuka terdekat (titik kumpul resmi/pribadi/OSM, taman, lapangan, halaman sekolah) dalam 1,5 km dan ≤ 25 menit jalan kaki. Titik ditolak bila tepat di jalur sesar, di lereng ≥ 15°, di bawah tebing, atau di zona tsunami (untuk pesisir rendah). Titik dalam jangkauan runtuhan gedung bertingkat diberi penalti.
2. **Pengungsian**: area landai dan kering untuk bermalam selama gempa susulan, dalam 5 km. Area harus di luar zona sesar, longsor, banjir/likuefaksi, dan tsunami. Diutamakan yang dekat fasilitas umum (air, toilet, atap).
3. **Saran**: langkah saat guncangan, segera sesudahnya, di perjalanan, di pengungsian, dan persiapan. Isinya disesuaikan dengan lokasi: jarak ke sesar, likuefaksi, gedung tinggi, hujan, rute yang melintasi jembatan, dan waktu malam.

Rute jalan kaki dianalisis terhadap medan: waktu dikoreksi tanjakan (fungsi Tobler), dan aplikasi memperingatkan bila rute melintasi sungai/jembatan, lereng curam, jalur sesar, zona genangan tsunami, atau dataran rendah dekat sungai. Di pesisir rendah, panel menampilkan peringatan tsunami beserta tombol **Rute ke tanah tinggi**. Bila layanan rute tidak terjangkau, arah ditunjukkan dengan garis lurus.

## Pemantauan live 🔴

Indikator **LIVE** (kanan atas peta; di HP kiri bawah) memeriksa BMKG (`autogempa`, `gempadirasakan`) tiap 30 detik (`pantau.js`). Untuk setiap gempa baru dalam 1 jam terakhir, aplikasi menghitung perkiraan guncangan di lokasi Anda (MMI dari magnitudo, jarak, dan kedalaman):

| Kondisi | Tindakan |
|---|---|
| Potensi tsunami (BMKG) dan lokasi di pesisir rendah, ≤ 600 km | Layar peringatan merah + sirene + getar, hitung mundur perkiraan gelombang tiba, tombol **Rute ke tempat tinggi** |
| MMI ≥ 6 | Peringatan merah "Gempa kuat" |
| MMI 4–5 | Peringatan oranye "Gempa terasa" |
| MMI 3 | Pemberitahuan tanpa sirene |

Langkah segera di layar peringatan menyesuaikan posisi Anda (mis. di lantai atas: jangan pakai lift; tsunami di lantai yang sudah cukup tinggi: tetap di atas). Tombol evakuasi membuka Mode Darurat. Kejadian yang sudah diperingatkan tidak diulang. Notifikasi browser bisa diaktifkan dari menu LIVE (muncul saat tab tidak dilihat; belum bekerja saat browser ditutup karena butuh server push).

**Simulasi untuk demo/latihan:** menu LIVE → *Simulasi gempa* / *Simulasi tsunami*, atau URL `?lat=-0.95&lon=100.36&demo=tsunami`. Layar simulasi selalu berlabel **SIMULASI · bukan kejadian nyata**.

### Posisi vertikal (lantai) 🏢

Saran darurat menyesuaikan posisi Anda di gedung (`posisi.js`):
- **Altitude GPS**: bila perangkat memberi altitude dengan akurasi ≤ 20 m, tinggi di atas tanah dihitung dari *altitude − tinggi geoid − elevasi tanah*, lalu dibagi ±3,5 m per lantai. Koreksi geoid memakai EGM96 (`public/data/geoid.json`, dibuat dengan `tools/buat-geoid.js`) karena Android melaporkan tinggi di atas elipsoid WGS84; di Indonesia selisihnya −9 m (Padang) sampai +75 m (Papua). Safari iOS sudah melaporkan tinggi di atas permukaan laut. Elevasi tanah diambil dari nilai DEM terendah dalam ±100 m agar atap gedung tidak ikut terhitung.
- **Pilihan lantai**: bila altitude tidak tersedia atau kurang akurat, panel menampilkan pilihan cepat (luar ruangan, lantai 1, 2–3, …, > 40) atau isian lantai tepat. Pilihan manual selalu dipakai lebih dulu dan berlaku 3 jam.

Contoh saran: di lantai 30 saat gempa, jangan ke tangga atau lift, tunggu arahan pengelola, dan turun hanya bila ada api, gas, atau kerusakan struktur. Saat tsunami di lantai ≥ 3 yang sudah di atas batas aman, tetap di atas dan jangan turun. Saat banjir, jangan turun ke basement.

Selama mode darurat terbuka, penanda "Tempat aman" disembunyikan supaya tidak tertukar dengan tujuan evakuasi.

URL `?darurat=tsunami` langsung membuka mode darurat.

## Menjalankan

```bash
npm start          # biasa
npm run dev        # pengembangan: browser memuat ulang otomatis saat berkas berubah
```

Buka http://localhost:8080. Proyek ini butuh Node.js 18+ dan tidak memerlukan `npm install`.

Lokasi bisa diatur lewat GPS, kolom pencarian, tombol **Analisis lokasi ini** pada popup peta, atau URL `?lat=-6.88&lon=107.62&zona=tsunami`. URL ini juga bisa dibagikan. 

## Struktur

```
server.js              Server statis + proxy/cache untuk sumber yang memblokir CORS
public/index.html
public/style.css
public/js/
  main.js              Orkestrasi & pemilihan lokasi
  konteks.js           Data bersama per lokasi (cuaca, geologi, OSM, grid elevasi)
  peta.js              Leaflet, lapisan ESDM, radius per bahaya
  config.js            Radius & ambang tiap bahaya
  gempa.js tsunami.js hujan.js gunung.js kebakaran.js udara.js geologi.js bangunan.js
  jarak.js aman.js     Ringkasan jarak & rekomendasi tempat aman
  zona.js              Peta zona bahaya berwarna (raster per tile), legenda, popup klik
  evakuasi.js          Mode darurat: cari area aman terdekat + rute
  evakuasi-gempa.js    Mode darurat gempa: titik kumpul segera, area pengungsian, saran
  rute.js              Rute OSRM + analisis medan (profil elevasi, Tobler, jembatan, zona)
  ui.js                Ubin ringkasan, navigasi halaman, bottom sheet, ikon, pemilih tema
  gedung3d.js          Gedung 3D (canvas perspektif di atas peta, warna per tema)
  tema.js              Tema (Awan, Mochi, Stiker) & mode terang/gelap; event 'tema:ganti'
  titikkumpul.js       Titik kumpul gabungan (BNPB, pribadi, OSM, potensial)
  pantau.js            Pemantauan live BMKG, layar peringatan, sirene, simulasi
  posisi.js            Posisi vertikal: altitude GPS (koreksi geoid) atau pilihan lantai, saran per lantai
  dem.js indeks.js     Pembaca tile elevasi Terrarium & indeks spasial titik terdekat
  data-gunung.js       Koordinat 69 gunung api + status cadangan
public/data/subduksi.json   Jalur subduksi (dibuat dengan tools/buat-subduksi.js)
public/data/geoid.json      Tinggi geoid EGM96 wilayah Indonesia (dibuat dengan tools/buat-geoid.js)
```

### Endpoint server

| Endpoint | Sumber | Cache |
|---|---|---|
| `/api/gunung` | MAGMA Indonesia (status gunung api) | 30 menit |
| `/api/geologi?lat&lon` | Geoportal ESDM: litologi, KRB gempa/tsunami/gunung api, gerakan tanah, likuefaksi | 6 jam |
| `/api/sesar?lat&lon&r` | Geoportal ESDM: patahan aktif (skala detail + regional) | 24 jam |
| `/api/titik-api?lat&lon&r` | NASA FIRMS VIIRS (S-NPP + NOAA-20), 48 jam | 30 menit |
| `/api/osm?lat&lon` | OpenStreetMap Overpass: bangunan, titik kumpul, fasilitas, sungai, pantai | 7 hari di disk (`.cache/osm/`), dicoba ulang bila server sibuk |
| `/api/gedung?lat&lon` | OpenStreetMap Overpass: bentuk & tinggi gedung radius 800 m | 7 hari di disk |
| `/api/evakuasi-resmi?lat&lon` | BNPB InaRISK: titik kumpul, TES, TEA, evakuasi vertikal/horizontal (radius 15 km) | 24 jam |

Sumber lain diakses langsung dari browser: BMKG, USGS, Open-Meteo (cuaca, elevasi, kualitas udara, geocoding), Macrostrat (cadangan data geologi), dan Nominatim.

## Batasan

- Gempa bumi **tidak bisa diprediksi**. Kartu gempa menggabungkan bahaya jangka panjang (KRB, sesar) dengan aktivitas terkini.
- Skor longsor, banjir, tsunami, dan kebakaran adalah heuristik dari data terbuka, bukan model resmi.
- Grid elevasi memakai DEM ±90 m dengan jarak antartitik 750 m (lokal) dan 2,5 km (tsunami). Lokasi "tempat aman" belum memperhitungkan jalan atau akses, jadi utamakan jalur evakuasi BPBD.
- Data tinggi bangunan dari OSM belum lengkap di Indonesia. Hanya bangunan yang punya tag `building:levels`/`height` yang dihitung.
- Cakupan KRB tsunami resmi baru sebagian pesisir. Radius bahaya gunung api (3/5/7 km) hanya perkiraan umum.
- Server Overpass publik kadang sibuk, sehingga kartu Bangunan, Tsunami, dan Tempat Aman bisa lambat pada pemuatan pertama.
- Aplikasi ini bukan sistem peringatan dini resmi. Ikuti arahan BMKG, PVMBG, dan BPBD.

## Lisensi data

OpenStreetMap (ODbL), GEM Global Active Faults (CC BY-SA 4.0), Macrostrat (CC BY 4.0), NASA FIRMS, Open-Meteo (CC BY 4.0), Copernicus CAMS, BMKG, Badan Geologi/ESDM.
