package app.relay.audioprobe;

import android.Manifest;
import android.app.*;
import android.content.pm.PackageManager;
import android.media.*;
import android.os.*;
import android.telephony.TelephonyManager;
import android.widget.*;
import java.util.Locale;

/** Visible, local-only measurements. No network permission, audio files or background service. */
public class ProbeActivity extends Activity {
    private static final String CAPTURE="android.permission.CAPTURE_AUDIO_OUTPUT";
    private static final String ROUTE="android.permission.MODIFY_AUDIO_ROUTING";
    private AudioManager audio;
    private TextView report;
    private volatile boolean cancelled;
    private volatile boolean busy;
    private LiveCapture live;
    private final Handler timer=new Handler(Looper.getMainLooper());
    private final StringBuilder results=new StringBuilder();
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        audio=getSystemService(AudioManager.class);
        LinearLayout box=new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL); box.setPadding(28,32,28,24);
        ScrollView scroll=new ScrollView(this);scroll.addView(box);setContentView(scroll);
        TextView title=new TextView(this);title.setText("Relay Audio Probe 0.2.0");title.setTextSize(26);box.addView(title);
        TextView intro=new TextView(this);intro.setText("Local call-audio test. No recordings are saved. Measurements stay on the phone; the live browser test sends call audio to the connected laptop over USB. Tests require this screen to stay visible and a consenting caller.");box.addView(intro);
        report=new TextView(this);report.setTextIsSelectable(true);report.setPadding(0,20,0,20);box.addView(report);
        button(box,"Refresh capabilities",this::refresh);
        button(box,"Grant ordinary test permissions",()->requestPermissions(new String[]{Manifest.permission.READ_PHONE_STATE,Manifest.permission.RECORD_AUDIO},10));
        button(box,"1. Caller speaks — measure",()->confirm("caller-speaks"));
        button(box,"2. Xperia room speaks — measure",()->confirm("xperia-room-speaks"));
        button(box,"3. Duplex — ten-second capture",()->confirm("duplex"));
        button(box,"4. Live browser test",this::confirmLive);
        TextView notice=new TextView(this);notice.setText("Tone test removed: it disrupted call audio on this phone.");box.addView(notice);
        button(box,"Stop test",this::stopTests);
        refresh();
    }
    private void stopTests(){cancelled=true;if(live!=null)live.close();timer.removeCallbacksAndMessages(null);}
    private void confirmLive(){
        if(busy){append("A test is already running.");return;}
        if(!inCall() || !granted(CAPTURE) || !granted(Manifest.permission.RECORD_AUDIO)){
            append("A connected consenting call and capture permissions are required.");return;
        }
        new AlertDialog.Builder(this).setTitle("Enable live laptop audio?")
            .setMessage("The connected laptop can hear the caller and send browser microphone audio into this call. Use headphones on the laptop. Keep this screen open. Stops after two minutes, when you leave this screen, or when the call ends. No recording is saved.")
            .setPositiveButton("Enable live test",(d,w)->{
                if(busy || !inCall())return;
                cancelled=false;busy=true;live=new LiveCapture(this,this::inCall,this::append);
                final LiveCapture session=live;
                timer.postDelayed(()->session.close(),120000);
                timer.postDelayed(new Runnable(){public void run(){
                    if(live!=session)return;
                    if(!inCall()){session.close();return;}
                    timer.postDelayed(this,250);
                }},250);
                new Thread(()->{try{session.run();}finally{busy=false;runOnUiThread(()->{if(live==session)live=null;});}},"relay-live-capture").start();
            }).setNegativeButton("Cancel",null).show();
    }
    private void button(LinearLayout box,String label,Runnable action){Button b=new Button(this);b.setText(label);b.setOnClickListener(v->action.run());box.addView(b);}
    private boolean granted(String permission){return checkSelfPermission(permission)==PackageManager.PERMISSION_GRANTED;}
    private void refresh(){
        StringBuilder text=new StringBuilder("Model: ").append(Build.MODEL).append("\nAndroid: ").append(Build.VERSION.RELEASE)
            .append("\nCall capture privilege: ").append(granted(CAPTURE)?"granted":"BLOCKED")
            .append("\nAudio routing privilege: ").append(granted(ROUTE)?"granted":"BLOCKED")
            .append("\nOrdinary microphone permission: ").append(granted(Manifest.permission.RECORD_AUDIO)?"granted":"not granted");
        int inputs=0,outputs=0;
        for(AudioDeviceInfo d:audio.getDevices(AudioManager.GET_DEVICES_INPUTS))if(d.getType()==AudioDeviceInfo.TYPE_TELEPHONY)inputs++;
        for(AudioDeviceInfo d:audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS))if(d.getType()==AudioDeviceInfo.TYPE_TELEPHONY)outputs++;
        text.append("\nTelephony endpoints exposed: ").append(inputs).append(" input / ").append(outputs).append(" output");
        if(!granted(CAPTURE))text.append("\nStock app permissions cannot unlock digital call capture.");
        text.append("\n\n").append(results);report.setText(text);
    }
    private void append(String text){android.util.Log.i("RelayAudioProbe",text);runOnUiThread(()->{results.append(text).append("\n");refresh();});}
    private boolean inCall(){
        if(checkSelfPermission(Manifest.permission.READ_PHONE_STATE)!=PackageManager.PERMISSION_GRANTED)return false;
        try{return getSystemService(TelephonyManager.class).getCallState()==TelephonyManager.CALL_STATE_OFFHOOK;}
        catch(SecurityException e){return false;}
    }
    private void confirm(String condition){
        if(busy){append("A test is already running.");return;}
        if(!granted(CAPTURE)){append("Blocked by protected Android permission. No audio opened.");return;}
        if(!granted(Manifest.permission.RECORD_AUDIO)){append("Grant the ordinary microphone permission first.");return;}
        if(!inCall()){append("Start a consenting test call first. No audio opened.");return;}
        String instructions=condition.equals("duplex")
            ? "Caller speaks continuously; keep the Xperia room quiet. Capture lasts ten seconds. The laptop operator may send three quiet beeps during this test. Keep this screen visible. No recording is saved."
            : (condition.equals("caller-speaks")?"Caller speaks; keep the Xperia room quiet.":"Caller stays silent; speak near the Xperia. Keep the other phone in a different room.")+" Measure for three seconds. No recording is saved.";
        new AlertDialog.Builder(this).setTitle("Measure "+condition+"?")
            .setMessage(instructions)
            .setPositiveButton("Run test",(d,w)->{cancelled=false;busy=true;new Thread(()->{try{measure(condition);}finally{busy=false;}},"relay-audio-probe").start();})
            .setNegativeButton("Cancel",null).show();
    }
    private void measure(String condition){
        AudioRecord recorder=null;
        String stage="checking capture format";
        try{
            if(cancelled || !inCall() || checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED || !granted(CAPTURE))return;
            int rate=16000,size=AudioRecord.getMinBufferSize(rate,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
            if(size<=0)throw new IllegalStateException("Unsupported capture format");
            stage="creating VOICE_DOWNLINK at 16000 Hz, mono, buffer "+Math.max(size,3200);
            recorder=DownlinkRecord.create(this,rate,Math.max(size,3200));
            if(recorder.getState()!=AudioRecord.STATE_INITIALIZED)throw new IllegalStateException("Call capture did not initialize");
            if(recorder.getAudioSource()!=MediaRecorder.AudioSource.VOICE_DOWNLINK)throw new IllegalStateException("Unexpected capture source; test aborted");
            stage="starting downlink capture";
            recorder.startRecording();short[] buffer=new short[320];long count=0;double square=0;int peak=0;
            int duration=condition.equals("duplex")?10000:3000;
            append(condition+": Capture started; duration "+duration+" ms.");
            long end=SystemClock.elapsedRealtime()+duration;
            while(!cancelled && inCall() && SystemClock.elapsedRealtime()<end){
                stage="reading downlink samples";
                int n=recorder.read(buffer,0,buffer.length,AudioRecord.READ_NON_BLOCKING);
                if(n<0)throw new IllegalStateException("Call capture read failed");
                for(int x=0;x<n;x++){int value=buffer[x];square+=(double)value*value;peak=Math.max(peak,Math.abs(value));}
                count+=n;java.util.Arrays.fill(buffer,(short)0);SystemClock.sleep(10);
            }
            append(condition+": "+String.format(Locale.ROOT,"Downlink: %d samples, RMS %.1f, peak %d. Signal levels alone do not prove intelligibility or isolation.",count,count==0?0:Math.sqrt(square/count),peak));
        }catch(Exception e){append(condition+": Downlink failed while "+stage+": "+e.getClass().getSimpleName()+" — "+e.getMessage());}
        finally{if(recorder!=null){try{recorder.stop();}catch(Exception ignored){}recorder.release();}}
    }
    @Override protected void onPause(){stopTests();super.onPause();}
}
