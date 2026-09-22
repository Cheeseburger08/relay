package app.relay.companion;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.content.Intent;
import android.text.InputType;
import android.widget.*;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private TextView status;
    private EditText server, code;
    private final android.os.Handler handler = new android.os.Handler();
    private final Runnable refresh = new Runnable() { public void run() { renderStatus(); handler.postDelayed(this, 2000); } };
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
        LinearLayout box = new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL); box.setPadding(32, 40, 32, 24);
        ScrollView scroll = new ScrollView(this); scroll.addView(box); setContentView(scroll);
        TextView title = new TextView(this); title.setText("Relay Companion"); title.setTextSize(28); box.addView(title);
        TextView intro = new TextView(this); intro.setText("Visible relay for your paired website. SMS, call history and contacts sync while enabled. Live calls require the separate call controls below. Carrier SMS and call fees may apply."); box.addView(intro);
        status = new TextView(this); status.setPadding(0,24,0,24); box.addView(status);
        server = new EditText(this); server.setHint("https://your-relay-server"); server.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI); box.addView(server);
        code = new EditText(this); code.setHint("One-time pairing code"); code.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD); box.addView(code);
        button(box, "Pair with website", () -> pair());
        button(box, "Grant phone permissions", () -> requestPermissions(new String[]{Manifest.permission.READ_PHONE_STATE, Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS, Manifest.permission.SEND_SMS, Manifest.permission.READ_CALL_LOG, Manifest.permission.WRITE_CALL_LOG}, 1));
        button(box, "Enable contact sync", () -> requestPermissions(new String[]{Manifest.permission.READ_CONTACTS,Manifest.permission.WRITE_CONTACTS}, 2));
        button(box,"Grant live-call permissions",()->requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO,Manifest.permission.CALL_PHONE,Manifest.permission.ANSWER_PHONE_CALLS},3));
        button(box,"Use Relay as phone app",()->startActivity(new Intent(android.telecom.TelecomManager.ACTION_CHANGE_DEFAULT_DIALER).putExtra(android.telecom.TelecomManager.EXTRA_CHANGE_DEFAULT_DIALER_PACKAGE_NAME,getPackageName())));
        button(box,"Authorize call audio root access",()->new Thread(()->{try{Process p=new ProcessBuilder("su","-c","id -u").start();String result=new java.io.BufferedReader(new java.io.InputStreamReader(p.getInputStream())).readLine();notice("0".equals(result)?"Root audio access granted":"Root access not granted");}catch(Exception e){notice("Root access unavailable");}},"relay-root-check").start());
        button(box,"Enable live calls",()->new AlertDialog.Builder(this).setTitle("Enable remote cellular calls?").setMessage("Your paired website may show incoming callers, answer, place paid calls through either SIM, and send and receive live call audio over the Internet. An ongoing Relay notification remains visible. Enable only with the SIM owner's permission.").setPositiveButton("Enable calls",(d,w)->{try{
            if(!getPackageName().equals(getSystemService(android.telecom.TelecomManager.class).getDefaultDialerPackage())){notice("Choose Relay as the phone app first");return;}
            if(checkSelfPermission("android.permission.CAPTURE_AUDIO_OUTPUT")!=android.content.pm.PackageManager.PERMISSION_GRANTED){notice("Privileged call-audio installation is required");return;}
            if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=android.content.pm.PackageManager.PERMISSION_GRANTED||checkSelfPermission(Manifest.permission.CALL_PHONE)!=android.content.pm.PackageManager.PERMISSION_GRANTED){notice("Grant live-call permissions first");return;}
            Vault.update(this,s->s.put("voiceEnabled",true));notice("Live calls enabled while relay is enabled");
        }catch(Exception e){notice("Could not enable calls");}}).setNegativeButton("Cancel",null).show());
        button(box,"Pause live calls",()->{try{Vault.update(this,s->s.put("voiceEnabled",false));NetworkVoice.close();}catch(Exception e){notice("Could not pause calls");}});
        button(box,"Open current call",()->startActivity(new Intent(this,PhoneCallActivity.class)));
        button(box,"Messages, history & blocked numbers",()->startActivity(new Intent(this,ManageActivity.class)));
        button(box, "Enable relay", () -> new AlertDialog.Builder(this).setTitle("Enable this phone’s relay?")
            .setMessage("New messages and call history will be uploaded to your paired website. Website replies can send paid SMS through either SIM. Continue only with the SIM owner’s permission.")
            .setPositiveButton("Enable", (d,w) -> enable()).setNegativeButton("Cancel", null).show());
        button(box, "Pause relay", () -> { try { Vault.update(this, s -> s.put("enabled", false)); stopService(new Intent(this, RelayService.class)); renderStatus(); } catch(Exception e) { notice("Could not save pause state"); } });
        button(box, "Forget pairing", () -> new AlertDialog.Builder(this).setTitle("Forget pairing?")
            .setMessage("Stops relay and removes local pending uploads. Also remove this phone on the website to revoke its server token. SMS already submitted to the carrier cannot be cancelled.")
            .setPositiveButton("Forget", (d,w) -> { try { Vault.update(this, s -> { s.put("enabled", false); s.put("voiceEnabled",false); s.remove("token"); s.remove("origin"); s.remove("events"); s.remove("commands"); s.remove("historySeen"); s.remove("historySeenV2"); s.remove("historySeenV3"); s.remove("blockSnapshot"); s.remove("contactSnapshot"); s.remove("contactNamespace"); }); stopService(new Intent(this, RelayService.class)); renderStatus(); } catch(Exception e) { notice("Could not clear pairing"); } }).setNegativeButton("Cancel", null).show());
        try { server.setText(Vault.read(this).optString("origin", "")); } catch(Exception ignored) { }
    }
    private void button(LinearLayout box, String text, Runnable click) { Button b = new Button(this); b.setText(text); b.setOnClickListener(v -> click.run()); box.addView(b); }
    private void notice(String text) { runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_LONG).show()); }
    private void pair() {
        final String address = server.getText().toString(), pairing = code.getText().toString().trim();
        new Thread(() -> { try {
            if (Vault.read(this).has("token")) { notice("Forget the current pairing first"); return; }
            String origin = Api.origin(address);
            JSONObject result = Api.post(origin, "/pair", new JSONObject().put("token", pairing).put("name", "Xperia " + android.os.Build.MODEL), null);
            Vault.update(this, s -> { s.put("origin", origin); s.put("token", result.getString("token")); s.put("enabled", false); s.put("voiceEnabled",false); s.put("since", System.currentTimeMillis()); s.remove("historySeenV3"); s.remove("blockSnapshot"); s.remove("contactSnapshot"); s.remove("contactNamespace"); });
            runOnUiThread(() -> { code.setText(""); renderStatus(); }); notice("Paired. Grant permissions, then enable relay.");
        } catch(Exception e) { notice("Pairing failed. Check the address/code. If the server paired but the response was lost, remove its device and try a new code."); } }, "relay-pair").start();
    }
    private void enable() {
        try {
            if (!Vault.read(this).has("token")) { notice("Pair with the website first"); return; }
            if (!Sims.smsReady(this)) { notice("Grant phone/SMS permissions and check the SIMs first"); return; }
            Vault.update(this, s -> s.put("enabled", true)); startForegroundService(new Intent(this, RelayService.class)); renderStatus();
        } catch(Exception e) { notice("Could not enable relay"); }
    }
    private void renderStatus() { try {
        JSONObject s = Vault.read(this);
        status.setText((s.has("token") ? "Paired" : "Not paired") + " · " + (s.optBoolean("enabled") ? "Enabled" : "Paused")
            + "\nSIM 1: " + (Sims.subscription(this,1) >= 0 ? "present" : "unavailable") + " · SIM 2: " + (Sims.subscription(this,2) >= 0 ? "present" : "unavailable")
            + "\n" + RelayService.status + "\n" + ContactSync.status + "\n" + HistorySync.status + "\n" + HistoryManagement.status + "\n" + BlockSync.status + "\n" + NetworkVoice.status);
    } catch(Exception e) { status.setText("Encrypted storage unavailable. Relay cannot continue."); } }
    @Override public void onResume() { super.onResume(); handler.post(refresh); }
    @Override public void onPause() { handler.removeCallbacks(refresh); super.onPause(); }
}
