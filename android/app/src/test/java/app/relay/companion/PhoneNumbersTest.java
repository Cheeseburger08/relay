package app.relay.companion;
import org.junit.Test;
import static org.junit.Assert.*;
public class PhoneNumbersTest {
 @Test public void acceptsLocalShortAndInternationalNumbers() {
  for(String number:new String[]{"02025550101","12345","+12025550101","020 2555-0101"})assertTrue(PhoneNumbers.valid(number));
 }
 @Test public void rejectsEmptyAndMalformedNumbers() {
  for(String number:new String[]{"","+","abc","12\n34","tel:123"})assertFalse(PhoneNumbers.valid(number));
  assertFalse(PhoneNumbers.valid(null));
 }
}
