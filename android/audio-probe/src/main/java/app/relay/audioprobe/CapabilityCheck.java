package app.relay.audioprobe;

import android.app.Instrumentation;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Bundle;

/** ADB-run metadata inspection only: no stream, recording, tone or network. */
public class CapabilityCheck extends Instrumentation {
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    @Override public void onStart() {
        Context c=getTargetContext(); Bundle result=new Bundle();
        result.putBoolean("capturePermissionGranted",c.checkSelfPermission("android.permission.CAPTURE_AUDIO_OUTPUT")==PackageManager.PERMISSION_GRANTED);
        result.putBoolean("routingPermissionGranted",c.checkSelfPermission("android.permission.MODIFY_AUDIO_ROUTING")==PackageManager.PERMISSION_GRANTED);
        AudioManager am=c.getSystemService(AudioManager.class);int inputs=0,outputs=0;
        for(AudioDeviceInfo d:am.getDevices(AudioManager.GET_DEVICES_INPUTS))if(d.getType()==AudioDeviceInfo.TYPE_TELEPHONY)inputs++;
        for(AudioDeviceInfo d:am.getDevices(AudioManager.GET_DEVICES_OUTPUTS))if(d.getType()==AudioDeviceInfo.TYPE_TELEPHONY)outputs++;
        result.putInt("telephonyInputs",inputs);result.putInt("telephonyOutputs",outputs);
        if(android.os.Build.VERSION.SDK_INT==26 || android.os.Build.VERSION.SDK_INT==27){
            try{result.putInt("preparedDownlinkSource",DownlinkRecord.source(DownlinkRecord.attributes()));}
            catch(Exception e){result.putString("downlinkAttributesError",e.getClass().getSimpleName());}
        }
        android.util.Log.i("RelayAudioProbe","Capability check: audioOpened=false");
        result.putBoolean("audioOpened",false); finish(0,result);
    }
}
