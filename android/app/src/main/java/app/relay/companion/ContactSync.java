package app.relay.companion;

import android.Manifest;
import android.content.*;
import android.database.Cursor;
import android.provider.ContactsContract;
import android.provider.ContactsContract.CommonDataKinds.*;
import org.json.*;
import java.util.*;

/** Synchronizes phone-number entries; unrelated email/photo data is preserved. */
final class ContactSync {
    static volatile String status = "Contacts have not synchronized";
    static boolean allowed(Context c) {
        return Sims.permission(c,Manifest.permission.READ_CONTACTS) && Sims.permission(c,Manifest.permission.WRITE_CONTACTS);
    }
    static void sync(Context c,String origin,String token) throws Exception {
        if(!allowed(c)) { status="Contacts permission required"; return; }
        importExisting(c,origin,token);
        JSONObject state=Vault.read(c), saved=state.optJSONObject("contactSnapshot");
        String namespace=state.optString("contactNamespace");
        JSONArray changes=new JSONArray(), acknowledgments=new JSONArray();
        HashSet<String> deferred=new HashSet<>();
        if(saved!=null && !namespace.isEmpty()) {
            Iterator<String> ids=saved.keys();
            while(ids.hasNext()) {
                String id=ids.next(); JSONObject previous=saved.getJSONObject(id);
                JSONObject local=read(c,namespace,id);
                if(!previous.optBoolean("deleted")) {
                    if(local==null || !previous.getString("name").equals(local.optString("name")) || !previous.getString("number").equals(local.optString("number"))) {
                        if(changes.length()>=50 || (local!=null && (local.optString("name").trim().isEmpty() || local.optString("name").length()>80 || !local.optString("number").matches("\\+[1-9][0-9]{6,14}")))) { deferred.add(id); continue; }
                        changes.put(new JSONObject(previous.toString()).put("deleted",local==null)
                            .put("name",local==null ? previous.getString("name") : local.optString("name",previous.getString("name")))
                            .put("number",local==null ? previous.getString("number") : local.getString("number")));
                        continue;
                    }
                }
                if((previous.optBoolean("deleted") && local==null) || (!previous.optBoolean("deleted") && local!=null && previous.getString("name").equals(local.optString("name")) && previous.getString("number").equals(local.optString("number"))))
                    acknowledgments.put(new JSONObject().put("id",id).put("version",previous.getInt("version")));
            }
        }
        JSONObject response=Api.post(origin,"/contacts/sync",new JSONObject().put("changes",changes).put("acknowledgments",acknowledgments),token);
        String owner=response.getString("namespace"); JSONArray contacts=response.getJSONArray("contacts");
        HashSet<String> conflicts=new HashSet<>(); JSONArray rejected=response.getJSONArray("conflicts");
        for(int j=0;j<rejected.length();j++) conflicts.add(rejected.getString(j));
        JSONObject snapshot=new JSONObject();
        for(int n=0;n<contacts.length();n++) {
            JSONObject row=contacts.getJSONObject(n);
            if(deferred.contains(row.getString("id"))) { snapshot.put(row.getString("id"),saved.getJSONObject(row.getString("id"))); continue; }
            JSONObject before=saved==null ? null : saved.optJSONObject(row.getString("id"));
            if(before==null || before.optInt("version")!=row.getInt("version") || conflicts.contains(row.getString("id")) || (row.getBoolean("deleted") && read(c,owner,row.getString("id"))!=null)) apply(c,owner,row);
            snapshot.put(row.getString("id"),row);
        }
        Vault.update(c,s->{s.put("contactNamespace",owner);s.put("contactSnapshot",snapshot);});
        status=!deferred.isEmpty() ? "Some contact edits pending; use international numbers and nonempty names" : response.getJSONArray("conflicts").length()>0 ? "Contacts synced; panel versions resolved a conflict" : "Contacts synced with phone";
    }
    private static String number(Context c,String value) {
        if(value==null) return "";
        String region=c.getSystemService(android.telephony.TelephonyManager.class).getNetworkCountryIso();
        if(region==null || region.isEmpty()) region="IR";
        String e164=android.telephony.PhoneNumberUtils.formatNumberToE164(value,region.toUpperCase(java.util.Locale.ROOT));
        return e164==null ? value : e164;
    }
    private static JSONArray links(Context c,String namespace,String id) throws Exception {
        JSONObject all=Vault.read(c).optJSONObject("contactLinks:"+namespace);
        JSONArray result=all==null ? null : all.optJSONArray(id);
        return result==null ? new JSONArray() : result;
    }
    private static void importExisting(Context c,String origin,String token) throws Exception {
        JSONObject state=Vault.read(c); String namespace=state.optString("contactNamespace");
        if(namespace.isEmpty()) {
            JSONObject initial=Api.post(origin,"/contacts/import",new JSONObject().put("contacts",new JSONArray()),token);
            namespace=initial.getString("namespace"); final String owner=namespace;
            Vault.update(c,s->s.put("contactNamespace",owner));
        }
        JSONObject all=Vault.read(c).optJSONObject("contactLinks:"+namespace); HashSet<String> seen=new HashSet<>();
        if(all!=null) { Iterator<String> keys=all.keys(); while(keys.hasNext()) { JSONArray list=all.getJSONArray(keys.next()); for(int j=0;j<list.length();j++) seen.add(list.getJSONObject(j).getString("phone")); } }
        JSONArray candidates=new JSONArray(); JSONObject sources=new JSONObject();
        try(Cursor rows=c.getContentResolver().query(Phone.CONTENT_URI,new String[]{"_id","raw_contact_id",Phone.DISPLAY_NAME,Phone.NUMBER,"data_sync1"},null,null,"_id ASC")) {
            while(rows!=null && rows.moveToNext() && candidates.length()<50) {
                String source=rows.getString(0), marker=rows.getString(4);
                if(seen.contains(source) || (marker!=null && marker.startsWith("relay:"))) continue;
                String normalized=number(c,rows.getString(3)); if(!normalized.matches("\\+[1-9][0-9]{6,14}")) continue;
                String name=rows.getString(2); if(name==null || name.trim().isEmpty()) name=normalized;
                if(name.length()>80) continue;
                candidates.put(new JSONObject().put("source",source).put("name",name).put("number",normalized));
                sources.put(source,new JSONObject().put("phone",source).put("raw",rows.getLong(1)));
            }
        }
        if(candidates.length()==0) return;
        JSONObject response=Api.post(origin,"/contacts/import",new JSONObject().put("contacts",candidates),token);
        final String owner=namespace;
        Vault.update(c,s->{
            JSONObject map=Vault.object(s,"contactLinks:"+owner); JSONArray linked=response.getJSONArray("linked");
            for(int j=0;j<linked.length();j++) { JSONObject link=linked.getJSONObject(j); String id=link.getString("id");
                if(!map.has(id)) map.put(id,new JSONArray()); map.getJSONArray(id).put(sources.getJSONObject(link.getString("source")));
            }
        });
    }
    private static Long raw(Context c,String namespace,String id) {
        try(Cursor r=c.getContentResolver().query(ContactsContract.RawContacts.CONTENT_URI,new String[]{"_id"},
            "sync1=? AND deleted=0",new String[]{"relay:"+namespace+":"+id},null)) { return r!=null && r.moveToFirst() ? r.getLong(0) : null; }
    }
    static JSONObject read(Context c,String namespace,String id) throws Exception {
        JSONArray imported=links(c,namespace,id);
        for(int j=0;j<imported.length();j++) {
            String phone=imported.getJSONObject(j).getString("phone");
            try(Cursor r=c.getContentResolver().query(Phone.CONTENT_URI,new String[]{Phone.DISPLAY_NAME,Phone.NUMBER},"_id=?",new String[]{phone},null)) {
                if(r!=null && r.moveToFirst()) return new JSONObject().put("name",r.getString(0)).put("number",number(c,r.getString(1)));
            }
        }
        if(imported.length()>0) return null;
        Long raw=raw(c,namespace,id); if(raw==null) return null;
        JSONObject value=new JSONObject();
        try(Cursor r=c.getContentResolver().query(ContactsContract.Data.CONTENT_URI,new String[]{"mimetype","data1"},"raw_contact_id=? AND (mimetype=? OR data_sync1=?)",new String[]{raw.toString(),StructuredName.CONTENT_ITEM_TYPE,"relay:"+id},null)) {
            while(r!=null && r.moveToNext()) {
                if(StructuredName.CONTENT_ITEM_TYPE.equals(r.getString(0))) value.put("name",r.getString(1));
                if(Phone.CONTENT_ITEM_TYPE.equals(r.getString(0))) value.put("number",number(c,r.getString(1)));
            }
        }
        return value.has("number") ? value : null;
    }
    static void apply(Context c,String namespace,JSONObject row) throws Exception {
        String id=row.getString("id"); Long raw=raw(c,namespace,id);
        JSONArray imported=links(c,namespace,id);
        if(imported.length()>0) {
            int found=0;
            for(int j=0;j<imported.length();j++) {
                JSONObject link=imported.getJSONObject(j); String phone=link.getString("phone");
                if(row.getBoolean("deleted")) {
                    c.getContentResolver().delete(ContactsContract.Data.CONTENT_URI,"_id=? AND mimetype=?",new String[]{phone,Phone.CONTENT_ITEM_TYPE});
                    // Remove the contact itself when its last phone number was
                    // deleted. Preserve contacts that still hold other numbers.
                    try(Cursor remaining=c.getContentResolver().query(Phone.CONTENT_URI,new String[]{"_id"},"raw_contact_id=?",new String[]{link.getString("raw")},null)){
                        if(remaining!=null&&remaining.getCount()==0)c.getContentResolver().delete(ContentUris.withAppendedId(ContactsContract.RawContacts.CONTENT_URI,Long.parseLong(link.getString("raw"))),null,null);
                    }
                } else {
                    ContentValues value=new ContentValues(); value.put(Phone.NUMBER,row.getString("number"));
                    int updated=c.getContentResolver().update(ContactsContract.Data.CONTENT_URI,value,"_id=? AND mimetype=?",new String[]{phone,Phone.CONTENT_ITEM_TYPE});
                    if(updated==0) continue;
                    found++;
                    value.clear(); value.put(StructuredName.DISPLAY_NAME,row.getString("name"));
                    // Structured name only; never remove other numbers, photos, or emails.
                    c.getContentResolver().update(ContactsContract.Data.CONTENT_URI,value,"raw_contact_id=? AND mimetype=?",new String[]{link.getString("raw"),StructuredName.CONTENT_ITEM_TYPE});
                }
            }
            if(raw==null && (row.getBoolean("deleted") || found>0)) return;
            if(found==0 && !row.getBoolean("deleted")) Vault.update(c,s->Vault.object(s,"contactLinks:"+namespace).remove(id));
        }
        if(row.getBoolean("deleted")) {
            if(raw!=null) {
                int count=0;
                try(Cursor r=c.getContentResolver().query(ContactsContract.Data.CONTENT_URI,new String[]{"_id"},"raw_contact_id=?",new String[]{raw.toString()},null)) { if(r!=null) count=r.getCount(); }
                if(count<=2) c.getContentResolver().delete(ContentUris.withAppendedId(ContactsContract.RawContacts.CONTENT_URI,raw),null,null);
                else c.getContentResolver().delete(ContactsContract.Data.CONTENT_URI,"raw_contact_id=? AND data_sync1=?",new String[]{raw.toString(),"relay:"+id});
            }
            return;
        }
        JSONObject local=read(c,namespace,id);
        if(local!=null && row.getString("name").equals(local.optString("name")) && row.getString("number").equals(local.optString("number"))) return;
        ArrayList<ContentProviderOperation> ops=new ArrayList<>();
        if(raw==null) ops.add(ContentProviderOperation.newInsert(ContactsContract.RawContacts.CONTENT_URI)
            .withValue("account_type",null).withValue("account_name",null).withValue("sync1","relay:"+namespace+":"+id).build());
        else ops.add(ContentProviderOperation.newDelete(ContactsContract.Data.CONTENT_URI)
            .withSelection("raw_contact_id=? AND (mimetype=? OR data_sync1=?)",new String[]{raw.toString(),StructuredName.CONTENT_ITEM_TYPE,"relay:"+id}).build());
        for(String mime:new String[]{StructuredName.CONTENT_ITEM_TYPE,Phone.CONTENT_ITEM_TYPE}) {
            ContentProviderOperation.Builder op=ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
                .withValue("mimetype",mime).withValue("data1",row.getString(mime.equals(StructuredName.CONTENT_ITEM_TYPE)?"name":"number"));
            if(raw==null) op.withValueBackReference("raw_contact_id",0); else op.withValue("raw_contact_id",raw);
            if(mime.equals(Phone.CONTENT_ITEM_TYPE)) op.withValue("data_sync1","relay:"+id);
            ops.add(op.build());
        }
        c.getContentResolver().applyBatch(ContactsContract.AUTHORITY,ops);
    }
}
