package app.relay.companion;

final class SmsOutcome {
    // 0: no callback, 1: successful callback, -1: failed callback.
    static String status(int[] sent, int[] delivered) {
        if (sent.length == 0 || sent.length != delivered.length) return "";
        boolean allSent = true, allDelivered = true;
        for (int n=0; n<sent.length; n++) {
            if (sent[n] == -1) return "failed";
            allSent &= sent[n] == 1;
            allDelivered &= delivered[n] == 1;
        }
        if (allSent && allDelivered) return "delivered";
        return allSent ? "sent" : "";
    }
}
