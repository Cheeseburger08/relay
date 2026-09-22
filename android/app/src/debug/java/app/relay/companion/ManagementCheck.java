package app.relay.companion;
import android.app.*;
import android.os.Bundle;
import android.content.*;
import android.net.Uri;
import android.database.Cursor;
import android.provider.*;
import org.json.*;
/** Explicit ADB invocation; only generated fixtures, no calls or SMS are sent. */
public class ManagementCheck extends Instrumentation {
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    @Override public void onStart(){Bundle result=new Bundle();int code=Activity.RESULT_CANCELED;Uri sms=null,call=null;String number="+12025550197";boolean changedBlock=false;String stage="start";
        try{Context c=getTargetContext();ContentResolver r=c.getContentResolver();long date=System.currentTimeMillis();String text="Relay synthetic management "+java.util.UUID.randomUUID();
            stage="insert_sms";ContentValues v=new ContentValues();v.put("address",number);v.put("body",text);v.put("date",date);v.put("type",1);v.put("read",1);v.put("sub_id",-1);sms=r.insert(Telephony.Sms.CONTENT_URI,v);if(sms==null)throw new Exception();
            JSONObject a=new JSONObject().put("source","smsdb-"+ContentUris.parseId(sms)+"-0").put("action","set_sim").put("sim",1).put("timestamp",date).put("originalNumber",number).put("textHash",HistoryManagement.hash(text));
            stage="assign_sim";HistoryManagement.apply(c,a);HistoryManagement.apply(c,a);
            stage="guard";a.put("action","delete").put("textHash","bad");try{HistoryManagement.apply(c,a);throw new Exception("guard");}catch(IllegalArgumentException expected){}
            stage="delete_sms";a.put("textHash",HistoryManagement.hash(text));HistoryManagement.apply(c,a);HistoryManagement.apply(c,a);
            stage="insert_call";v=new ContentValues();v.put("number",number);v.put("date",date);v.put("type",3);v.put("duration",0);call=r.insert(CallLog.Calls.CONTENT_URI,v);if(call==null)throw new Exception();
            stage="delete_call";a=new JSONObject().put("source","call-"+ContentUris.parseId(call)+"-"+date).put("action","delete").put("timestamp",date).put("originalNumber",number);HistoryManagement.apply(c,a);HistoryManagement.apply(c,a);
            stage="block";if(!BlockedNumberContract.isBlocked(c,number)){changedBlock=true;BlockSync.set(c,number,true);if(!BlockSync.current(c).contains(number))throw new Exception();BlockSync.set(c,number,false);}
            result.putString("result","PASS guarded SMS/call delete, repeat, SIM1 update/readback, native block/unblock");code=Activity.RESULT_OK;
        }catch(Exception e){result.putString("result","FAIL "+stage+" "+e.getClass().getSimpleName());}
        finally{try{ContentResolver r=getTargetContext().getContentResolver();if(sms!=null)r.delete(sms,null,null);if(call!=null)r.delete(CallLog.Calls.CONTENT_URI,"_id=?",new String[]{Long.toString(ContentUris.parseId(call))});if(changedBlock)BlockSync.set(getTargetContext(),number,false);}catch(Exception e){result.putString("cleanup","FAIL");code=Activity.RESULT_CANCELED;}}
        finish(code,result);
    }
}
