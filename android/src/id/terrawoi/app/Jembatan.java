package id.terrawoi.app;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.os.Build;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;

/**
 * Objek window.WoiAndroid di halaman web. Dipanggil dari utas WebView, jadi perubahan tampilan
 * dijalankan di utas UI. Pasangannya di JavaScript: public/js/platform.js.
 */
final class Jembatan {
    private final MainActivity akt;
    private int idIzinNotifikasi = -1;

    Jembatan(MainActivity akt) {
        this.akt = akt;
    }

    private SharedPreferences pref() {
        return PantauGempa.pref(akt);
    }

    // ---------- Notifikasi ----------
    /** 'granted' | 'denied' | 'default' (belum pernah ditanya, Android 13+). */
    @JavascriptInterface
    public String izinNotifikasi() {
        if (Notif.diizinkan(akt)) return "granted";
        if (Build.VERSION.SDK_INT >= 33 && !pref().getBoolean("notif-ditanya", false)) return "default";
        return "denied";
    }

    @JavascriptInterface
    public void mintaIzinNotifikasi(final int id) {
        if (Build.VERSION.SDK_INT < 33 || Notif.diizinkan(akt)) {
            balas(id, izinNotifikasi());
            return;
        }
        pref().edit().putBoolean("notif-ditanya", true).apply();
        idIzinNotifikasi = id;
        akt.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                akt.requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, MainActivity.MINTA_NOTIFIKASI);
            }
        });
    }

    void selesaiIzinNotifikasi(boolean ok) {
        if (idIzinNotifikasi < 0) return;
        balas(idIzinNotifikasi, ok ? "granted" : "denied");
        idIzinNotifikasi = -1;
    }

    @JavascriptInterface
    public void notifikasi(String judul, String isi, String tag, boolean penting) {
        Notif.kirim(akt, judul, isi, tag, penting);
    }

    // ---------- Berbagi ----------
    @JavascriptInterface
    public void bagikan(final String judul, final String teks) {
        akt.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Intent kirim = new Intent(Intent.ACTION_SEND).setType("text/plain")
                        .putExtra(Intent.EXTRA_SUBJECT, judul)
                        .putExtra(Intent.EXTRA_TEXT, teks);
                akt.startActivity(Intent.createChooser(kirim, judul.isEmpty() ? "Bagikan" : judul));
            }
        });
    }

    // ---------- Layar & tampilan ----------
    @JavascriptInterface
    public void layarNyala(final boolean nyala) {
        akt.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (nyala) akt.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else akt.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        });
    }

    /** warna: nilai CSS, mis. "#f5f7fb". */
    @JavascriptInterface
    public void warnaBilah(final String warna, final boolean gelap) {
        final int c;
        try {
            c = Color.parseColor(warna.trim());
        } catch (IllegalArgumentException e) {
            return;
        }
        akt.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                akt.aturBilah(c, gelap);
            }
        });
    }

    @JavascriptInterface
    public String versi() {
        try {
            PackageInfo p = akt.getPackageManager().getPackageInfo(akt.getPackageName(), 0);
            return p.versionName;
        } catch (Exception e) {
            return "";
        }
    }

    // ---------- Pemantauan latar ----------
    @JavascriptInterface
    public void aturLokasiPantau(double lat, double lon, String label, boolean pesisir) {
        PantauGempa.simpanLokasi(akt, lat, lon, label, pesisir);
    }

    @JavascriptInterface
    public boolean pantauLatarAktif() {
        return PantauGempa.aktif(akt);
    }

    @JavascriptInterface
    public void aturPantauLatar(boolean aktif) {
        PantauGempa.aturAktif(akt, aktif);
    }

    private void balas(final int id, final String hasil) {
        akt.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                akt.balas(id, org.json.JSONObject.quote(hasil));
            }
        });
    }
}
