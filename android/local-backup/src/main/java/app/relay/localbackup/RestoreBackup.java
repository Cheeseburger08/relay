package app.relay.localbackup;

import android.app.Instrumentation;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import org.json.*;
import java.io.*;
import java.util.*;

/** Explicit local merge only. No network, SMS sending or call placement. */
public class RestoreBackup extends Instrumentation {
    private boolean apply;
    @Override public void onCreate(Bundle args){super.onCreate(args);apply="true".equals(args.getString("apply"));start();}
    @Override public void onStart(){
        Bundle result=new Bundle();
        try{
            Context c=getTargetContext();
            merge(c,"sms",Uri.parse("content://sms"),new String[]{"address","date","type","body"},
                "address,date,date_sent,protocol,read,status,type,reply_path_present,subject,body,service_center,locked,sub_id,error_code,seen,priority,semc_message_priority,delivery_status,star_status,sequence_time,server_time,somc_scts",result);
            merge(c,"calls",Uri.parse("content://call_log/calls"),new String[]{"number","date","type","duration"},
                "number,date,duration,type,new,is_read,presentation,features,subscription_component_name,subscription_id,phone_account_address,post_dial_digits,via_number",result);
            result.putBoolean("success",true);finish(0,result);
        }catch(Exception e){result.putBoolean("success",false);result.putString("failureClass",e.getClass().getSimpleName());finish(1,result);}
    }
    private void merge(Context c,String name,Uri uri,String[] identity,String fields,Bundle result)throws Exception{
        File f=new File(c.getFilesDir(),"restore-"+name+".json");
        if(f.length()>20000000)throw new IOException("Backup too large");
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();
        try(InputStream in=new FileInputStream(f)){byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1)bytes.write(buffer,0,n);}
        JSONObject backup=new JSONObject(bytes.toString("UTF-8"));
        if(!"relay-provider-rows-v1".equals(backup.getString("format"))||!uri.toString().equals(backup.getString("provider")))throw new IOException("Wrong format");
        JSONArray rows=backup.getJSONArray("rows");
        // Validate all rows before any writes; do not recreate queued outgoing SMS.
        for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);for(String key:identity)if(!row.has(key))throw new IOException("Missing field");if(name.equals("sms")&&row.getInt("type")!=1&&row.getInt("type")!=2)throw new IOException("Unsafe SMS type");}
        Map<String,Integer> available=new HashMap<>();int before=0,matched=0,inserted=0,missing=0;
        try(Cursor cursor=c.getContentResolver().query(uri,identity,null,null,null)){
            if(cursor==null)throw new IOException("No cursor");
            while(cursor.moveToNext()){JSONArray key=new JSONArray();for(int k=0;k<identity.length;k++)key.put(cursor.isNull(k)?JSONObject.NULL:cursor.getString(k));String s=key.toString();available.put(s,available.getOrDefault(s,0)+1);before++;}
        }
        for(int i=0;i<rows.length();i++){
            JSONObject row=rows.getJSONObject(i);JSONArray key=new JSONArray();for(String k:identity)key.put(row.isNull(k)?JSONObject.NULL:String.valueOf(row.get(k)));
            String s=key.toString();int count=available.getOrDefault(s,0);
            if(count>0){available.put(s,count-1);matched++;continue;}
            missing++;
            if(!apply)continue;
            ContentValues values=new ContentValues();
            for(String field:fields.split(",")){if(!row.has(field))continue;Object v=row.get(field);if(v==JSONObject.NULL)values.putNull(field);else if(v instanceof Number)values.put(field,((Number)v).longValue());else values.put(field,v.toString());}
            Uri added=c.getContentResolver().insert(uri,values);if(added==null)throw new IOException("Insert failed");inserted++;
        }
        result.putInt(name+"Before",before);result.putInt(name+"Matched",matched);result.putInt(name+"Missing",missing);result.putInt(name+"Inserted",inserted);
    }
}
