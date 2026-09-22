package app.relay.audioprobe;

import android.content.Context;
import android.media.*;
import android.net.*;
import android.os.SystemClock;
import java.io.*;
import java.util.Arrays;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

/** Foreground, bounded USB laboratory stream. No files, IP sockets or microphone fallback. */
final class LiveCapture implements AutoCloseable {
    private volatile boolean stopped;
    private LocalServerSocket server;
    private LocalSocket client;
    private final Context context;
    private final BooleanSupplier inCall;
    private final Consumer<String> report;
    LiveCapture(Context context, BooleanSupplier inCall, Consumer<String> report) {
        this.context=context; this.inCall=inCall; this.report=report;
    }
    void run() {
        AudioRecord recorder=null;
        short[] samples=new short[320]; byte[] bytes=new byte[640];
        long total=0;
        try {
            synchronized(this) {
                if(stopped || !inCall.getAsBoolean()) return;
                server=new LocalServerSocket("relay-audio-lab");
            }
            report.accept("Live browser test armed for two minutes. Press Start in the laptop browser.");
            LocalSocket accepted=server.accept();
            synchronized(this) { if(stopped) { accepted.close(); return; } client=accepted; }
            int uid=client.getPeerCredentials().getUid();
            if(uid!=0 && uid!=2000) throw new SecurityException("USB debugging peer required");
            client.setSoTimeout(2000);
            byte[] hello=new byte[4]; new DataInputStream(client.getInputStream()).readFully(hello);
            if(!Arrays.equals(hello,new byte[]{'G','O','1','6'}) || stopped || !inCall.getAsBoolean())
                throw new IOException("Call or local handshake unavailable");
            int min=AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
            if(min<=0) throw new IOException("Unsupported call capture format");
            recorder=DownlinkRecord.create(context,16000,Math.max(min,3200));
            if(recorder.getState()!=AudioRecord.STATE_INITIALIZED || recorder.getAudioSource()!=MediaRecorder.AudioSource.VOICE_DOWNLINK)
                throw new IOException("Downlink capture unavailable");
            recorder.startRecording();
            OutputStream output=client.getOutputStream(); output.write(new byte[]{'R','L','Y','1'});
            report.accept("Live audio active over USB. Stop here or in the browser to end the test.");
            long deadline=SystemClock.elapsedRealtime()+120000;
            while(!stopped && inCall.getAsBoolean() && SystemClock.elapsedRealtime()<deadline) {
                int n=recorder.read(samples,0,samples.length,AudioRecord.READ_NON_BLOCKING);
                if(n<0) throw new IOException("Call capture read failed");
                for(int i=0;i<n;i++) { bytes[i*2]=(byte)samples[i]; bytes[i*2+1]=(byte)(samples[i]>>8); }
                if(n>0) { output.write(bytes,0,n*2); total+=n; }
                Arrays.fill(samples,(short)0); Arrays.fill(bytes,(byte)0);
                SystemClock.sleep(5);
            }
        } catch(Exception e) {
            if(!stopped) report.accept("Live stream stopped: "+e.getClass().getSimpleName()+". Check call, USB and browser.");
        } finally {
            close();
            if(recorder!=null) { try { recorder.stop(); } catch(Exception ignored) {} recorder.release(); }
            Arrays.fill(samples,(short)0); Arrays.fill(bytes,(byte)0);
            report.accept("Live browser test ended; "+total+" downlink samples transferred. No recording saved.");
        }
    }
    @Override public synchronized void close() {
        stopped=true;
        try { if(client!=null) client.close(); } catch(IOException ignored) {}
        try { if(server!=null) server.close(); } catch(IOException ignored) {}
    }
}
