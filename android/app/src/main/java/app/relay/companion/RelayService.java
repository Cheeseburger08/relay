package app.relay.companion;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.os.*;
import android.telephony.SmsManager;
import android.telephony.SubscriptionInfo;
import android.database.Cursor;
import android.provider.CallLog;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;

public class RelayService extends Service {
    static volatile String status = "Relay is idle";
    private ScheduledExecutorService worker;
    private volatile boolean closed;
    private long heartbeatAt, historyAt, retryAt;
    private int failures;
    @Override public void onCreate() {
        super.onCreate();
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("relay", "Relay connection", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        startForeground(1, new Notification.Builder(this,"relay").setContentTitle("Relay is active")
            .setContentText("Phone relay enabled. Tap for call controls or to pause.").setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentIntent(open).setOngoing(true).build());
        worker = Executors.newSingleThreadScheduledExecutor(); worker.scheduleWithFixedDelay(this::tick,0,3,TimeUnit.SECONDS);
    }
    @Override public int onStartCommand(Intent i, int flags, int id) { return START_STICKY; }
    @Override public IBinder onBind(Intent i) { return null; }
    @Override public void onDestroy() { closed = true; NetworkVoice.close(); if(worker != null) worker.shutdownNow(); super.onDestroy(); }
    private void tick() {
        if (closed || System.currentTimeMillis() < retryAt) return;
        try {
            JSONObject s = Vault.read(this);
            if (!s.optBoolean("enabled") || !s.has("token")) { stopSelf(); return; }
            NetworkVoice.ensure(this,s);
            String origin = s.getString("origin"), token = s.getString("token");
            if (System.currentTimeMillis() - heartbeatAt >= 20000) {
                JSONArray sims = new JSONArray();
                for(int slot=1;slot<=2;slot++) sims.put(new JSONObject().put("slot",slot).put("label","SIM " + slot).put("available",Sims.subscription(this,slot)>=0));
                Intent battery = registerReceiver(null,new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
                int level = battery == null ? -1 : battery.getIntExtra(BatteryManager.EXTRA_LEVEL,-1);
                int scale = battery == null ? -1 : battery.getIntExtra(BatteryManager.EXTRA_SCALE,-1);
                Api.post(origin,"/heartbeat",new JSONObject().put("model",Build.MODEL).put("battery",level>=0 && scale>0 ? level*100/scale : JSONObject.NULL)
                    .put("smsReady",Sims.smsReady(this)).put("sims",sims),token);
                heartbeatAt = System.currentTimeMillis();
                try { ContactSync.sync(this,origin,token); }
                catch(Exception e) { ContactSync.status="Contact sync pending; check permissions and connection"; }
                try { BlockSync.sync(this,origin,token); }
                catch(Exception e) { BlockSync.status="Blocked-number sync pending; check default phone app and connection"; }
            }
            uploadEvents(origin,token);
            if(System.currentTimeMillis()-historyAt>=20000 && Vault.object(Vault.read(this),"events").length()==0) {
                try { HistorySync.sync(this,origin,token); historyAt=System.currentTimeMillis(); }
                catch(Exception e) { HistorySync.status="History import pending; check permissions and connection"; historyAt=System.currentTimeMillis(); }
            }
            uploadResults(origin,token);
            if (Sims.smsReady(this)) {
                JSONObject command = Api.post(origin,"/commands/claim",new JSONObject(),token).optJSONObject("command");
                if (command != null) send(command, token);
            }
            failures=0; status="Connected · last contact " + android.text.format.DateFormat.format("HH:mm:ss",System.currentTimeMillis());
        } catch(Api.Failure e) {
            if(e.status==401 || e.status==404) {
                try { Vault.update(this,s->s.put("enabled",false)); } catch(Exception ignored) { }
                status="Authorization revoked or device removed. Pair again."; stopSelf();
            } else backoff("Server rejected an operation (HTTP " + e.status + ")");
        } catch(Exception e) { backoff("Connection or local operation failed; saved events will wait"); }
    }
    private void backoff(String message) { failures=Math.min(failures+1,6); retryAt=System.currentTimeMillis()+Math.min(60000,1000L*(1L<<failures)); status=message; }
    private void uploadEvents(String origin,String token) throws Exception {
        JSONObject events = Vault.read(this).optJSONObject("events"); if(events==null) return;
        // One event per request keeps Unicode SMS safely below the 96 KiB API limit.
        Iterator<String> ids=events.keys(); int count=0;
        while(ids.hasNext() && count++<10) {
            String id=ids.next(); JSONObject event=events.getJSONObject(id);
            Api.post(origin,"/events",new JSONObject().put("events",new JSONArray().put(event)),token);
            Vault.update(this,s->Vault.object(s,"events").remove(id));
        }
    }
    private void uploadResults(String origin,String token) throws Exception {
        JSONObject commands=Vault.read(this).optJSONObject("commands"); if(commands==null) return;
        Iterator<String> ids=commands.keys();
        while(ids.hasNext()) {
            String id=ids.next(); JSONObject row=commands.getJSONObject(id); String result=row.optString("result");
            if(result.isEmpty() || result.equals(row.optString("reported"))) continue;
            Api.post(origin,"/commands/"+id+"/result",new JSONObject().put("status",result),token);
            Vault.update(this,s->{ JSONObject current=Vault.object(s,"commands").optJSONObject(id); if(current!=null) current.put("reported",result); });
        }
    }
    private PendingIntent callback(String id, String kind, int part) {
        Intent intent=new Intent(this,ResultReceiver.class).setAction("app.relay.companion."+kind)
            .setData(android.net.Uri.parse("relay://callback/"+id+"/"+kind+"/"+part))
            .putExtra("command",id).putExtra("kind",kind).putExtra("part",part);
        return PendingIntent.getBroadcast(this,0,intent,PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private void send(JSONObject command,String token) throws Exception {
        String id=command.getString("id");
        JSONObject state=Vault.read(this);
        if (Vault.object(state,"commands").has(id)) return;
        int subscription=Sims.subscription(this,command.getInt("sim"));
        boolean valid=command.optString("type").equals("send_sms") && command.getString("number").matches("\\+[1-9][0-9]{6,14}")
            && !command.getString("text").isEmpty() && command.getString("text").length()<=1600;
        SmsManager sms=subscription>=0 ? SmsManager.getSmsManagerForSubscriptionId(subscription) : null;
        ArrayList<String> parts=sms==null ? new ArrayList<>() : sms.divideMessage(command.getString("text"));
        final boolean[] first={false};
        // Commit before invoking Android. A crash afterward is UNKNOWN, never a reason to resend.
        Vault.update(this,s->{
            JSONObject journal=Vault.object(s,"commands"); if(journal.has(id)) return;
            journal.put(id,new JSONObject().put("parts",parts.size()).put("claimedAt",System.currentTimeMillis())); first[0]=true;
        });
        if(!first[0]) return;
        JSONObject current=Vault.read(this);
        if(!valid || closed || !current.optBoolean("enabled") || !token.equals(current.optString("token"))
            || System.currentTimeMillis()>=command.getLong("expiresAt") || subscription<0 || !Sims.smsReady(this)) {
            Vault.update(this,s->Vault.object(s,"commands").getJSONObject(id).put("result","failed")); return;
        }
        ArrayList<PendingIntent> sent=new ArrayList<>(),delivered=new ArrayList<>();
        for(int n=0;n<parts.size();n++) { sent.add(callback(id,"sent",n)); delivered.add(callback(id,"delivered",n)); }
        try { sms.sendMultipartTextMessage(command.getString("number"),null,parts,sent,delivered); }
        catch(SecurityException | IllegalArgumentException e) { Vault.update(this,s->Vault.object(s,"commands").getJSONObject(id).put("result","failed")); }
        // Other exceptions retain UNKNOWN: Android may already have handed the message to the modem.
    }
}
