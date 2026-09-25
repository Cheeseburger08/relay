package app.relay.companion;
import android.content.*;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import org.json.JSONObject;
import java.security.MessageDigest;
public class SmsReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(i.getAction())) return;
        try {
            JSONObject s = Vault.read(c); if (!s.optBoolean("enabled") || !s.has("token")) return;
            if(Sims.permission(c,android.Manifest.permission.READ_SMS)) {
                // Persist the live arrival window; provider IDs still drive deduplication.
                Vault.update(c,state->state.put("smsLiveSince",System.currentTimeMillis()-10000));
                c.startForegroundService(new Intent(c,RelayService.class)); return;
            }
            int slot = Sims.slot(c, i.getIntExtra("subscription", -1));
            if (slot < 1 || slot > 2) { RelayService.status = "Incoming SMS could not be assigned to a SIM; no upload performed"; return; }
            SmsMessage[] messages = Telephony.Sms.Intents.getMessagesFromIntent(i);
            if (messages == null || messages.length == 0) return;
            StringBuilder text = new StringBuilder(); for (SmsMessage m : messages) text.append(m.getMessageBody());
            MessageDigest digest = MessageDigest.getInstance("SHA-256"); digest.update((byte)slot);
            for (SmsMessage message : messages) digest.update(message.getPdu());
            StringBuilder stable = new StringBuilder("sms-"); for(byte b : digest.digest()) stable.append(String.format("%02x", b & 255));
            // Original modem timestamp keeps identical redeliveries byte-for-byte idempotent.
            JSONObject event = new JSONObject().put("id", stable.toString()).put("type", "sms")
                .put("number", messages[0].getOriginatingAddress()).put("sim", slot).put("timestamp", messages[0].getTimestampMillis())
                .put("direction", "incoming").put("text", text.toString());
            Vault.update(c, state -> Vault.object(state,"events").put(event.getString("id"), event));
            c.startForegroundService(new Intent(c, RelayService.class));
        } catch(Exception e) { RelayService.status = "Incoming SMS could not be saved for upload"; }
    }
}
