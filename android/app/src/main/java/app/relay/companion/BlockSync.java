package app.relay.companion;
import android.content.*;
import android.database.Cursor;
import android.provider.BlockedNumberContract;
import android.provider.BlockedNumberContract.BlockedNumbers;
import org.json.*;
import java.util.*;
final class BlockSync {
    static volatile String status="Blocked numbers not synchronized";
    static Set<String> current(Context c){
        if(!BlockedNumberContract.canCurrentUserBlockNumbers(c))throw new SecurityException();
        Set<String> numbers=new HashSet<>();
        try(Cursor r=c.getContentResolver().query(BlockedNumbers.CONTENT_URI,new String[]{BlockedNumbers.COLUMN_ORIGINAL_NUMBER,BlockedNumbers.COLUMN_E164_NUMBER},null,null,null)){
            if(r==null)throw new IllegalStateException();while(r.moveToNext()){String n=r.getString(1);if(n==null||n.isEmpty())n=HistorySync.normalize(c,r.getString(0));numbers.add(n);}
        }return numbers;
    }
    static void set(Context c,String number,boolean blocked){
        if(blocked){ContentValues v=new ContentValues();v.put(BlockedNumbers.COLUMN_ORIGINAL_NUMBER,number);c.getContentResolver().insert(BlockedNumbers.CONTENT_URI,v);}
        else BlockedNumberContract.unblock(c,number);
        if(BlockedNumberContract.isBlocked(c,number)!=blocked)throw new SecurityException();
    }
    static void sync(Context c,String origin,String token) throws Exception {
        Set<String> local=current(c);JSONObject saved=Vault.read(c).optJSONObject("blockSnapshot");
        JSONArray imported=new JSONArray(),changes=new JSONArray(),acks=new JSONArray();Set<String> known=new HashSet<>(),deferred=new HashSet<>();
        if(saved!=null){Iterator<String> ids=saved.keys();while(ids.hasNext()){
            JSONObject old=saved.getJSONObject(ids.next());String number=old.getString("number");known.add(number);boolean blocked=local.contains(number);
            if(blocked!=old.getBoolean("blocked")){if(changes.length()>=100)deferred.add(old.getString("id"));else changes.put(new JSONObject().put("id",old.getString("id")).put("version",old.getInt("version")).put("blocked",blocked));}
            else if(acks.length()<2000)acks.put(new JSONObject().put("id",old.getString("id")).put("version",old.getInt("version")));
        }}
        for(String n:local)if(!known.contains(n)&&imported.length()<100)imported.put(n);
        JSONObject response=Api.post(origin,"/blocks/sync",new JSONObject().put("imported",imported).put("changes",changes).put("acknowledgments",acks),token);
        JSONArray rows=response.getJSONArray("blocks");JSONObject next=new JSONObject();
        for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);String id=row.getString("id");if(deferred.contains(id)){next.put(id,saved.getJSONObject(id));continue;}String n=row.getString("number");if(local.contains(n)!=row.getBoolean("blocked"))set(c,n,row.getBoolean("blocked"));next.put(id,row);}
        Vault.update(c,s->s.put("blockSnapshot",next));status="Blocked calls and messages synced";
    }
}
