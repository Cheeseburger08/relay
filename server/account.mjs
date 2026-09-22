import { existsSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./store.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(resolve(root, ".env")))
  process.loadEnvFile(resolve(root, ".env"));
const args = process.argv.slice(2),
  username = args[args.indexOf("--username") + 1];
if (
  !args.includes("--username") ||
  !/^[a-zA-Z0-9_.-]{3,40}$/.test(username || "")
)
  throw new Error("Usage: npm run account -- --username yourname");
let password = process.env.RELAY_ADMIN_PASSWORD;
if (!password) {
  if (!stdin.isTTY)
    throw new Error("Interactive terminal or RELAY_ADMIN_PASSWORD required.");
  stdout.write("New password (minimum 12 characters, input hidden): ");
  stdin.setRawMode(true);
  stdin.resume();
  password = "";
  await new Promise((resolve) => {
    const handler = (chunk) => {
      for (const c of chunk.toString()) {
        if (c === "\u0003") {
          process.exit(1);
        }
        if (c === "\r" || c === "\n") {
          stdin.off("data", handler);
          stdin.setRawMode(false);
          stdin.pause();
          stdout.write("\n");
          resolve();
          return;
        }
        if (c === "\u007f" || c === "\b") password = password.slice(0, -1);
        else if (c >= " ") password += c;
      }
    };
    stdin.on("data", handler);
  });
}
if (password.length < 12 || password.length > 256)
  throw new Error("Password must be 12-256 characters.");
process.umask(0o077);
const store = createStore(process.env.DATA_DIR || resolve(root, ".data"));
try {
  store.createUser(username, username, password);
  console.log("Private account created. No default password was stored.");
} finally {
  store.db.close();
}
