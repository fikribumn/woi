package id.terrawoi.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;

/** Kanal & pengiriman notifikasi, dipakai halaman web (lewat Jembatan) dan pemantauan latar. */
final class Notif {
    static final String KANAL_PERINGATAN = "peringatan";
    static final String KANAL_INFO = "info";

    private Notif() {}

    static void siapkanKanal(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        NotificationChannel p = new NotificationChannel(KANAL_PERINGATAN, ctx.getString(R.string.kanal_peringatan), NotificationManager.IMPORTANCE_HIGH);
        p.setDescription(ctx.getString(R.string.kanal_peringatan_ket));
        p.enableVibration(true);
        p.setVibrationPattern(new long[] {0, 600, 300, 600, 300, 600});
        p.enableLights(true);
        p.setLightColor(Color.RED);
        p.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        p.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(p);

        NotificationChannel i = new NotificationChannel(KANAL_INFO, ctx.getString(R.string.kanal_info), NotificationManager.IMPORTANCE_DEFAULT);
        i.setDescription(ctx.getString(R.string.kanal_info_ket));
        nm.createNotificationChannel(i);
    }

    static boolean diizinkan(Context ctx) {
        if (Build.VERSION.SDK_INT >= 33
                && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return ctx.getSystemService(NotificationManager.class).areNotificationsEnabled();
    }

    /** penting = peringatan gempa/tsunami (bunyi alarm, muncul di atas layar). */
    @SuppressWarnings("deprecation")
    static void kirim(Context ctx, String judul, String isi, String tag, boolean penting) {
        if (!diizinkan(ctx)) return;
        siapkanKanal(ctx);
        Intent buka = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, buka, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(ctx, penting ? KANAL_PERINGATAN : KANAL_INFO)
                : new Notification.Builder(ctx).setPriority(penting ? Notification.PRIORITY_MAX : Notification.PRIORITY_DEFAULT)
                        .setDefaults(Notification.DEFAULT_ALL);
        b.setSmallIcon(R.drawable.ic_notif)
                .setColor(penting ? Color.rgb(220, 38, 38) : Color.rgb(47, 107, 255))
                .setContentTitle(judul)
                .setContentText(isi)
                .setStyle(new Notification.BigTextStyle().bigText(isi))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setShowWhen(true)
                .setCategory(penting ? Notification.CATEGORY_ALARM : Notification.CATEGORY_STATUS)
                .setVisibility(Notification.VISIBILITY_PUBLIC);
        String kunci = tag == null || tag.isEmpty() ? String.valueOf(System.currentTimeMillis()) : tag;
        ctx.getSystemService(NotificationManager.class).notify(kunci, 1, b.build());
    }
}
