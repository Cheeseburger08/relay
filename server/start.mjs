import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { createServer as httpsServer } from "node:https";
import { createServer as httpServer } from "node:http";
import express from "express";
import { createStore } from "./store.mjs";
import { createApp } from "./app.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(resolve(root, ".env")))
  process.loadEnvFile(resolve(root, ".env"));
const port = Number(process.env.PORT || 49760),
  host = process.env.HOST || "127.0.0.1";
const dev = process.argv.includes("--dev"),
  secure = process.env.REQUIRE_HTTPS === "1";
const origin = process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`;
if (dev && !["127.0.0.1", "::1", "localhost"].includes(host))
  throw new Error("Development mode must remain loopback-only.");
if (
  !["127.0.0.1", "::1", "localhost"].includes(host) &&
  (!secure || !origin.startsWith("https://"))
)
  throw new Error("External binding requires explicit HTTPS configuration.");
process.umask(0o077);
const store = createStore(process.env.DATA_DIR || resolve(root, ".data"));
const app = createApp(store, {
  origin,
  secure,
  dev,
  behindProxy: process.env.BEHIND_PROXY === "1",
});
let vite;
if (dev) {
  const { createServer } = await import("vite");
  vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.get('/voice.html', (_req,res)=>res.redirect(302,'/?view=calls'));
  app.use(express.static(resolve(root, "dist"), { index: false }));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(resolve(root, "dist/index.html")),
  );
}
if (secure && process.env.BEHIND_PROXY !== '1' && !(process.env.TLS_KEY && process.env.TLS_CERT))
  throw new Error('HTTPS requires a certificate and key or an explicit trusted proxy.');
const server = process.env.TLS_KEY && process.env.TLS_CERT
  ? httpsServer({key:readFileSync(process.env.TLS_KEY),cert:readFileSync(process.env.TLS_CERT),minVersion:'TLSv1.2'},app)
  : httpServer(app);
server.listen(port, host, () =>
  console.log(
    `Relay listening on ${process.env.TLS_KEY?'https':'http'}://${host}:${port} (${dev ? "development" : "built assets"})`,
  ),
);
server.on("error", (e) => {
  console.error("Listener failed:", e.code);
  process.exit(1);
});
app.locals.voice.attach(server);
const maintenance = setInterval(() => store.expire(), 30000);
maintenance.unref();
async function stop() {
  app.locals.voice.close();
  clearInterval(maintenance);
  await vite?.close();
  server.close(() => {
    store.db.close();
    process.exit(0);
  });
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
