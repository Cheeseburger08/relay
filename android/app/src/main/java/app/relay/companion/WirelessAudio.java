package app.relay.companion;
import android.content.Context;
import android.media.*;
import android.os.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import okhttp3.WebSocket;
import okio.ByteString;

final class WirelessAudio {
    private final Context context;private final WebSocket socket;private final int sim;private final Runnable failed;
    private final ArrayBlockingQueue<byte[]> queue=new ArrayBlockingQueue<>(4);
    private volatile boolean running=true;private volatile java.lang.Process player;private volatile AudioRecord recorder;
    private Thread writer;private PowerManager.WakeLock wake;
    private final java.util.concurrent.atomic.AtomicLong received=new java.util.concurrent.atomic.AtomicLong();
    private final java.util.concurrent.atomic.AtomicLong written=new java.util.concurrent.atomic.AtomicLong();
    volatile String failureReason="unspecified";
    WirelessAudio(Context c,WebSocket s,int slot,Runnable failure){context=c;socket=s;sim=slot;failed=failure;}
    void feed(byte[] pcm){if(running){received.incrementAndGet();if(!queue.offer(pcm)){byte[] stale=queue.poll();if(stale!=null)Arrays.fill(stale,(byte)0);queue.offer(pcm);}}}
    private void report(String reason){if(!reason.equals("flow"))failureReason=reason;android.util.Log.i("RelayUplink","Relay uplink transport: reason="+reason+" received_packets="+received.get()+" written_packets="+written.get()+" queued_packets="+queue.size());}
    void start(){new Thread(this::run,"relay-wireless-audio").start();}
    private void run(){
        short[] samples=new short[320];byte[] frame=new byte[640];int filled=0;
        try{
            if(sim!=1&&sim!=2)throw new IOException("SIM route unknown");
            File script=new File(context.getFilesDir(),"relay-wireless-uplink.sh");
            try(InputStream in=context.getAssets().open("relay-wireless-uplink.sh");OutputStream out=new FileOutputStream(script)){byte[] buffer=new byte[4096];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);}
            File nativeBinary=new File(context.getFilesDir(),"relay-uplink-arm64");
            File staged=File.createTempFile("relay-uplink-",".tmp",context.getFilesDir());
            try{
                try(InputStream in=context.getAssets().open("relay-uplink-arm64");OutputStream out=new FileOutputStream(staged)){byte[] buffer=new byte[4096];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);}
                if(!staged.setExecutable(true,true)||!staged.renameTo(nativeBinary))throw new IOException("Native player installation");
            }finally{if(staged.exists()&&!staged.delete())staged.deleteOnExit();}
            if(!running)return;
            wake=context.getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"Relay:call-audio");wake.acquire(7200000);
            player=new ProcessBuilder("su","-c","sh "+script.getAbsolutePath()+" "+(sim==1?"first":"second")).redirectErrorStream(true).start();
            final java.lang.Process nativePlayer=player;
            new Thread(()->{try(BufferedReader input=new BufferedReader(new InputStreamReader(nativePlayer.getInputStream()))){String line;while((line=input.readLine())!=null){if(line.matches("Relay uplink (started|timing|first packet|first write): [a-z0-9_= ]{1,160}"))android.util.Log.i("RelayUplink",line);if(line.matches("Error playing: (PCM|unexpected buffer|stream stopped).{0,160}"))android.util.Log.i("RelayUplink",line);if(line.contains("Unable to")||line.contains("Error playing")||line.contains("busy")||line.contains("No active call")){if(running){report("player_error");stop();failed.run();}return;}}nativePlayer.waitFor();if(running){report("player_exit");stop();failed.run();}}catch(Exception ignored){if(running){report("status_error");stop();failed.run();}}},"relay-native-status").start();
            writer=new Thread(()->{try(OutputStream out=nativePlayer.getOutputStream()){
                long reported=SystemClock.elapsedRealtime(),lastInput=reported,nextWrite=reported+40;
                while(running){
                    // Exactly one 20ms network frame per tick. Polling with a
                    // fresh timeout for every frame can inject silence just
                    // before a late real frame, overfeeding the modem player.
                    long wait=nextWrite-SystemClock.elapsedRealtime();if(wait>0)Thread.sleep(wait);
                    byte[] pcm=queue.poll();if(pcm==null){if(SystemClock.elapsedRealtime()-lastInput>5000)throw new IOException("Remote audio stopped");pcm=new byte[640];}else lastInput=SystemClock.elapsedRealtime();
                    out.write(pcm);out.flush();written.incrementAndGet();Arrays.fill(pcm,(byte)0);
                    nextWrite=Math.max(nextWrite+20,SystemClock.elapsedRealtime());
                    if(SystemClock.elapsedRealtime()-reported>=5000){report("flow");reported=SystemClock.elapsedRealtime();}
                }
            }catch(Exception ignored){if(running){report("writer_error");stop();failed.run();}}},"relay-native-playback");writer.start();
            int min=AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
            if(min<=0)throw new IOException("Unsupported format");
            recorder=DownlinkRecord.create(context,16000,Math.max(min,3200));
            if(recorder.getState()!=AudioRecord.STATE_INITIALIZED||recorder.getAudioSource()!=MediaRecorder.AudioSource.VOICE_DOWNLINK)throw new IOException("Wrong source");
            recorder.startRecording();
            while(running){int n=recorder.read(samples,0,320,AudioRecord.READ_NON_BLOCKING);if(n<0)throw new IOException("Capture failed");
                for(int i=0;i<n;i++){frame[filled++]=(byte)samples[i];frame[filled++]=(byte)(samples[i]>>8);if(filled==640){if(socket.queueSize()<=6400&&!socket.send(ByteString.of(frame)))throw new IOException("Network stalled");filled=0;Arrays.fill(frame,(byte)0);}}
                Arrays.fill(samples,(short)0);SystemClock.sleep(5);
            }
        }catch(Exception e){if(running){report("capture_error");failed.run();}}
        finally{stop();AudioRecord r=recorder;recorder=null;if(r!=null){try{r.stop();}catch(Exception ignored){}r.release();}Arrays.fill(samples,(short)0);Arrays.fill(frame,(byte)0);}
    }
    synchronized void stop(){running=false;queue.clear();if(writer!=null)writer.interrupt();if(player!=null){try{player.getOutputStream().close();}catch(Exception ignored){}}if(wake!=null&&wake.isHeld())wake.release();}
}
