package id.terrawoi.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Mode siaga tinggi: layanan latar depan yang memeriksa BMKG tiap menit (bukan ±15 menit), untuk warga
 * pesisir atau saat aktivitas gempa meningkat. Menampilkan notifikasi tetap di bilah status, dan
 * dijalankan ulang setelah HP dinyalakan (BootReceiver).
 */
public class SiagaTinggi extends Service {
    private static final int ID_NOTIF = 4802;
    private static final String KANAL = "layanan";
    private static final long JEDA_MS = 60 * 1000L;

    private HandlerThread utas;
    private Handler penangan;

    static boolean aktif(Context ctx) {
        return PantauGempa.pref(ctx).getBoolean("siaga-tinggi", false);
    }

    static void atur(Context ctx, boolean nyala) {
        PantauGempa.pref(ctx).edit().putBoolean("siaga-tinggi", nyala).apply();
        if (nyala) mulai(ctx);
        else ctx.stopService(new Intent(ctx, SiagaTinggi.class));
    }

    /** Jalankan bila diaktifkan (dari aplikasi atau setelah boot). */
    static void mulai(Context ctx) {
        if (!aktif(ctx)) return;
        Intent i = new Intent(ctx, SiagaTinggi.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
            else ctx.startService(i);
        } catch (Exception e) {
            // Android menolak memulai dari latar: akan dicoba lagi saat aplikasi dibuka
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        utas = new HandlerThread("siaga-tinggi");
        utas.start();
        penangan = new Handler(utas.getLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = notifikasi("Memulai…");
        if (Build.VERSION.SDK_INT >= 34) startForeground(ID_NOTIF, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(ID_NOTIF, n);
        penangan.removeCallbacksAndMessages(null);
        penangan.post(cek);
        return START_STICKY;
    }

    private final Runnable cek = new Runnable() {
        @Override
        public void run() {
            String status;
            try {
                PantauGempa.periksa(SiagaTinggi.this);
                status = "Cek terakhir " + new SimpleDateFormat("HH.mm", Locale.US).format(new Date());
            } catch (Exception e) {
                status = "BMKG tidak terjangkau, mencoba lagi…";
            }
            getSystemService(NotificationManager.class).notify(ID_NOTIF, notifikasi(status));
            penangan.postDelayed(this, JEDA_MS);
        }
    };

    @SuppressWarnings("deprecation")
    private Notification notifikasi(String status) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel k = new NotificationChannel(KANAL, "Mode siaga tinggi", NotificationManager.IMPORTANCE_LOW);
            k.setDescription("Notifikasi tetap selama pemantauan BMKG tiap menit aktif");
            k.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(k);
        }
        PendingIntent buka = PendingIntent.getActivity(this, 1,
                new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, KANAL)
                : new Notification.Builder(this).setPriority(Notification.PRIORITY_LOW);
        return b.setSmallIcon(R.drawable.ic_notif)
                .setContentTitle("Siaga tinggi aktif")
                .setContentText("Memantau gempa BMKG tiap menit · " + status)
                .setContentIntent(buka)
                .setOngoing(true)
                .setShowWhen(false)
                .build();
    }

    @Override
    public void onDestroy() {
        penangan.removeCallbacksAndMessages(null);
        utas.quitSafely();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
