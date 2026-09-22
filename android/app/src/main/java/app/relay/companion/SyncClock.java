package app.relay.companion;

/** All local deadlines use elapsed time; SMS expiry uses authenticated server time. */
final class SyncClock {
    private long heartbeatAt = -1, retryAt, serverAt, serverReceivedAt = -1;
    boolean ready(long elapsed) { return elapsed >= retryAt; }
    boolean heartbeatDue(long elapsed) { return heartbeatAt < 0 || elapsed - heartbeatAt >= 20000; }
    void heartbeat(long serverTime, long elapsed) {
        heartbeatAt = elapsed; serverAt = serverTime; serverReceivedAt = elapsed;
    }
    void retry(long elapsed, long delay) { retryAt = elapsed + delay; }
    boolean validSms(long expires, long elapsed) {
        return serverReceivedAt >= 0 && elapsed >= serverReceivedAt
            && elapsed - serverReceivedAt <= 60000
            && serverAt + (elapsed - serverReceivedAt) < expires;
    }
}
