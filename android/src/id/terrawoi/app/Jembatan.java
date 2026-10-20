package id.terrawoi.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.text.TextUtils;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.os.Build;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Objek window.WoiAndroid di halaman web. Dipanggil dari utas WebView, jadi perubahan tampilan
 * dijalankan di utas UI. Pasangannya di JavaScript: public/js/platform.js.
 */
final class Jembatan {
    private final MainActivity akt;
    private int idIzinNotifikasi = -1;
    private TextToSpeech suara;
    private boolean suaraSiap;
    private String[] tungguBicara;

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

    // ---------- SOS ----------
    private String idSenter() {
        try {
            CameraManager cm = (CameraManager) akt.getSystemService(Context.CAMERA_SERVICE);
            for (String id : cm.getCameraIdList()) {
                Boolean ada = cm.getCameraCharacteristics(id).get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                if (Boolean.TRUE.equals(ada)) return id;
            }
        } catch (Exception e) {
            // tidak ada kamera / tidak bisa diakses
        }
        return null;
    }

    @JavascriptInterface
    public boolean adaSenter() {
        return idSenter() != null;
    }

    /** Senter tidak memerlukan izin kamera (CameraManager.setTorchMode). */
    @JavascriptInterface
    public void senter(boolean nyala) {
        String id = idSenter();
        if (id == null) return;
        try {
            ((CameraManager) akt.getSystemService(Context.CAMERA_SERVICE)).setTorchMode(id, nyala);
        } catch (Exception e) {
            // kamera sedang dipakai aplikasi lain
        }
    }

    /** Buka aplikasi SMS dengan banyak penerima sekaligus. nomorJson = ["0812…", …] */
    @JavascriptInterface
    public void smsKeSemua(String nomorJson, final String teks) {
        final List<String> nomor = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(nomorJson);
            for (int i = 0; i < a.length(); i++) nomor.add(a.getString(i));
        } catch (Exception e) {
            return;
        }
        if (nomor.isEmpty()) return;
        akt.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Intent i = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + TextUtils.join(";", nomor)))
                        .putExtra("sms_body", teks);
                try {
                    akt.startActivity(i);
                } catch (Exception e) {
                    // tidak ada aplikasi SMS
                }
            }
        });
    }

    // ---------- Suara (WebView tidak punya speechSynthesis) ----------
    @JavascriptInterface
    public void bicara(final String teks, final String bahasa) {
        akt.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (suara == null) {
                    tungguBicara = new String[] {teks, bahasa};
                    suara = new TextToSpeech(akt, new TextToSpeech.OnInitListener() {
                        @Override
                        public void onInit(int status) {
                            suaraSiap = status == TextToSpeech.SUCCESS;
                            if (suaraSiap && tungguBicara != null) ucapkan(tungguBicara[0], tungguBicara[1]);
                            tungguBicara = null;
                        }
                    });
                } else if (suaraSiap) {
                    ucapkan(teks, bahasa);
                }
            }
        });
    }

    private void ucapkan(String teks, String bahasa) {
        Locale l = "en".equals(bahasa) ? Locale.US : new Locale("id", "ID");
        if (suara.isLanguageAvailable(l) < TextToSpeech.LANG_AVAILABLE) l = Locale.getDefault();
        suara.setLanguage(l);
        suara.setSpeechRate(0.95f);
        suara.speak(teks, TextToSpeech.QUEUE_FLUSH, null, "woi");
    }

    @JavascriptInterface
    public void hentikanBicara() {
        akt.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (suara != null) suara.stop();
            }
        });
    }

    void tutup() {
        if (suara != null) suara.shutdown();
        senter(false);
    }

    // ---------- Lokasi tersimpan, siaga tinggi, baterai ----------
    @JavascriptInterface
    public void aturLokasiTersimpan(String json) {
        PantauGempa.simpanLokasiTersimpan(akt, json);
        PantauGempa.jadwalkan(akt);
    }

    @JavascriptInterface
    public boolean siagaTinggiAktif() {
        return SiagaTinggi.aktif(akt);
    }

    @JavascriptInterface
    public void aturSiagaTinggi(boolean aktif) {
        SiagaTinggi.atur(akt, aktif);
    }

    @JavascriptInterface
    public boolean bebasHematBaterai() {
        PowerManager pm = (PowerManager) akt.getSystemService(Context.POWER_SERVICE);
        return pm.isIgnoringBatteryOptimizations(akt.getPackageName());
    }

    /** Daftar optimasi baterai sistem; pengguna sendiri yang memilih mengecualikan aplikasi ini. */
    @JavascriptInterface
    public void bukaPengaturanBaterai() {
        akt.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    akt.startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                } catch (Exception e) {
                    // pengaturan tidak tersedia di perangkat ini
                }
            }
        });
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
