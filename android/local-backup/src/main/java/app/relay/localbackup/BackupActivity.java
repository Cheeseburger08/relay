package app.relay.localbackup;
import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;

public class BackupActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        TextView text=new TextView(this);text.setPadding(32,48,32,32);text.setTextSize(20);
        text.setText("Relay Local Backup\n\nThis temporary utility exports or restores SMS and call history only when invoked over the authorized USB/ADB connection.\n\nRestore merges missing records and preserves existing history. It cannot send messages, place calls or access the Internet.\n\nBackup files stay in private storage until transferred to your laptop. Remove this helper after verification.");
        setContentView(text);
    }
}
