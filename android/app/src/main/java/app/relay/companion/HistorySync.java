package app.relay.companion;
import android.Manifest;
import android.content.Context;
import android.database.Cursor;
import android.provider.Telephony;
import android.provider.CallLog;
import android.telephony.SubscriptionInfo;
import org.json.*;

/** Provider history import with explicit, guarded management synchronization. */
final class HistorySync {
    static volatile String status="History import pending";
    static void sync(Context c,String origin,String token) throws Exception {
        HistoryManagement.sync(c,origin,token);
        int imported=0;
        if(Sims.permission(c,Manifest.permission.READ_SMS)) imported+=sms(c,origin,token);
        if(Sims.permission(c,Manifest.permission.READ_CALL_LOG)) imported+=calls(c,origin,token);
        status=!Sims.permission(c,Manifest.permission.READ_SMS) ? "SMS history needs Read SMS permission" : imported>=50 ? "Importing phone history…" : "SMS and call history checked";
    }
    static String normalize(Context c,String value) {
        if(value==null || value.isEmpty()) return "Unknown caller";
        String country=c.getSystemService(android.telephony.TelephonyManager.class).getNetworkCountryIso();
        String formatted=android.telephony.PhoneNumberUtils.formatNumberToE164(value,country==null || country.isEmpty() ? "IR" : country.toUpperCase(java.util.Locale.ROOT));
        return formatted==null ? value : formatted;
    }
    private static String signature(JSONObject row) throws Exception {
        byte[] digest=java.security.MessageDigest.getInstance("SHA-256").digest(row.toString().getBytes("UTF-8"));
        StringBuilder value=new StringBuilder();for(byte b:digest)value.append(String.format("%02x",b&255));return value.toString();
    }
    private static boolean seen(Context c,JSONObject row) throws Exception {
        JSONObject seen=Vault.read(c).optJSONObject("historySeenV3");return seen!=null && signature(row).equals(seen.optString(row.getString("id")));
    }
    private static synchronized void upload(Context c,String origin,String token,JSONObject row) throws Exception {
        if(seen(c,row))return;
        JSONObject transmitted=new JSONObject(row.toString());
        long since=Vault.read(c).optLong("smsLiveSince",0),date=row.optLong("timestamp"),now=System.currentTimeMillis();
        if("sms".equals(row.optString("type")) && "incoming".equals(row.optString("direction")) && since>0 && date>=since && date>=now-120000 && date<=now+10000)transmitted.put("live",true);
        Api.post(origin,"/history",new JSONObject().put("records",new JSONArray().put(transmitted)),token);
        Vault.update(c,s->Vault.object(s,"historySeenV3").put(row.getString("id"),signature(row)));
    }
    static int recentSms(Context c,String origin,String token) throws Exception {
        if(!Sims.permission(c,Manifest.permission.READ_SMS))return 0;
        return sms(c,origin,token,true);
    }
    private static int sms(Context c,String origin,String token) throws Exception { return sms(c,origin,token,false); }
    private static int sms(Context c,String origin,String token,boolean recent) throws Exception {
        String[] projection={"_id","address","date","date_sent","type","body","read","sub_id"};int count=0;
        try(Cursor r=c.getContentResolver().query(Telephony.Sms.CONTENT_URI,projection,recent?"date>=?":null,recent?new String[]{Long.toString(System.currentTimeMillis()-120000)}:null,recent?"date DESC, _id DESC":"date ASC, _id ASC")) {
            while(r!=null && r.moveToNext() && count<50) {
                long date=Math.max(0,r.getLong(2));String id="smsdb-"+r.getLong(0)+"-"+date;
                int type=r.getInt(4); if(type<1 || type>6) continue;
                String raw=r.getString(1),body=r.getString(5);if(raw==null || raw.isEmpty()) raw="Unknown sender";
                if(body==null) body="";
                String status=type==1 ? "received" : type==2 ? "sent" : type==3 ? "draft" : type==5 ? "failed" : "pending";
                int slot=Math.max(0,Sims.slot(c,r.getInt(7)));
                JSONObject row=new JSONObject().put("id",id).put("type","sms").put("number",normalize(c,raw)).put("originalNumber",raw)
                    .put("timestamp",date).put("sentTimestamp",Math.max(0,r.getLong(3))).put("sim",slot)
                    .put("direction",type==1 ? "incoming" : "outgoing").put("status",status).put("text",body).put("read",r.getInt(6)!=0);
                if(!seen(c,row)) {upload(c,origin,token,row);count++;}
            }
        }return count;
    }
    private static int calls(Context c,String origin,String token) throws Exception {
        String[] projection={"_id","number","date","type","duration","subscription_id"};int count=0;
        // PHONE_ACCOUNT_ID is subscription_id on Android 8's call-log provider.
        projection[5]=CallLog.Calls.PHONE_ACCOUNT_ID;
        try(Cursor r=c.getContentResolver().query(CallLog.Calls.CONTENT_URI,projection,null,null,"date ASC, _id ASC")) {
            while(r!=null && r.moveToNext() && count<50) {
                long date=Math.max(0,r.getLong(2));String id="call-"+r.getLong(0)+"-"+date;
                int slot=0;String account=r.getString(5);
                for(SubscriptionInfo sim:Sims.active(c)) if(account!=null && (account.equals(Integer.toString(sim.getSubscriptionId())) || (sim.getIccId()!=null && !sim.getIccId().isEmpty() && account.equals(sim.getIccId())))) slot=sim.getSimSlotIndex()+1;
                int type=r.getInt(3);String direction=type==1 ? "incoming" : type==2 ? "outgoing" : type==3 ? "missed" : type==4 ? "voicemail" : type==5 ? "rejected" : type==6 ? "blocked" : "unknown";
                String raw=r.getString(1);if(raw==null || raw.isEmpty()) raw="Unknown caller";
                JSONObject row=new JSONObject().put("id",id).put("type","call").put("number",normalize(c,raw)).put("originalNumber",raw)
                    .put("timestamp",date).put("sentTimestamp",0).put("sim",slot).put("direction",direction).put("duration",Math.min(86400,Math.max(0,r.getLong(4))));
                if(!seen(c,row)) {upload(c,origin,token,row);count++;}
            }
        }return count;
    }
}

