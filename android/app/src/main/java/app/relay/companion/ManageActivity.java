package app.relay.companion;
import android.app.*;
import android.content.*;
import android.database.Cursor;
import android.os.Bundle;
import android.provider.*;
import android.widget.*;
import android.net.Uri;
public class ManageActivity extends Activity {
    private LinearLayout box;private String page="Messages";
    private void button(String label,Runnable action){Button b=new Button(this);b.setText(label);b.setOnClickListener(v->action.run());box.addView(b);}
    @Override public void onCreate(Bundle b){super.onCreate(b);render();}
    private void change(Runnable action){try{action.run();startForegroundService(new Intent(this,RelayService.class));render();}catch(Exception e){new AlertDialog.Builder(this).setMessage("Could not apply change. Check Relay permissions and default phone app.").setPositiveButton("OK",null).show();}}
    private void confirm(String label,Runnable action){new AlertDialog.Builder(this).setTitle(label).setMessage("This change also synchronizes with the website.").setPositiveButton("Delete",(d,w)->change(action)).setNegativeButton("Cancel",null).show();}
    private void render(){
        ScrollView scroll=new ScrollView(this);box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(20,20,20,20);scroll.addView(box);setContentView(scroll);
        TextView title=new TextView(this);title.setText(page+" · phone and website sync");title.setTextSize(22);box.addView(title);
        for(String tab:new String[]{"Messages","Calls","Blocked"})button(tab,()->{page=tab;render();});
        button("Phone contacts",()->startActivity(new Intent(Intent.ACTION_VIEW,ContactsContract.Contacts.CONTENT_URI)));
        try{
            if(page.equals("Blocked")){
                button("Block a number",()->{EditText number=new EditText(this);number.setHint("Number or sender");new AlertDialog.Builder(this).setTitle("Block calls and messages").setView(number).setPositiveButton("Block",(d,w)->{String n=number.getText().toString().trim();if(!n.isEmpty())change(()->BlockSync.set(this,HistorySync.normalize(this,n),true));}).setNegativeButton("Cancel",null).show();});
                for(String n:BlockSync.current(this))button(n+" · Unblock",()->change(()->BlockSync.set(this,n,false)));return;
            }
            boolean sms=page.equals("Messages");Uri uri=sms?Telephony.Sms.CONTENT_URI:CallLog.Calls.CONTENT_URI;
            button("Delete all "+page.toLowerCase(),()->confirm("Delete all "+page.toLowerCase()+"?",()->getContentResolver().delete(uri,sms?"type NOT IN (4,6)":null,null)));
            String[] columns=sms?new String[]{"_id","address","body","type"}:new String[]{"_id","number","date","type"};
            try(Cursor rows=getContentResolver().query(uri,columns,null,null,"date DESC")){
                int count=0;while(rows!=null&&rows.moveToNext()&&count++<200){long id=rows.getLong(0);String number=rows.getString(1);if(number==null)number="Unknown";final String n=number;
                    boolean sending=sms&&(rows.getInt(3)==4||rows.getInt(3)==6);String detail=sms?rows.getString(2):android.text.format.DateFormat.format("yyyy-MM-dd HH:mm",rows.getLong(2)).toString();
                    button(n+"\n"+(detail==null?"":detail),()->new AlertDialog.Builder(this).setTitle(n).setItems(sending?new String[]{"Block calls and messages"}:new String[]{"Block calls and messages","Delete"},(d,which)->{
                        if(which==0)change(()->BlockSync.set(this,HistorySync.normalize(this,n),true));else confirm("Delete this "+(sms?"message":"call entry")+"?",()->getContentResolver().delete(uri,"_id=?"+(sms?" AND type NOT IN (4,6)":""),new String[]{Long.toString(id)}));
                    }).show());
                }
            }
        }catch(Exception e){TextView error=new TextView(this);error.setText("Permission needed. Grant phone permissions and set Relay as the default phone app.");box.addView(error);}
    }
}
