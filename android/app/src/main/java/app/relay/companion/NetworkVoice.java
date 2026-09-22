package app.relay.companion;
import android.content.Context;
import android.os.*;
import org.json.JSONObject;
import okhttp3.*;
import okio.ByteString;
import java.util.*;
import java.util.concurrent.TimeUnit;

final class NetworkVoice {
    static volatile String status="Calls not connected";
    private static final Handler main=new Handler(Looper.getMainLooper());
    private static final OkHttpClient client=new OkHttpClient.Builder().pingInterval(10,TimeUnit.SECONDS).connectTimeout(10,TimeUnit.SECONDS).readTimeout(0,TimeUnit.SECONDS).build();
    private static WebSocket socket;
    private static Context context;
    private static WirelessAudio audio;
    private static String identity="";
    private static final Set<String> seen=new LinkedHashSet<>();
    private static CommandClock clock=new CommandClock();
    // Voice reconnection must not wait for the SMS worker's 60-second backoff.
    private static final Runnable reconnect=()->{try{if(context!=null)ensure(context,Vault.read(context));}catch(Exception ignored){}};
    private static final RecoveryWindow recovery=new RecoveryWindow();
    private static final Runnable recoveryTimeout=()->{
        if(recovery.callId.equals(RelayInCallService.id)&&RelayInCallService.remoteOwned){
            android.util.Log.i("RelayVoice","Recovery expired; ending remote call");
            RelayInCallService.endRemoteCall();
        }
        recovery.clear();
    };
    static void recover(long remaining){
        stopAudio();
        if(!RelayInCallService.remoteOwned||RelayInCallService.current==null)return;
        recovery.start(RelayInCallService.id,SystemClock.elapsedRealtime(),remaining);
        main.removeCallbacks(recoveryTimeout);
        main.postDelayed(recoveryTimeout,Math.max(0,recovery.deadline-SystemClock.elapsedRealtime()));
        status="Call audio reconnecting (up to 60 seconds)";
    }
    static void clearRecovery(){main.removeCallbacks(recoveryTimeout);recovery.clear();}
    static synchronized void ensure(Context c,JSONObject settings){
        context=c.getApplicationContext();
        if(!settings.optBoolean("voiceEnabled")||!settings.optBoolean("enabled")){close();return;}
        String key=settings.optString("origin")+settings.optString("token");
        if(socket!=null&&identity.equals(key))return;
        main.removeCallbacks(reconnect);
        if(!identity.isEmpty()&&!identity.equals(key))close();
        identity=key;clock=new CommandClock();
        String origin=settings.optString("origin");
        if(!origin.startsWith("https://")){status="Calls require HTTPS";return;}
        status="Connecting calls…";
        Request request=new Request.Builder().url(origin.replaceFirst("https://","wss://")+"/api/voice/device").header("Authorization","Bearer "+settings.optString("token")).build();
        socket=client.newWebSocket(request,new WebSocketListener(){
            @Override public void onOpen(WebSocket ws,Response response){synchronized(NetworkVoice.class){if(socket!=ws){ws.close(1000,"Replaced");return;}status="Calls connected";}main.post(NetworkVoice::publish);}
            @Override public void onMessage(WebSocket ws,String text){
                if(ws!=socket||text.length()>4096)return;
                try{JSONObject message=new JSONObject(text);main.post(()->handle(ws,message));}catch(Exception ignored){}
            }
            @Override public void onMessage(WebSocket ws,ByteString bytes){synchronized(NetworkVoice.class){if(ws==socket&&audio!=null&&bytes.size()==640)audio.feed(bytes.toByteArray());}}
            @Override public void onFailure(WebSocket ws,Throwable t,Response r){android.util.Log.i("RelayVoice","Socket failure: "+t.getClass().getSimpleName());lost(ws);}
            @Override public void onClosed(WebSocket ws,int code,String reason){android.util.Log.i("RelayVoice","Socket closed: "+code);lost(ws);}
            @Override public void onClosing(WebSocket ws,int code,String reason){ws.close(code,null);lost(ws);}
        });
    }
    private static void lost(WebSocket ws){synchronized(NetworkVoice.class){if(socket!=ws)return;socket=null;status="Calls offline; reconnecting";}main.post(()->{RelayInCallService.connectionLost();main.removeCallbacks(reconnect);main.postDelayed(reconnect,3000);});}
    private static void handle(WebSocket ws,JSONObject msg){
        if(ws!=socket)return;
        try{
            if(msg.optString("type").equals("hello")){clock.sync(msg.getLong("serverTime"),SystemClock.elapsedRealtime());return;}
            if(msg.optString("type").equals("sync")){publish();return;}
            if(msg.optString("type").equals("command")){
                String id=msg.getString("id");
                if(seen.contains(id)){result(ws,msg,false,"duplicate");return;}
                if(!clock.accepts(msg.optLong("issuedAt"),msg.optLong("expires"),SystemClock.elapsedRealtime())){result(ws,msg,false,"expired");publish();return;}
                seen.add(id);if(seen.size()>256)seen.remove(seen.iterator().next());
                RelayInCallService.command(context,msg);
                result(ws,msg,true,"accepted");
            }
            if(msg.optString("type").equals("media")){
                if(!msg.optBoolean("enabled")){stopAudio();if(msg.optBoolean("recover")&&RelayInCallService.id.equals(msg.optString("callId")))recover(msg.optLong("remainingMs",60000));return;}
                if(RelayInCallService.current==null||RelayInCallService.current.getState()!=android.telecom.Call.STATE_ACTIVE||!RelayInCallService.id.equals(msg.optString("callId")))return;
                if(audio!=null)return;
                int sim=RelayInCallService.sim(context,RelayInCallService.current.getDetails().getAccountHandle());
                RelayInCallService.remoteOwned=true;
                final WirelessAudio[] started=new WirelessAudio[1];
                started[0]=new WirelessAudio(context,ws,sim,()->main.post(()->{if(audio==started[0]){String reason=started[0].failureReason;stopAudio();sendError(reason);RelayInCallService.connectionLost();}}));audio=started[0];audio.start();
            }
            if(msg.optString("type").equals("media_restored")&&RelayInCallService.id.equals(msg.optString("callId"))){clearRecovery();status="Call audio connected";}
        }catch(Exception e){try{if(msg.optString("type").equals("command")){result(ws,msg,false,e instanceof SecurityException?"permission":"unavailable");publish();}else{sendError();RelayInCallService.connectionLost();}}catch(Exception ignored){}}
    }
    private static void result(WebSocket ws,JSONObject msg,boolean accepted,String code)throws Exception{
        ws.send(new JSONObject().put("type","command_result").put("id",msg.optString("id")).put("action",msg.optString("action")).put("accepted",accepted).put("code",code).toString());
        android.util.Log.i("RelayVoice","command "+msg.optString("action")+": "+code);
    }
    private static void sendError(){sendError("unspecified");}
    private static void sendError(String reason){try{if(socket!=null)socket.send(new JSONObject().put("type","media_error").put("reason",reason).toString());}catch(Exception ignored){}}
    static void publish(){main.post(()->{try{WebSocket ws=socket;if(ws!=null)ws.send(new JSONObject().put("type","state").put("call",RelayInCallService.state(context)==null?JSONObject.NULL:RelayInCallService.state(context)).toString());}catch(Exception ignored){}});}
    static synchronized void stopAudio(){if(audio!=null){audio.stop();audio=null;}}
    static synchronized void close(){main.removeCallbacks(reconnect);WebSocket old=socket;socket=null;stopAudio();if(old!=null)old.close(1000,"Paused");status="Calls paused";main.post(()->{clearRecovery();RelayInCallService.endRemoteCall();});}
}
