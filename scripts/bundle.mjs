import archiver from "archiver";
import { mkdirSync, createWriteStream, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
mkdirSync("artifacts", { recursive: true });
const target = "artifacts/relay-handoff.zip",
  output = createWriteStream(target),
  zip = archiver("zip", { zlib: { level: 9 } });
const done = new Promise((resolve, reject) => {
  output.on("close", resolve);
  output.on("error", reject);
  zip.on("error", reject);
});
zip.pipe(output);
for (const file of [
  "README.md",
  "LICENSE",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "AGENTS.md",
  "package.json",
  "package-lock.json",
  "vite.config.js",
  "index.html",
  ".gitignore",
  ".env.example",
])
  zip.file(file, { name: "relay/" + file });
function add(dir) {
  for (const name of readdirSync(dir)) {
    if (["build", ".gradle", "local.properties", "relay-uplink-arm64", "relay-uplink-arm64.sha256"].includes(name) || /\.(jks|keystore|apk)$/.test(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) add(path);
    else zip.file(path, { name: "relay/" + path.replaceAll("\\", "/") });
  }
}
for (const dir of ["src", "server", "public", "scripts", "tests", "docs", "android"])
  add(dir);
await zip.finalize();
await done;
console.log(
  `Created ${target} (${zip.pointer()} bytes), source and documentation only.`,
);
