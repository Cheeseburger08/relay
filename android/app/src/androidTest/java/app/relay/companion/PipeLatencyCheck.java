package app.relay.companion;
import android.app.Instrumentation;
import android.os.*;
import java.io.*;
import java.util.concurrent.*;
/** Synthetic pipe timing only: does not open any microphone or call audio. */
public class PipeLatencyCheck extends Instrumentation {
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    @Override public void onStart(){Bundle result=new Bundle();ExecutorService reader=Executors.newSingleThreadExecutor();java.lang.Process child=null;
        try{child=new ProcessBuilder("cat").start();final InputStream in=child.getInputStream();OutputStream out=child.getOutputStream();byte[] packet=new byte[640];
            Future<Integer> read=reader.submit(()->in.read());out.write(packet);
            boolean buffered=false;try{read.get(150,TimeUnit.MILLISECONDS);}catch(TimeoutException expected){buffered=true;}
            long start=SystemClock.elapsedRealtime();out.flush();read.get(2,TimeUnit.SECONDS);
            result.putBoolean("unflushedPacketBufferedOver150ms",buffered);result.putLong("afterFlushFirstByteMs",SystemClock.elapsedRealtime()-start);
            child.destroy();child=new ProcessBuilder("su","-c","timeout -k 1 10 /data/local/tmp/relay-uplink-check --stream-test").redirectErrorStream(true).start();
            try(OutputStream pipe=child.getOutputStream()){for(int i=0;i<96;i++){pipe.write(packet);pipe.flush();SystemClock.sleep(20);}}
            String line;try(BufferedReader status=new BufferedReader(new InputStreamReader(child.getInputStream()))){while((line=status.readLine())!=null){if(line.matches("Relay pipe check: frames=[0-9]+ dropped=[0-9]+ result=-?[0-9]+"))result.putString("nativePipe",line);}}
            result.putInt("nativeExit",child.waitFor());result.putBoolean("success",child.exitValue()==0);finish(child.exitValue(),result);
        }catch(Exception e){result.putString("failureClass",e.getClass().getSimpleName());finish(1,result);}
        finally{if(child!=null)child.destroy();reader.shutdownNow();}
    }
}
