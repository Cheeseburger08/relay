package app.relay.companion;
import android.app.Instrumentation;
import android.os.Bundle;
import org.json.JSONObject;
public class HistoryCheck extends Instrumentation {
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    @Override public void onStart(){
        Bundle result=new Bundle();
        try{
            JSONObject s=Vault.read(getTargetContext());
            result.putInt("pendingEvents",Vault.object(s,"events").length());
            result.putInt("historySeen",Vault.object(s,"historySeen").length());
            if(!s.optBoolean("enabled")||!s.has("token"))throw new IllegalStateException("Not enabled");
            HistorySync.sync(getTargetContext(),s.getString("origin"),s.getString("token"));
            result.putBoolean("success",true);finish(0,result);
        }catch(Exception e){result.putString("failureClass",e.getClass().getSimpleName());if(e instanceof Api.Failure)result.putInt("httpStatus",((Api.Failure)e).status);finish(1,result);}
    }
}
