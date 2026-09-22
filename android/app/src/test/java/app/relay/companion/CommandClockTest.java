package app.relay.companion;
import org.junit.Test;
import static org.junit.Assert.*;

public class CommandClockTest {
    @Test public void freshnessUsesServerAndMonotonicTimeOnly(){
        CommandClock c=new CommandClock();
        // The handset's wall clock may be sixteen seconds or years ahead.
        c.sync(1790051930000L,5000);
        assertTrue(c.accepts(1790051931000L,1790051941000L,6100));
        assertFalse(c.accepts(1790051931000L,1790051941000L,16000));
    }
    @Test public void reconnectRequiresFreshClockAndRejectsInvalidWindows(){
        CommandClock c=new CommandClock();
        assertFalse(c.accepts(100000,110000,50));
        c.sync(100000,50);
        assertFalse(c.accepts(100000,120000,60));
        assertFalse(c.accepts(110000,120000,60));
        assertFalse(c.accepts(160000,170000,61051));
        c.sync(160000,61051);
        assertTrue(c.accepts(160000,170000,61100));
    }
}
