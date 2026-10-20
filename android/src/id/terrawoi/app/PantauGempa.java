package id.terrawoi.app;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Pemantauan gempa saat aplikasi ditutup: tiap ±15 menit (batas minimum JobScheduler) memeriksa BMKG
 * dan memberi notifikasi bila gempa baru diperkirakan terasa di lokasi terakhir (MMI ≥ 4) atau berpotensi
 * tsunami sementara lokasi di pesisir. Penilaian sama dengan pantau.js di halaman web.
 */
public class PantauGempa extends JobService {
    static final String PREF = "pantau";
    private static final int ID_JOB = 4801;
    private static final long UMUR_MAKS_MS = 60 * 60 * 1000L;
    private static final String[] SUMBER = {
        "https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json",
        "https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json",
    };

    // ---------- Penjadwalan ----------
    static SharedPreferences pref(Context ctx) {
        return ctx.getSharedPreferences(PREF, MODE_PRIVATE);
    }

    static boolean aktif(Context ctx) {
        return pref(ctx).getBoolean("aktif", true);
    }

    static void aturAktif(Context ctx, boolean aktif) {
        pref(ctx).edit().putBoolean("aktif", aktif).apply();
        jadwalkan(ctx);
    }

    static void simpanLokasi(Context ctx, double lat, double lon, String label, boolean pesisir) {
        pref(ctx).edit()
                .putString("lat", Double.toString(lat))
                .putString("lon", Double.toString(lon))
                .putString("label", label)
                .putBoolean("pesisir", pesisir)
                .apply();
        jadwalkan(ctx);
    }

    /** Pasang/lepas jadwal sesuai pengaturan. Aman dipanggil berulang kali. */
    static void jadwalkan(Context ctx) {
        JobScheduler js = ctx.getSystemService(JobScheduler.class);
        boolean adaLokasi = pref(ctx).contains("lat");
        if (!aktif(ctx) || !adaLokasi) {
            js.cancel(ID_JOB);
            return;
        }
        for (JobInfo j : js.getAllPendingJobs()) {
            if (j.getId() == ID_JOB) return;
        }
        js.schedule(new JobInfo.Builder(ID_JOB, new ComponentName(ctx, PantauGempa.class))
                .setPeriodic(15 * 60 * 1000L)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build());
    }

    // ---------- Pekerjaan ----------
    @Override
    public boolean onStartJob(final JobParameters params) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    periksa(PantauGempa.this);
                } catch (Exception e) {
                    // Gagal jaringan atau format: coba lagi pada jadwal berikutnya
                }
                jobFinished(params, false);
            }
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }

    static void periksa(Context ctx) throws Exception {
        SharedPreferences p = pref(ctx);
        if (!p.contains("lat")) return;
        double lat = Double.parseDouble(p.getString("lat", "0"));
        double lon = Double.parseDouble(p.getString("lon", "0"));
        String label = p.getString("label", "lokasi Anda");
        boolean pesisir = p.getBoolean("pesisir", false);

        List<JSONObject> daftar = new ArrayList<>();
        for (String url : SUMBER) {
            try {
                JSONObject info = new JSONObject(ambil(url)).getJSONObject("Infogempa");
                Object g = info.get("gempa");
                if (g instanceof JSONArray) {
                    JSONArray a = (JSONArray) g;
                    for (int i = 0; i < a.length(); i++) daftar.add(a.getJSONObject(i));
                } else {
                    daftar.add((JSONObject) g);
                }
            } catch (Exception e) {
                // satu sumber gagal: lanjut ke sumber lain
            }
        }

        Set<String> sudah = new HashSet<>(p.getStringSet("sudah", new HashSet<String>()));
        SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US);
        long kini = System.currentTimeMillis();
        for (JSONObject g : daftar) {
            long waktu;
            try {
                waktu = iso.parse(g.getString("DateTime")).getTime();
            } catch (Exception e) {
                continue;
            }
            if (kini - waktu > UMUR_MAKS_MS) continue;
            String[] k = g.getString("Coordinates").split(",");
            double gLat = Double.parseDouble(k[0].trim());
            double gLon = Double.parseDouble(k[1].trim());
            String id = waktu + "|" + String.format(Locale.US, "%.2f|%.2f", gLat, gLon);
            if (sudah.contains(id)) continue;

            double mag = Double.parseDouble(g.getString("Magnitude"));
            double dalam = angkaAwal(g.optString("Kedalaman", "10"), 10);
            double jarak = jarakKm(lat, lon, gLat, gLon);
            double mmi = perkiraanMmi(mag, Math.sqrt(jarak * jarak + dalam * dalam));
            String potensi = g.optString("Potensi", "").toLowerCase(Locale.ROOT);
            boolean tsunami = potensi.contains("tsunami") && !potensi.contains("tidak") && pesisir && jarak <= 600;
            if (!tsunami && mmi < 4) continue;

            sudah.add(id);
            String wilayah = g.optString("Wilayah", "");
            String judul = (tsunami ? "POTENSI TSUNAMI" : mmi >= 6 ? "GEMPA KUAT" : "Gempa terasa")
                    + String.format(Locale.US, ": M%.1f", mag);
            String isi = (tsunami
                    ? "Segera jauhi pantai ke tempat tinggi. "
                    : "") + wilayah + " · " + bulatKm(jarak) + " dari " + label
                    + " · perkiraan guncangan " + ROMAWI[(int) Math.max(0, Math.min(11, Math.round(mmi) - 1))]
                    + ". Buka aplikasi untuk langkah & rute evakuasi.";
            Notif.kirim(ctx, judul, isi, "gempa-" + id, true);
        }
        // Simpan maks. 50 kejadian terakhir agar tidak memperingatkan dua kali
        if (sudah.size() > 50) {
            List<String> urut = new ArrayList<>(sudah);
            java.util.Collections.sort(urut);
            sudah = new HashSet<>(urut.subList(urut.size() - 50, urut.size()));
        }
        p.edit().putStringSet("sudah", sudah).apply();
    }

    // ---------- Perhitungan (sama dengan util.js / gempa.js) ----------
    private static final String[] ROMAWI = {"I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"};

    static double jarakKm(double lat1, double lon1, double lat2, double lon2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.pow(Math.sin(dLat / 2), 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.pow(Math.sin(dLon / 2), 2);
        return 2 * 6371 * Math.asin(Math.sqrt(a));
    }

    static double perkiraanMmi(double mag, double jarakHiposenterKm) {
        double r = Math.sqrt(jarakHiposenterKm * jarakHiposenterKm + 14 * 14);
        double b = Math.max(0, Math.log10(r / 50));
        double mmi = 12.27 + 2.27 * (mag - 6) + 0.1304 * Math.pow(mag - 6, 2) - 1.3 * Math.log10(r)
                - 0.000707 * r + 1.95 * b - 0.577 * mag * Math.log10(r);
        return Math.max(1, Math.min(12, mmi));
    }

    private static String bulatKm(double km) {
        return km < 10 ? String.format(Locale.US, "%.1f km", km) : Math.round(km) + " km";
    }

    private static double angkaAwal(String s, double cadangan) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("[0-9]+(\\.[0-9]+)?").matcher(s);
        return m.find() ? Double.parseDouble(m.group()) : cadangan;
    }

    static String ambil(String alamat) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(alamat).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(20000);
        c.setRequestProperty("User-Agent", MainActivity.UA);
        try {
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } finally {
            c.disconnect();
        }
    }
}
