# Merilis TERRA WOI untuk Android

## 1. Menaikkan versi

Ubah dua atribut di `android/AndroidManifest.xml`:

- `android:versionCode`: bilangan bulat, **wajib naik** setiap rilis (2 → 3 → …).
- `android:versionName`: versi yang terlihat pengguna, mis. `1.2.0`.

## 2. Membangun

Lokal (butuh JDK 17+ dan Android SDK atau paket Ubuntu, lihat README):

```bash
npm run apk            # APK saja
bash android/build.sh aab   # APK + AAB (Google Play)
```

Lewat GitHub Actions (tanpa menyiapkan apa pun di komputer):

1. Sekali saja, isi *Settings → Secrets and variables → Actions*:
   - `KEYSTORE_B64`: hasil `base64 -w0 android/keystore/terra-woi.jks`
   - `KS_PASS`: isi `android/keystore/kata-sandi.txt`
2. Dorong tag versi: `git tag v1.2.0 && git push origin v1.2.0`.
3. Workflow **Android** membangun APK & AAB dan membuat GitHub Release.

Aplikasi memeriksa GitHub Release terbaru sekali sehari dan menampilkan tombol **Unduh** bila ada versi baru. Pemeriksaan ini hanya berhasil bila rilis bisa dibaca publik. Selama repositori privat, pengguna tidak akan mendapat pemberitahuan.

## 3. Kunci tanda tangan

`android/keystore/terra-woi.jks` + `kata-sandi.txt` adalah satu-satunya kunci untuk memperbarui aplikasi yang sudah terpasang. Simpan cadangannya di tempat aman (mis. pengelola kata sandi). Jangan di-commit, karena folder ini sudah diabaikan git.

Di Google Play, kunci ini menjadi **upload key**. Aktifkan *Play App Signing* agar Google menyimpan kunci aplikasi.

## 4. Google Play Console

Unggah `terra-woi-<versi>.aab`. Isian yang perlu disiapkan:

**Kebijakan privasi**: publikasikan `docs/KEBIJAKAN-PRIVASI.md` sebagai halaman web (mis. GitHub Pages) lalu tempel URL-nya.

**Keamanan data (Data safety)**:
- Mengumpulkan data? **Tidak**. Lokasi dikirim langsung dari perangkat ke penyedia data publik untuk fungsi aplikasi dan tidak disimpan pengembang. Isilah sesuai interpretasi terbaru Google. Bila Google menganggap pengiriman ke pihak ketiga sebagai "dibagikan", pilih *Lokasi perkiraan & tepat → Dibagikan → Fungsi aplikasi*, tidak wajib, tidak diproses untuk iklan.
- Data dienkripsi saat dikirim: **Ya** (semua HTTPS).
- Pengguna dapat meminta penghapusan: data hanya ada di perangkat, terhapus saat aplikasi dicopot.

**Izin layanan latar depan (`FOREGROUND_SERVICE_SPECIAL_USE`)**: jelaskan bahwa mode siaga tinggi diaktifkan sendiri oleh pengguna untuk memantau peringatan gempa & tsunami BMKG setiap menit, dengan notifikasi tetap yang terlihat, dan tidak bisa dilakukan oleh WorkManager/JobScheduler karena jeda minimumnya 15 menit. Sertakan video singkat yang menunjukkan cara mengaktifkannya (Siaga → Pengaturan → Mode siaga tinggi).

**Lokasi di latar belakang**: tidak diminta. Pemantauan latar memakai lokasi terakhir yang disimpan saat aplikasi dibuka.

**Klasifikasi konten**: aplikasi utilitas/informasi, tanpa konten pengguna, tanpa pembelian.

**Kategori**: Cuaca, atau Peta & Navigasi.

## 5. Uji sebelum rilis

- Pasang APK di HP Android 7 sampai versi terbaru bila memungkinkan, termasuk Android 14/15.
- Jalankan simulasi gempa & tsunami (menu LIVE), mode darurat, SOS (peluit, senter, layar), dan pintasan layar utama (tekan lama ikon).
- Matikan data seluler lalu buka aplikasi: analisis terakhir dan peta yang disimpan harus tetap tampil.
