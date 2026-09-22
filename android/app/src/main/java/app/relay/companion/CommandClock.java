package app.relay.companion;

/** Authenticated server time anchored to monotonic time, never the handset clock. */
final class CommandClock {
    private long serverAt, receivedAt = -1;
    void sync(long serverMillis, long elapsedMillis) { serverAt=serverMillis; receivedAt=elapsedMillis; }
    boolean accepts(long issued, long expires, long elapsedMillis) {
        if(receivedAt<0 || elapsedMillis<receivedAt || elapsedMillis-receivedAt>60000) return false;
        long now=serverAt+(elapsedMillis-receivedAt);
        return issued>0 && expires>issued && expires-issued<=10000 && issued<=now+1000 && now<expires;
    }
}
