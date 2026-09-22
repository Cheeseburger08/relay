package app.relay.companion;
import android.content.*;
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(i.getAction())) return;
        try { if (Vault.read(c).optBoolean("enabled")) c.startForegroundService(new Intent(c, RelayService.class)); }
        catch(Exception ignored) { RelayService.status = "Could not resume relay after reboot"; }
    }
}
