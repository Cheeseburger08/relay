package app.relay.companion;
import org.junit.Test;
import static org.junit.Assert.*;
public class RecoveryWindowTest {
    @Test public void repeatedFailuresCannotExtendDeadline(){
        RecoveryWindow w=new RecoveryWindow();w.start("call-one",1000,60000);
        w.start("call-one",10000,60000);assertEquals(61000,w.deadline);
        w.start("call-one",11000,20000);assertEquals(31000,w.deadline);
    }
    @Test public void newCallAndRestoredMediaGetFreshWindow(){
        RecoveryWindow w=new RecoveryWindow();w.start("call-one",1000,90000);assertEquals(61000,w.deadline);
        w.start("call-two",2000,60000);assertEquals(62000,w.deadline);
        w.clear();w.start("call-two",5000,60000);assertEquals(65000,w.deadline);
    }
}
