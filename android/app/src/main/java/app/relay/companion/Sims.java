package app.relay.companion;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import java.util.Collections;
import java.util.List;

final class Sims {
    static boolean permission(Context c, String name) { return c.checkSelfPermission(name) == PackageManager.PERMISSION_GRANTED; }
    static List<SubscriptionInfo> active(Context c) {
        if (c.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) return Collections.emptyList();
        try {
            List<SubscriptionInfo> rows = c.getSystemService(SubscriptionManager.class).getActiveSubscriptionInfoList();
            return rows == null ? Collections.emptyList() : rows;
        } catch (SecurityException revoked) { return Collections.emptyList(); }
    }
    static int subscription(Context c, int slot) {
        for (SubscriptionInfo row : active(c)) if (row.getSimSlotIndex() + 1 == slot) return row.getSubscriptionId();
        return -1;
    }
    static int slot(Context c, int subscription) {
        for (SubscriptionInfo row : active(c)) if (row.getSubscriptionId() == subscription) return row.getSimSlotIndex() + 1;
        return -1;
    }
    static boolean smsReady(Context c) {
        return permission(c, Manifest.permission.READ_PHONE_STATE) && permission(c, Manifest.permission.SEND_SMS)
            && permission(c, Manifest.permission.RECEIVE_SMS) && !active(c).isEmpty();
    }
}
