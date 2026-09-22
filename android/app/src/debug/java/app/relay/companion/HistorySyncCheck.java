package app.relay.companion;
import android.app.Instrumentation;
import android.app.Activity;
import android.os.Bundle;
import android.database.Cursor;
import android.provider.Telephony;
import android.provider.CallLog;
import org.json.JSONObject;
/** Read-only counts and repeat-sync check. No addresses or content printed. */
public class HistorySyncCheck extends Instrumentation {
    @Override public void onCreate(Bundle args) {super.onCreate(args);start();}
    @Override public void onStart() {
        Bundle result=new Bundle();int code=Activity.RESULT_CANCELED;
        try {
            try(Cursor r=getTargetContext().getContentResolver().query(Telephony.Sms.CONTENT_URI,new String[]{"_id"},null,null,null)) {result.putInt("phoneSmsRows",r==null?-1:r.getCount());}
            try(Cursor r=getTargetContext().getContentResolver().query(CallLog.Calls.CONTENT_URI,new String[]{"_id"},null,null,null)) {result.putInt("phoneCallRows",r==null?-1:r.getCount());}
            JSONObject state=Vault.read(getTargetContext());
            HistorySync.sync(getTargetContext(),state.getString("origin"),state.getString("token"));
            int first=Vault.object(Vault.read(getTargetContext()),"historySeenV3").length();
            HistorySync.sync(getTargetContext(),state.getString("origin"),state.getString("token"));
            int second=Vault.object(Vault.read(getTargetContext()),"historySeenV3").length();
            result.putInt("confirmedSourceRows",second);
            if(first!=second) throw new Exception();
            result.putString("result","PASS repeated history scan stable");code=Activity.RESULT_OK;
        }catch(Exception e){result.putString("result","FAIL "+e.getClass().getSimpleName());}
        finish(code,result);
    }
}
