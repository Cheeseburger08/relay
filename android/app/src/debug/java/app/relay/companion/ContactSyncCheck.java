package app.relay.companion;
import android.app.Instrumentation;
import android.app.Activity;
import android.os.Bundle;
import org.json.JSONObject;
import java.util.UUID;

/** Explicit test invocation only; only touches its randomly namespaced fixture. */
public class ContactSyncCheck extends Instrumentation {
    private String fixture;
    @Override public void onCreate(Bundle args) { super.onCreate(args); fixture=args==null ? null : args.getString("fixture"); start(); }
    @Override public void onStart() {
        if(fixture!=null) { editFixture(); return; }
        Bundle result=new Bundle(); String owner="test-"+UUID.randomUUID(),id=UUID.randomUUID().toString();
        JSONObject row=new JSONObject(); int code=Activity.RESULT_CANCELED;
        try {
            row.put("id",id).put("version",1).put("name","Relay sync test").put("number","+12025550199").put("deleted",false);
            try(android.database.Cursor scan=getTargetContext().getContentResolver().query(android.provider.ContactsContract.CommonDataKinds.Phone.CONTENT_URI,new String[]{"_id","raw_contact_id","display_name","data1","data_sync1"},null,null,"_id ASC")) { if(scan==null) throw new Exception(); }
            ContactSync.apply(getTargetContext(),owner,row);
            ContactSync.apply(getTargetContext(),owner,row);
            if(!ContactSync.read(getTargetContext(),owner,id).getString("name").equals("Relay sync test")) throw new Exception();
            row.put("name","Relay sync edited"); ContactSync.apply(getTargetContext(),owner,row);
            if(!ContactSync.read(getTargetContext(),owner,id).getString("name").equals("Relay sync edited")) throw new Exception();
            row.put("deleted",true); ContactSync.apply(getTargetContext(),owner,row);
            ContactSync.apply(getTargetContext(),owner,row);
            if(ContactSync.read(getTargetContext(),owner,id)!=null) throw new Exception();
            result.putString("result","PASS create, repeat, edit, delete, repeat; synthetic fixture only"); code=Activity.RESULT_OK;
            JSONObject state=Vault.read(getTargetContext());
            JSONObject snapshot=state.optJSONObject("contactSnapshot");
            result.putInt("syncSnapshotCount",snapshot==null ? 0 : snapshot.length());
        } catch(Exception e) { result.putString("result","FAIL "+e.getClass().getSimpleName()); result.putString("testStage",e.getStackTrace()[0].getClassName()+":"+e.getStackTrace()[0].getLineNumber()); }
        finally { try { row.put("deleted",true); ContactSync.apply(getTargetContext(),owner,row); } catch(Exception e) {result.putString("cleanup","failed");code=Activity.RESULT_CANCELED;} }
        finish(code,result);
    }
    private void editFixture() {
        Bundle result=new Bundle(); int code=Activity.RESULT_CANCELED;
        try {
            UUID.fromString(fixture);
            JSONObject state=Vault.read(getTargetContext()); String owner=state.getString("contactNamespace");
            JSONObject current=ContactSync.read(getTargetContext(),owner,fixture);
            if(current==null || !"+12025550198".equals(current.optString("number")) || !"Relay contact fixture".equals(current.optString("name"))) throw new Exception();
            long raw;
            try(android.database.Cursor rows=getTargetContext().getContentResolver().query(android.provider.ContactsContract.RawContacts.CONTENT_URI,new String[]{"_id"},"sync1=? AND deleted=0",new String[]{"relay:"+owner+":"+fixture},null)) {
                if(rows==null || !rows.moveToFirst()) throw new Exception(); raw=rows.getLong(0);
            }
            android.content.ContentValues values=new android.content.ContentValues(); values.put("data1","Relay-phone-edited-fixture");
            int changed=getTargetContext().getContentResolver().update(android.provider.ContactsContract.Data.CONTENT_URI,values,"raw_contact_id=? AND mimetype=?",new String[]{Long.toString(raw),"vnd.android.cursor.item/name"});
            if(changed!=1) throw new Exception();
            ContactSync.sync(getTargetContext(),state.getString("origin"),state.getString("token"));
            result.putString("result","PASS fixture edited on phone and sync completed"); code=Activity.RESULT_OK;
        } catch(Exception e) { result.putString("result","FAIL "+e.getClass().getSimpleName()); }
        finish(code,result);
    }
}
