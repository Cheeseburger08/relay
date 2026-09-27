package app.relay.companion;

/** Validate number syntax without requiring a country code. */
final class PhoneNumbers {
    static boolean valid(String value) {
        return value != null && value.length() <= 40 && value.matches("\\+?[0-9][0-9 ()-]*");
    }
}
