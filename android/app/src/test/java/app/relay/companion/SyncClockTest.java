package app.relay.companion;
import org.junit.Test;
import static org.junit.Assert.*;

public class SyncClockTest {
    @Test public void deadlinesAndExpiryUseElapsedAndServerTime() {
        SyncClock c = new SyncClock();
        assertTrue(c.heartbeatDue(500));
        assertFalse(c.validSms(1000000,500));
        c.heartbeat(1000000,500);
        assertFalse(c.heartbeatDue(20499));
        assertTrue(c.heartbeatDue(20500));
        c.retry(500,60000);
        assertFalse(c.ready(60499));
        assertTrue(c.ready(60500));
        assertTrue(c.validSms(1010000,10499));
        assertFalse(c.validSms(1010000,10500));
        assertFalse(c.validSms(9000000,60501));
        assertFalse(c.validSms(9000000,499));
        // No handset wall-clock input can lengthen a retry or revive an expired SMS.
    }
}
