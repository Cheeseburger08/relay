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
    private static final okhttp3.OkHttpClient client = new okhttp3.OkHttpClient.Builder()
        .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
        .writeTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
        .callTimeout(12, java.util.concurrent.TimeUnit.SECONDS)
        .retryOnConnectionFailure(false).followRedirects(false).followSslRedirects(false).build();
    static JSONObject post(String origin, String path, JSONObject body, String token) throws Exception {
        okhttp3.Request.Builder request = new okhttp3.Request.Builder().url(origin + "/api/device" + path)
            .post(okhttp3.RequestBody.create(okhttp3.MediaType.parse("application/json; charset=utf-8"),body.toString().getBytes("UTF-8")));
        if(token != null) request.header("Authorization", "Bearer " + token);
        try(okhttp3.Response response = client.newCall(request.build()).execute()) {
            if(!response.isSuccessful()) throw new Failure(response.code());
            if(response.body()==null) throw new IllegalStateException("Empty response");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try(InputStream in=response.body().byteStream()) {
                byte[] buf=new byte[4096];int n;
                while((n=in.read(buf))!=-1) { out.write(buf,0,n);if(out.size()>1048576)throw new IllegalStateException("Response too large"); }
            }
            return new JSONObject(out.toString("UTF-8"));
        }
    }
}
