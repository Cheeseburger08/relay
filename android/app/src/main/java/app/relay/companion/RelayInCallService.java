package app.relay.companion;
import android.telecom.*;
import android.content.*;
import android.os.Bundle;
import android.net.Uri;
import java.util.*;
import org.json.JSONObject;

public class RelayInCallService extends InCallService {
    static volatile RelayInCallService instance;
    static Call current;
    static String id="";
    static boolean remoteOwned;
    private static final android.os.Handler tones=new android.os.Handler(android.os.Looper.getMainLooper());
    private static int toneGeneration;
    static final LinkedHashMap<Call,String> all=new LinkedHashMap<>();
    private final Call.Callback callback=new Call.Callback(){
        @Override public void onStateChanged(Call call,int state){if(call!=current&&state==Call.STATE_ACTIVE){NetworkVoice.stopAudio();current=call;id=all.get(call);remoteOwned=false;}NetworkVoice.publish();if(call==current&&state!=Call.STATE_ACTIVE)NetworkVoice.stopAudio();}
        @Override public void onDetailsChanged(Call call,Call.Details details){NetworkVoice.publish();}
    };
    @Override public void onCallAdded(Call call){
        super.onCallAdded(call);instance=this;
        all.put(call,UUID.randomUUID().toString());
        if(current==null){current=call;id=all.get(call);}call.registerCallback(callback);
        NetworkVoice.publish();
        startActivity(new Intent(this,PhoneCallActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
    @Override public void onCallRemoved(Call call){
        call.unregisterCallback(callback);
        all.remove(call);
        if(current==call){NetworkVoice.clearRecovery();NetworkVoice.stopAudio();current=all.isEmpty()?null:all.keySet().iterator().next();id=current==null?"":all.get(current);remoteOwned=false;NetworkVoice.publish();}
        super.onCallRemoved(call);
    }
    static int sim(Context context,PhoneAccountHandle handle){
        if(handle==null)return 0;
        for(android.telephony.SubscriptionInfo row:Sims.active(context)){
            String icc=row.getIccId();
            if((icc!=null&&!icc.isEmpty()&&handle.getId().contains(icc))||handle.getId().equals(String.valueOf(row.getSubscriptionId())))return row.getSimSlotIndex()+1;
        }return 0;
    }
    static JSONObject state(Context context)throws Exception{
        if(current==null)return null;
        Call.Details details=current.getDetails();String number=details.getHandle()==null?"":details.getHandle().getSchemeSpecificPart();
        int state=current.getState();String name=state==Call.STATE_RINGING?"ringing":state==Call.STATE_ACTIVE?"active":state==Call.STATE_HOLDING?"held":state==Call.STATE_DISCONNECTED?"ended":"dialing";
        return new JSONObject().put("id",id).put("state",name).put("sim",sim(context,details.getAccountHandle())).put("number",number);
    }
    static void command(Context context,JSONObject msg)throws Exception{
        String action=msg.getString("action");
        if(action.equals("check")){
            TelecomManager manager=context.getSystemService(TelecomManager.class);
            if(!context.getPackageName().equals(manager.getDefaultDialerPackage())||!Sims.permission(context,android.Manifest.permission.CALL_PHONE))throw new SecurityException("Phone app permission missing");
            boolean found=false;
            for(PhoneAccountHandle candidate:manager.getCallCapablePhoneAccounts())if(sim(context,candidate)>0)found=true;
            if(!found)throw new IllegalStateException("No mapped SIM account");
            return;
        }
        if(action.equals("dial")){
            if(current!=null)throw new IllegalStateException("Call already present");
            String number=msg.getString("number");int slot=msg.getInt("sim");
            if(!number.matches("\\+[1-9][0-9]{6,14}")||!(slot==1||slot==2))throw new IllegalArgumentException("Invalid dial request");
            TelecomManager manager=context.getSystemService(TelecomManager.class);
            PhoneAccountHandle account=null;
            for(PhoneAccountHandle candidate:manager.getCallCapablePhoneAccounts())if(sim(context,candidate)==slot)account=candidate;
            if(account==null)throw new IllegalStateException("SIM account unavailable");
            Bundle extras=new Bundle();extras.putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE,account);
            remoteOwned=true;manager.placeCall(Uri.fromParts("tel",number,null),extras);return;
        }
        if(current==null||!id.equals(msg.optString("callId")))throw new IllegalStateException("Call no longer present");
        if(action.equals("answer")){if(current.getState()!=Call.STATE_RINGING)throw new IllegalStateException("Not ringing");remoteOwned=true;current.answer(0);}
        if(action.equals("hangup")){current.disconnect();NetworkVoice.stopAudio();}
        if(action.equals("dtmf")){
            String digit=msg.optString("digit");
            if(current.getState()!=Call.STATE_ACTIVE||!digit.matches("[0-9*#]"))throw new IllegalArgumentException("Invalid tone");
            Call call=current;int generation=++toneGeneration;call.playDtmfTone(digit.charAt(0));
            tones.postDelayed(()->{if(generation==toneGeneration&&current==call)call.stopDtmfTone();},130);
        }
    }
    static void connectionLost(){NetworkVoice.recover(60000);}
    static void endRemoteCall(){if(remoteOwned&&current!=null)current.disconnect();NetworkVoice.stopAudio();}
}
