package id.terrawoi.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * Satu layar berisi WebView yang memuat halaman web dari aset aplikasi (assets/www, salinan public/).
 * Halaman disajikan di https://appassets.androidplatform.net (domain khusus WebView, asal yang aman untuk
 * geolokasi & Cache Storage). Path /__proxy?u=... diambil oleh kode native agar sumber yang memblokir CORS
 * tetap bisa dibaca halaman (lihat public/js/platform.js).
 */
public class MainActivity extends Activity {
    static final String UA = "TerraWoi/1.0 (Android; aplikasi pemantau bencana)";
    static final String HOST = "appassets.androidplatform.net";
    private static final String AWAL = "https://" + HOST + "/index.html";
    private static final int MINTA_LOKASI = 1;
    static final int MINTA_NOTIFIKASI = 2;

    /** Hanya sumber data yang dipakai api-inti.mjs yang boleh lewat proxy. */
    private static final Set<String> HOST_PROXY = new HashSet<>(Arrays.asList(
            "magma.esdm.go.id", "geoportal.esdm.go.id", "firms.modaps.eosdis.nasa.gov",
            "overpass-api.de", "overpass.kumi.systems", "api.petabencana.id", "gis.bnpb.go.id", "www.bmkg.go.id"));

    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("mjs", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("woff2", "font/woff2");
        MIME.put("txt", "text/plain");
    }

