package app.relay.companion;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** One encrypted, synchronously committed journal; no message bodies in logs. */
final class Vault {
    private static final String KEY = "relay-local-journal-v1";
    interface Update { void apply(JSONObject state) throws Exception; }
    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        if (!ks.containsAlias(KEY)) {
            KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            gen.init(new KeyGenParameterSpec.Builder(KEY, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            gen.generateKey();
        }
        return (SecretKey)ks.getKey(KEY, null);
    }
    static synchronized JSONObject read(Context c) throws Exception {
        String encoded = c.getSharedPreferences("vault", 0).getString("journal", null);
        if (encoded == null) return new JSONObject();
        JSONObject envelope = new JSONObject(encoded);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)));
        return new JSONObject(new String(cipher.doFinal(Base64.decode(envelope.getString("data"), Base64.NO_WRAP)), "UTF-8"));
    }
    static synchronized void update(Context c, Update change) throws Exception {
        JSONObject state = read(c); change.apply(state);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        JSONObject envelope = new JSONObject().put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
            .put("data", Base64.encodeToString(cipher.doFinal(state.toString().getBytes("UTF-8")), Base64.NO_WRAP));
        if (!c.getSharedPreferences("vault", 0).edit().putString("journal", envelope.toString()).commit())
            throw new IllegalStateException("Could not persist journal");
    }
    static JSONObject object(JSONObject state, String name) throws Exception {
        if (!state.has(name)) state.put(name, new JSONObject());
        return state.getJSONObject(name);
    }
}
