package app.relay.companion;
import org.junit.Test;
import static org.junit.Assert.*;

public class CompanionTest {
    @Test public void requiresAllMultipartSendCallbacks() {
        assertEquals("", SmsOutcome.status(new int[]{1,0},new int[]{0,0}));
        assertEquals("sent", SmsOutcome.status(new int[]{1,1},new int[]{1,0}));
        assertEquals("delivered", SmsOutcome.status(new int[]{1,1},new int[]{1,1}));
    }
    @Test public void partialFailureNeverBecomesDelivered() {
        assertEquals("failed", SmsOutcome.status(new int[]{1,-1},new int[]{1,1}));
        assertEquals("", SmsOutcome.status(new int[]{0,0},new int[]{1,1}));
        assertEquals("", SmsOutcome.status(new int[]{},new int[]{}));
    }
    @Test public void failedDeliveryDoesNotUndoSuccessfulSend() {
        assertEquals("sent", SmsOutcome.status(new int[]{1,1},new int[]{1,-1}));
    }
    @Test public void acceptsHttpsAndUsbLoopback() throws Exception {
        assertEquals("https://relay.example",Api.origin("https://relay.example/"));
        assertEquals("http://127.0.0.1:49780",Api.origin("http://127.0.0.1:49780"));
    }
    @Test public void rejectsUntrustedOrigins() {
        for(String origin : new String[]{"http://relay.example", "http://127.0.0.1.evil.example", "https://user:pass@relay.example", "https://relay.example/api", "https://relay.example?token=x", "file:///tmp/relay"}) {
            try { Api.origin(origin); fail("Accepted unsafe origin"); } catch(Exception expected) { }
        }
    }
}
