package id.terrawoi.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Setelah HP dinyalakan ulang: pulihkan jadwal pemantauan dan mode siaga tinggi. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        PantauGempa.jadwalkan(ctx);
        SiagaTinggi.mulai(ctx);
    }
}