    WebView web;
    private FrameLayout akar;
    private Jembatan jembatan;
    private GeolocationPermissions.Callback tungguLokasi;
    private String asalLokasi;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle simpanan) {
        super.onCreate(simpanan);
        Notif.siapkanKanal(this);
        PantauGempa.jadwalkan(this);
        SiagaTinggi.mulai(this);

        akar = new FrameLayout(this);
        web = new WebView(this);
        akar.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(akar);
        pasangInsets();

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // sirene peringatan harus bisa berbunyi tanpa ketukan
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setUserAgentString(s.getUserAgentString() + " " + UA);

        jembatan = new Jembatan(this);
        web.addJavascriptInterface(jembatan, "WoiAndroid");
        web.setWebViewClient(new Klien());
        web.setWebChromeClient(new KlienChrome());
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        if (simpanan != null) web.restoreState(simpanan);
        else web.loadUrl(AWAL);
        aksiTertunda = aksiDari(getIntent());
    }

    // ---------- Pintasan layar utama (terrawoi://sos, ://darurat, ://aman) ----------
    private String aksiTertunda;
    private boolean halamanSiap;

    private static String aksiDari(Intent i) {
        Uri u = i == null ? null : i.getData();
        if (u == null || !"terrawoi".equals(u.getScheme())) return null;
        String a = u.getHost();
        return a != null && a.matches("[a-z]+") ? a : null;
    }

    private void jalankanAksi() {
        if (aksiTertunda == null || !halamanSiap) return;
        web.evaluateJavascript("window.woiAksi && window.woiAksi('" + aksiTertunda + "')", null);
        aksiTertunda = null;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        aksiTertunda = aksiDari(intent);
        jalankanAksi();
    }

    // ---------- Tata letak tepi-ke-tepi ----------
    /** Android 11+: konten digambar di belakang bilah sistem, lalu diberi padding sebesar bilah & keyboard. */
    @SuppressWarnings("deprecation")
    private void pasangInsets() {
        if (Build.VERSION.SDK_INT < 30) return; // Android lama: sistem yang mengatur, adjustResize untuk keyboard
        getWindow().setDecorFitsSystemWindows(false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        akar.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                android.graphics.Insets bar = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                v.setPadding(bar.left, bar.top, bar.right, Math.max(bar.bottom, ime.bottom));
                return WindowInsets.CONSUMED;
            }
        });
    }

    /** Warna latar di balik bilah sistem dan warna ikonnya, mengikuti tema halaman. */
    @SuppressWarnings("deprecation")
    void aturBilah(int warna, boolean gelap) {
        akar.setBackgroundColor(warna);
        getWindow().getDecorView().setBackgroundColor(warna);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c == null) return;
            int terang = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            c.setSystemBarsAppearance(gelap ? 0 : terang, terang);
        } else {
            getWindow().setStatusBarColor(warna);
            getWindow().setNavigationBarColor(warna);
            int f = getWindow().getDecorView().getSystemUiVisibility();
            int terang = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | (Build.VERSION.SDK_INT >= 26 ? View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0);
            getWindow().getDecorView().setSystemUiVisibility(gelap ? f & ~terang : f | terang);
        }
    }

    // ---------- Siklus hidup ----------
    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle keluar) {
        super.onSaveInstanceState(keluar);
        web.saveState(keluar);
    }

    @Override
    protected void onDestroy() {
        jembatan.tutup();
        web.destroy();
        super.onDestroy();
    }

    /** Mode gelap sistem berubah: beri tahu halaman tanpa memuat ulang (uiMode ada di configChanges). */
    @Override
    public void onConfigurationChanged(Configuration baru) {
        super.onConfigurationChanged(baru);
        kirimModeSistem();
    }

    void kirimModeSistem() {
        boolean gelap = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        web.evaluateJavascript("window.woiModeSistem && window.woiModeSistem(" + gelap + ")", null);
    }

    /** Tombol kembali: halaman menutup panel/halaman yang terbuka; bila tidak ada, aplikasi diminimalkan (tetap memantau). */
    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.woiKembali ? window.woiKembali() : false", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String hasil) {
                if (!"true".equals(hasil)) moveTaskToBack(true);
            }
        });
    }

    // ---------- Izin ----------
    @Override
    public void onRequestPermissionsResult(int kode, String[] izin, int[] hasil) {
        super.onRequestPermissionsResult(kode, izin, hasil);
        boolean ok = false;
        for (int h : hasil) ok |= h == PackageManager.PERMISSION_GRANTED;
        if (kode == MINTA_LOKASI && tungguLokasi != null) {
            tungguLokasi.invoke(asalLokasi, ok, false);
            tungguLokasi = null;
        } else if (kode == MINTA_NOTIFIKASI) {
            jembatan.selesaiIzinNotifikasi(ok);
        }
    }

    private boolean punyaLokasi() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    void balas(int id, String nilaiJs) {
        web.evaluateJavascript("window.woiBalasan && window.woiBalasan(" + id + "," + nilaiJs + ")", null);
    }

    // ---------- Tautan luar ----------
    /** Telepon, SMS, Google Maps, dan situs lain dibuka di aplikasi yang sesuai. */
    private void bukaLuar(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException e) {
            // tidak ada aplikasi yang bisa membuka tautan ini
        }
    }

    private class Klien extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (HOST.equals(u.getHost())) return false;
            bukaLuar(u);
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!HOST.equals(u.getHost())) return null; // peta, BMKG, Open-Meteo, dll. langsung dari WebView
            String path = u.getPath() == null ? "/" : u.getPath();
            if (path.equals("/__proxy")) return proxy(u.getQueryParameter("u"));
            return aset(path);
        }

        @Override
        public void onPageFinished(WebView v, String url) {
            kirimModeSistem();
            halamanSiap = true;
            jalankanAksi();
        }
    }

    private class KlienChrome extends WebChromeClient {
        @Override
        public void onGeolocationPermissionsShowPrompt(String asal, GeolocationPermissions.Callback cb) {
            if (punyaLokasi()) {
                cb.invoke(asal, true, false);
                return;
            }
            tungguLokasi = cb;
            asalLokasi = asal;
            requestPermissions(new String[] {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, MINTA_LOKASI);
        }
    }

    // ---------- Aset & proxy ----------
    private WebResourceResponse aset(String path) {
        if (path.equals("/")) path = "/index.html";
        if (path.contains("..")) return galat(403, "Terlarang");
        String nama = path.substring(path.lastIndexOf('/') + 1);
        String ext = nama.contains(".") ? nama.substring(nama.lastIndexOf('.') + 1) : "";
        String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
        try {
            InputStream in = getAssets().open("www" + path);
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "no-cache");
            return new WebResourceResponse(mime, mime.startsWith("text/") || ext.equals("json") ? "utf-8" : null, 200, "OK", h, in);
        } catch (IOException e) {
            return galat(404, "Tidak ditemukan");
        }
    }

    private WebResourceResponse proxy(String target) {
        try {
            URL url = new URL(target);
            if (!"https".equals(url.getProtocol()) || !HOST_PROXY.contains(url.getHost())) return galat(403, "Sumber tidak diizinkan");
            HttpURLConnection c = (HttpURLConnection) url.openConnection();
            c.setConnectTimeout(20000);
            c.setReadTimeout(100000); // Overpass bisa lama
            c.setRequestProperty("User-Agent", UA);
            int kode = c.getResponseCode();
            InputStream in = kode >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in == null) in = new ByteArrayInputStream(new byte[0]);
            String jenis = c.getContentType() == null ? "application/octet-stream" : c.getContentType();
            String mime = jenis.split(";")[0].trim();
            String charset = "utf-8";
            for (String bagian : jenis.split(";")) {
                if (bagian.trim().toLowerCase().startsWith("charset=")) charset = bagian.trim().substring(8);
            }
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "no-store");
            // WebResourceResponse menolak kode 3xx; pengalihan sudah diikuti HttpURLConnection
            int status = kode >= 300 && kode < 400 ? 502 : kode;
            String alasan = c.getResponseMessage();
            return new WebResourceResponse(mime, charset, status, alasan == null || alasan.isEmpty() ? "OK" : alasan, h, in);
        } catch (Exception e) {
            return galat(502, e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    private static WebResourceResponse galat(int kode, String pesan) {
        String json = "{\"error\":" + org.json.JSONObject.quote(pesan == null ? "galat" : pesan) + "}";
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        return new WebResourceResponse("application/json", "utf-8", kode, "Error", h,
                new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)));
    }
}
