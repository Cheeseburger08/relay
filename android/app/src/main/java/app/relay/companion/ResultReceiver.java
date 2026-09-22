package app.relay.companion;
import android.app.Activity;
import android.content.*;
import org.json.JSONObject;
public class ResultReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        String id = i.getStringExtra("command"); if (id == null) return;
        final int result = getResultCode();
        try { Vault.update(c, s -> {
            JSONObject commands = Vault.object(s,"commands"), command = commands.optJSONObject(id);
            if (command == null) return;
            String kind = i.getStringExtra("kind"); int part = i.getIntExtra("part", -1), total = command.getInt("parts");
            if (part < 0 || part >= total || !("sent".equals(kind) || "delivered".equals(kind))) return;
            JSONObject callbacks = Vault.object(command,kind);
            if (callbacks.has(Integer.toString(part))) return;
            callbacks.put(Integer.toString(part), result == Activity.RESULT_OK);
            String next = SmsOutcome.status(values(command.optJSONObject("sent"),total), values(command.optJSONObject("delivered"),total));
            if (!next.isEmpty()) command.put("result",next);
        }); } catch(Exception e) { RelayService.status = "SMS callback could not be saved; outcome may be unknown"; }
    }
    private static int[] values(JSONObject o, int total) {
        int[] values = new int[total];
        if (o != null) for (int n=0;n<total;n++) if (o.has(Integer.toString(n))) values[n] = o.optBoolean(Integer.toString(n)) ? 1 : -1;
        return values;
    }
}
