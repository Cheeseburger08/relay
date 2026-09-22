package app.relay.companion;
import android.app.*;import android.os.*;import android.content.*;import android.net.Uri;import android.database.Cursor;import android.provider.*;import org.json.*;
/** Only synthetic rows, explicit ADB run coordinated with the test operator. */
public class ManagementNetworkCheck extends Instrumentation {
 @Override public void onCreate(Bundle args){super.onCreate(args);start();}
 boolean present(Uri uri){try(Cursor r=getTargetContext().getContentResolver().query(uri,new String[]{"_id"},null,null,null)){return r!=null&&r.moveToFirst();}}
 @Override public void onStart(){Bundle result=new Bundle();int code=Activity.RESULT_CANCELED;Uri sms=null,call=null;boolean block=false;String stage="create";String number="+12025550196";
  try{Context c=getTargetContext();ContentResolver r=c.getContentResolver();JSONObject settings=Vault.read(c);String origin=settings.getString("origin"),token=settings.getString("token");
   if(BlockedNumberContract.isBlocked(c,number))throw new Exception();
   long date=System.currentTimeMillis();ContentValues v=new ContentValues();v.put("address",number);v.put("body","Relay network deletion fixture");v.put("date",date);v.put("type",1);v.put("read",1);v.put("sub_id",Sims.subscription(c,1));sms=r.insert(Telephony.Sms.CONTENT_URI,v);if(sms==null)throw new Exception();
   v=new ContentValues();v.put("number",number);v.put("date",date);v.put("duration",0);v.put("type",3);call=r.insert(CallLog.Calls.CONTENT_URI,v);if(call==null)throw new Exception();
   stage="import";HistorySync.sync(c,origin,token);block=true;BlockSync.set(c,number,true);BlockSync.sync(c,origin,token);BlockSync.sync(c,origin,token);
   Bundle ready=new Bundle();ready.putString("fixtureSms","smsdb-"+ContentUris.parseId(sms)+"-"+date);ready.putString("fixtureCall","call-"+ContentUris.parseId(call)+"-"+date);ready.putString("stage","ready");sendStatus(1,ready);
   stage="wait_website";long end=SystemClock.elapsedRealtime()+45000;
   while(SystemClock.elapsedRealtime()<end){HistoryManagement.sync(c,origin,token);BlockSync.sync(c,origin,token);if(!present(sms)&&!BlockedNumberContract.isBlocked(c,number))break;SystemClock.sleep(1000);}
   if(present(sms)||BlockedNumberContract.isBlocked(c,number))throw new Exception();
   stage="phone_delete";r.delete(CallLog.Calls.CONTENT_URI,"_id=?",new String[]{Long.toString(ContentUris.parseId(call))});HistorySync.sync(c,origin,token);
   result.putString("result","PASS website SMS deletion reaches phone, phone call deletion uploads, native block imports and website unblock applies");code=Activity.RESULT_OK;
  }catch(Exception e){result.putString("result","FAIL "+stage+" "+e.getClass().getSimpleName());}
  finally{try{ContentResolver r=getTargetContext().getContentResolver();if(sms!=null)r.delete(sms,null,null);if(call!=null)r.delete(CallLog.Calls.CONTENT_URI,"_id=?",new String[]{Long.toString(ContentUris.parseId(call))});if(block)BlockSync.set(getTargetContext(),number,false);}catch(Exception e){code=Activity.RESULT_CANCELED;result.putString("cleanup","failed");}}
  finish(code,result);
 }
}
