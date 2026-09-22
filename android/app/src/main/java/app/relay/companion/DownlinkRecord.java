package app.relay.companion;

import android.media.*;
import android.os.Build;
import java.lang.reflect.*;

/** Android 8's attributes builder drops VOICE_DOWNLINK before native setup. */
final class DownlinkRecord {
    static AudioAttributes attributes() throws Exception {
        if(Build.VERSION.SDK_INT!=26 && Build.VERSION.SDK_INT!=27)
            throw new IllegalStateException("Legacy downlink attributes require Android 8");
        AudioAttributes attributes=new AudioAttributes.Builder().build();
        Field source=AudioAttributes.class.getDeclaredField("mSource");
        source.setAccessible(true);
        source.setInt(attributes,MediaRecorder.AudioSource.VOICE_DOWNLINK);
        if(source(attributes)!=MediaRecorder.AudioSource.VOICE_DOWNLINK)
            throw new IllegalStateException("Downlink source was not preserved");
        return attributes;
    }
    static int source(AudioAttributes attributes) throws Exception {
        return (Integer)AudioAttributes.class.getMethod("getCapturePreset").invoke(attributes);
    }
    static AudioRecord create(android.content.Context context,int rate,int bytes) throws Exception {
        if(context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)!=android.content.pm.PackageManager.PERMISSION_GRANTED
            || context.checkSelfPermission("android.permission.CAPTURE_AUDIO_OUTPUT")!=android.content.pm.PackageManager.PERMISSION_GRANTED)
            throw new SecurityException("Call capture permissions required");
        if(Build.VERSION.SDK_INT!=26 && Build.VERSION.SDK_INT!=27)
            return new AudioRecord(MediaRecorder.AudioSource.VOICE_DOWNLINK,rate,
                AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,bytes);
        AudioFormat format=new AudioFormat.Builder().setSampleRate(rate)
            .setChannelMask(AudioFormat.CHANNEL_IN_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build();
        Constructor<AudioRecord> constructor=AudioRecord.class.getDeclaredConstructor(
            AudioAttributes.class,AudioFormat.class,int.class,int.class);
        constructor.setAccessible(true);
        try{return constructor.newInstance(attributes(),format,bytes,AudioManager.AUDIO_SESSION_ID_GENERATE);}
        catch(InvocationTargetException e){
            if(e.getCause() instanceof Exception)throw (Exception)e.getCause();
            throw e;
        }
    }
}
