package app.relay.companion;
import android.Manifest;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.provider.*;
import org.json.*;
import java.util.*;
final class HistoryManagement {
    static volatile String status="History changes pending";
    static String hash(String text) throws Exception {byte[] digest=java.security.MessageDigest.getInstance("SHA-256").digest(text.getBytes("UTF-8"));StringBuilder s=new StringBuilder();for(byte b:digest)s.append(String.format("%02x",b&255));return s.toString();}
    private static Uri uri(String source){String[] p=source.split("-");return ContentUris.withAppendedId(source.startsWith("smsdb-")?Telephony.Sms.CONTENT_URI:CallLog.Calls.CONTENT_URI,Long.parseLong(p[1]));}
    private static boolean absent(Context c,String source){
        boolean sms=source.startsWith("smsdb-");
        if(!Sims.permission(c,sms?Manifest.permission.READ_SMS:Manifest.permission.READ_CALL_LOG))throw new SecurityException();
        try(Cursor r=c.getContentResolver().query(uri(source),new String[]{"date"},null,null,null)){if(r==null)throw new IllegalStateException();return !r.moveToFirst()||((!sms||!source.endsWith("-0"))&&!source.endsWith("-"+r.getLong(0)));}
    }
    static void sync(Context c,String origin,String token) throws Exception {
        JSONObject known=Vault.read(c).optJSONObject("historySeenV3");JSONArray missing=new JSONArray();
        if(known!=null){Iterator<String> keys=known.keys();while(keys.hasNext()&&missing.length()<100){String id=keys.next();try{if(absent(c,id))missing.put(id);}catch(SecurityException ignored){}}}
        JSONObject response=Api.post(origin,"/history/sync",new JSONObject().put("missing",missing).put("results",new JSONArray()),token);
        Vault.update(c,s->{for(int i=0;i<missing.length();i++)Vault.object(s,"historySeenV3").remove(missing.getString(i));});
        JSONArray results=new JSONArray(),actions=response.getJSONArray("actions");
        for(int i=0;i<actions.length();i++){
            JSONObject action=actions.getJSONObject(i),r=new JSONObject().put("id",action.getString("id"));
            try{apply(c,action);r.put("ok",true);}catch(SecurityException e){r.put("ok",false).put("error","permission");}catch(IllegalArgumentException e){r.put("ok",false).put("error","changed");}catch(Exception e){r.put("ok",false).put("error","unavailable");}
            results.put(r);
        }
        if(results.length()>0)Api.post(origin,"/history/sync",new JSONObject().put("missing",new JSONArray()).put("results",results),token);
        int failures=0;for(int i=0;i<results.length();i++)if(!results.getJSONObject(i).getBoolean("ok"))failures++;
        status=failures>0?"Some history changes need attention":"History changes synced";
    }
    static void apply(Context c,JSONObject a) throws Exception {
        String source=a.getString("source"),action=a.getString("action");
        if(!source.matches("(smsdb|call)-[0-9]+-[0-9]+"))throw new IllegalArgumentException();
        boolean sms=source.startsWith("smsdb-");Uri target=uri(source);
        if(absent(c,source)){if(action.equals("delete"))return;throw new IllegalArgumentException();}
        try(Cursor r=c.getContentResolver().query(target,sms?new String[]{"date","address","body","sub_id"}:new String[]{"date","number"},null,null,null)){
            if(r==null||!r.moveToFirst())throw new IllegalStateException();
            String original=r.getString(1);if(original==null||original.isEmpty())original=sms?"Unknown sender":"Unknown caller";
            if(r.getLong(0)!=a.getLong("timestamp")||!Objects.equals(original,a.getString("originalNumber")))throw new IllegalArgumentException();
            if(sms&&!hash(r.getString(2)==null?"":r.getString(2)).equals(a.getString("textHash")))throw new IllegalArgumentException();
            if(action.equals("set_sim")){if(!sms||a.getInt("sim")!=1)throw new IllegalArgumentException();int slot=Sims.slot(c,r.getInt(3));if(slot==1)return;if(slot>0)throw new IllegalArgumentException();}
        }
        if(action.equals("delete")){c.getContentResolver().delete(sms?Telephony.Sms.CONTENT_URI:CallLog.Calls.CONTENT_URI,"_id=?",new String[]{Long.toString(ContentUris.parseId(target))});if(!absent(c,source))throw new SecurityException();}
        else if(action.equals("set_sim")&&sms){int sub=Sims.subscription(c,1);if(sub<0)throw new IllegalStateException();ContentValues values=new ContentValues();values.put("sub_id",sub);if(c.getContentResolver().update(target,values,null,null)!=1)throw new SecurityException();try(Cursor check=c.getContentResolver().query(target,new String[]{"sub_id"},null,null,null)){if(check==null||!check.moveToFirst()||check.getInt(0)!=sub)throw new SecurityException();}}
        else throw new IllegalArgumentException();
    }
}
