package app.relay.localbackup;

import android.app.Instrumentation;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.util.JsonWriter;
import org.json.*;
import java.io.*;
import java.security.MessageDigest;

/** Explicit ADB-invoked export. No provider writes, network or personal data in results. */
public class ExportBackup extends Instrumentation {
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    @Override public void onStart(){
        Bundle result=new Bundle();
        try {
            Context c=getTargetContext();
            File manifestFile=new File(c.getFilesDir(),"manifest.json");
            if(manifestFile.exists()&&!manifestFile.delete())throw new IOException("Stale manifest");
            JSONObject manifest=new JSONObject().put("format","relay-local-provider-backup-v1").put("createdAt",System.currentTimeMillis())
                .put("model",android.os.Build.MODEL).put("android",android.os.Build.VERSION.RELEASE).put("build",android.os.Build.DISPLAY);
            manifest.put("sms",export(c,"sms","content://sms"));
            manifest.put("calls",export(c,"calls","content://call_log/calls"));
            try(FileOutputStream out=new FileOutputStream(manifestFile)){out.write(manifest.toString(2).getBytes("UTF-8"));out.getFD().sync();}
            result.putBoolean("success",true);result.putInt("smsCount",manifest.getJSONObject("sms").getInt("count"));
            result.putInt("callCount",manifest.getJSONObject("calls").getInt("count"));finish(0,result);
        }catch(Exception e){
            // Provider exceptions may contain addresses or query details; emit only the class.
            result.putBoolean("success",false);result.putString("failureClass",e.getClass().getSimpleName());finish(1,result);
        }
    }
    private JSONObject export(Context c,String name,String uri) throws Exception {
        File file=new File(c.getFilesDir(),name+".json");int count=0;JSONArray columns=new JSONArray();
        try(Cursor rows=c.getContentResolver().query(Uri.parse(uri),null,null,null,"_id ASC")){
            if(rows==null)throw new IOException("Provider returned no cursor");
            for(String column:rows.getColumnNames())columns.put(column);
            try(FileOutputStream out=new FileOutputStream(file);JsonWriter writer=new JsonWriter(new OutputStreamWriter(out,"UTF-8"))){
                writer.beginObject().name("format").value("relay-provider-rows-v1").name("provider").value(uri)
                    .name("columns").beginArray();
                for(String column:rows.getColumnNames())writer.value(column);
                writer.endArray().name("rows").beginArray();
                while(rows.moveToNext()){
                    writer.beginObject();
                    for(int n=0;n<rows.getColumnCount();n++){
                        writer.name(rows.getColumnName(n));
                        switch(rows.getType(n)){
                            case Cursor.FIELD_TYPE_NULL:writer.nullValue();break;
                            case Cursor.FIELD_TYPE_INTEGER:writer.value(rows.getLong(n));break;
                            case Cursor.FIELD_TYPE_FLOAT:writer.value(rows.getDouble(n));break;
                            case Cursor.FIELD_TYPE_BLOB:writer.beginObject().name("$base64").value(Base64.encodeToString(rows.getBlob(n),Base64.NO_WRAP)).endObject();break;
                            default:writer.value(rows.getString(n));
                        }
                    }
                    writer.endObject();count++;
                }
                writer.endArray().endObject();writer.flush();out.getFD().sync();
            }
            if(count!=rows.getCount())throw new IOException("Cursor count mismatch");
        }
        // A fresh ID-only query catches inserts/deletions during export without logging IDs.
        MessageDigest ids=MessageDigest.getInstance("SHA-256");int after=0;
        try(Cursor rows=c.getContentResolver().query(Uri.parse(uri),new String[]{"_id"},null,null,"_id ASC")){
            if(rows==null)throw new IOException("Verification cursor missing");
            while(rows.moveToNext()){ids.update((rows.getString(0)+"\n").getBytes("UTF-8"));after++;}
        }
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        try(InputStream in=new FileInputStream(file)){byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1)digest.update(buffer,0,n);}
        return new JSONObject().put("file",file.getName()).put("count",count).put("sourceCountAfter",after)
            .put("sourceIdsSha256",hex(ids.digest())).put("sha256",hex(digest.digest())).put("bytes",file.length()).put("columns",columns);
    }
    private String hex(byte[] data){StringBuilder b=new StringBuilder();for(byte x:data)b.append(String.format(java.util.Locale.ROOT,"%02x",x&255));return b.toString();}
}
