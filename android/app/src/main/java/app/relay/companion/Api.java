package app.relay.companion;

import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

final class Api {
    static final class Failure extends Exception {
        final int status;
        Failure(int status) { super("Server returned HTTP " + status); this.status = status; }
    }
    static String origin(String input) throws Exception {
        URI u = new URI(input.trim());
        boolean local = "127.0.0.1".equals(u.getHost()) || "localhost".equals(u.getHost());
        if (u.getHost() == null || u.getUserInfo() != null || u.getQuery() != null || u.getFragment() != null
            || !(u.getPath().isEmpty() || "/".equals(u.getPath()))
            || !("https".equals(u.getScheme()) || (local && "http".equals(u.getScheme()))))
            throw new IllegalArgumentException("Use an HTTPS server origin, or loopback for USB testing.");
        return u.getScheme() + "://" + u.getRawAuthority();
    }
    static JSONObject post(String origin, String path, JSONObject body, String token) throws Exception {
        HttpURLConnection conn = (HttpURLConnection)new URL(origin + "/api/device" + path).openConnection();
        try {
            conn.setConnectTimeout(10000); conn.setReadTimeout(10000); conn.setInstanceFollowRedirects(false);
            conn.setRequestMethod("POST"); conn.setDoOutput(true); conn.setRequestProperty("Content-Type", "application/json");
            if (token != null) conn.setRequestProperty("Authorization", "Bearer " + token);
            byte[] bytes = body.toString().getBytes("UTF-8"); conn.setFixedLengthStreamingMode(bytes.length);
            try (java.io.OutputStream out = conn.getOutputStream()) { out.write(bytes); }
            int status = conn.getResponseCode(); if (status < 200 || status >= 300) throw new Failure(status);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (InputStream in = conn.getInputStream()) {
                byte[] buf = new byte[4096]; int n;
                while ((n = in.read(buf)) != -1) { out.write(buf, 0, n); if (out.size() > 1048576) throw new IllegalStateException("Response too large"); }
            }
            return new JSONObject(out.toString("UTF-8"));
        } finally { conn.disconnect(); }
    }
}
