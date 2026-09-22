import { DatabaseSync } from "node:sqlite";
import { managementSchema } from './management.mjs';
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
  createHmac,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";

export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");
export function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function passwordMatches(password, encoded) {
  const [salt, key] = encoded.split(":");
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(key, "hex"),
  );
}
export function createStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keyPath = join(directory, "encryption.key");
  if (existsSync(join(directory, "relay.sqlite")) && !existsSync(keyPath))
    throw new Error(
      "Database exists but encryption key is missing. Restore its original key; do not generate a replacement.",
    );
  if (!existsSync(keyPath))
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: "wx" });
  const key = readFileSync(keyPath);
  if (key.length !== 32) throw new Error("Invalid encryption key");
  const file = join(directory, "relay.sqlite");
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,user_id TEXT UNIQUE NOT NULL REFERENCES users(id),token TEXT UNIQUE NOT NULL,data TEXT NOT NULL,last_seen INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS pairings(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),number_key TEXT NOT NULL,sim INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(user_id,number_key,sim));
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),conversation_id TEXT NOT NULL REFERENCES conversations(id),data TEXT NOT NULL,created INTEGER NOT NULL,unread INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),data TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS contacts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),number_key TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(user_id,number_key));
    CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),device_id TEXT NOT NULL REFERENCES devices(id),message_id TEXT NOT NULL REFERENCES messages(id),state TEXT NOT NULL,expires INTEGER NOT NULL,claimed INTEGER,idem TEXT NOT NULL,fingerprint TEXT NOT NULL,UNIQUE(user_id,idem));
    CREATE TABLE IF NOT EXISTS sms_requests(user_id TEXT NOT NULL REFERENCES users(id),idem TEXT NOT NULL,fingerprint TEXT NOT NULL,message_id TEXT NOT NULL,command_id TEXT NOT NULL,PRIMARY KEY(user_id,idem));
    CREATE TABLE IF NOT EXISTS device_events(device_id TEXT NOT NULL REFERENCES devices(id),event_id TEXT NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(device_id,event_id));
    CREATE TABLE IF NOT EXISTS history_links(device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,source_id TEXT NOT NULL,kind TEXT NOT NULL,target_id TEXT NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(device_id,source_id),UNIQUE(device_id,kind,target_id));
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,user_id TEXT,action TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS messages_owner ON messages(user_id,created);
    CREATE INDEX IF NOT EXISTS calls_owner ON calls(user_id,created);`);
  const seal = (value) => {
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([
      c.update(JSON.stringify(value), "utf8"),
      c.final(),
    ]);
    return Buffer.concat([iv, c.getAuthTag(), encrypted]).toString("base64");
  };
  const open = (value) => {
    const b = Buffer.from(value, "base64"),
      d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([d.update(b.subarray(28)), d.final()]).toString(),
    );
  };
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  db.exec(managementSchema);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const contactColumns = new Set(
    all("PRAGMA table_info(contacts)").map((c) => c.name),
  );
  for (const [name, type] of Object.entries({
    version: "INTEGER NOT NULL DEFAULT 1",
    deleted: "INTEGER NOT NULL DEFAULT 0",
    synced_version: "INTEGER NOT NULL DEFAULT 0",
    synced_device: "TEXT",
  })) {
    if (!contactColumns.has(name))
      db.exec(`ALTER TABLE contacts ADD COLUMN ${name} ${type}`);
  }
  const numberKey = (number) =>
    createHmac("sha256", key).update(number.trim()).digest("hex");
  const audit = (user, action) =>
    run(
      "INSERT INTO audit(user_id,action,created) VALUES(?,?,?)",
      user,
      action,
      Date.now(),
    );
  const transaction = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  function conversation(user, number, sim) {
    let row = get(
      "SELECT * FROM conversations WHERE user_id=? AND number_key=? AND sim=?",
      user,
      numberKey(number),
      sim,
    );
    if (!row) {
      const id = randomUUID();
      run(
        "INSERT INTO conversations VALUES(?,?,?,?,?)",
        id,
        user,
        numberKey(number),
        sim,
        seal({ number, name: "", archived: false, pinned: false }),
      );
      row = get("SELECT * FROM conversations WHERE id=?", id);
    }
    return row;
  }
  function setStatus(messageId, status) {
    const row = get("SELECT data FROM messages WHERE id=?", messageId);
    if (row)
      run(
        "UPDATE messages SET data=? WHERE id=?",
        seal({ ...open(row.data), status }),
        messageId,
      );
  }
  function expire() {
    transaction(() => {
      for (const c of all(
        "SELECT * FROM commands WHERE state='queued' AND expires<?",
        Date.now(),
      )) {
        run("UPDATE commands SET state='expired' WHERE id=?", c.id);
        setStatus(c.message_id, "expired");
      }
      for (const c of all(
        "SELECT * FROM commands WHERE state='claimed' AND claimed<?",
        Date.now() - 120000,
      )) {
        run("UPDATE commands SET state='unknown' WHERE id=?", c.id);
        setStatus(c.message_id, "unknown");
      }
      run("DELETE FROM sessions WHERE expires<?", Date.now());
      run("DELETE FROM pairings WHERE expires<?", Date.now());
    });
  }
  return {
    db,
    seal,
    open,
    all,
    get,
    run,
    numberKey,
    audit,
    transaction,
    conversation,
    setStatus,
    expire,
    createUser(username, name, password) {
      const id = randomUUID();
      run(
        "INSERT INTO users VALUES(?,?,?,?)",
        id,
        username.toLowerCase(),
        name,
        passwordHash(password),
      );
      return id;
    },
    state(user) {
      expire();
      const dev = get("SELECT * FROM devices WHERE user_id=?", user);
      const contacts = all(
        "SELECT * FROM contacts WHERE user_id=? AND deleted=0",
        user,
      ).map((r) => ({
        id: r.id,
        ...open(r.data),
        phoneSynced:
          !!dev && r.synced_device === dev.id && r.synced_version === r.version,
      }));
      const names = new Map(contacts.map((c) => [c.number, c.name]));
      const conversations = all(
        "SELECT * FROM conversations WHERE user_id=? AND EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=conversations.id AND NOT EXISTS(SELECT 1 FROM deleted_history d WHERE d.user_id=m.user_id AND d.kind='sms' AND d.target_id=m.id))",
        user,
      ).map((r) => {
        const data = open(r.data);
        return {
          id: r.id,
          sim: r.sim,
          ...data,
          name: names.get(data.number) || data.name,
        };
      });
      return {
        conversations,
        contacts,
        blocks:all('SELECT * FROM blocked_numbers WHERE user_id=?',user).map(r=>({id:r.id,...open(r.data),blocked:!r.deleted,phoneSynced:!!dev&&r.synced_device===dev.id&&r.synced_version===r.version})),
        historySync:{pending:all("SELECT id FROM history_actions WHERE user_id=? AND status='pending'",user).length,failed:all("SELECT id FROM history_actions WHERE user_id=? AND status='failed'",user).length},
        messages: all(
          "SELECT * FROM messages WHERE user_id=? AND NOT EXISTS(SELECT 1 FROM deleted_history d WHERE d.user_id=messages.user_id AND d.kind='sms' AND d.target_id=messages.id) ORDER BY created DESC LIMIT 1000",
          user,
        )
          .map((r) => ({
            id: r.id,
            conversationId: r.conversation_id,
            ...open(r.data),
            createdAt: r.created,
            unread: !!r.unread,
          }))
          .reverse(),
        calls: all(
          "SELECT * FROM calls WHERE user_id=? AND NOT EXISTS(SELECT 1 FROM deleted_history d WHERE d.user_id=calls.user_id AND d.kind='call' AND d.target_id=calls.id) ORDER BY created DESC LIMIT 500",
          user,
        ).map((r) => ({ id: r.id, ...open(r.data), createdAt: r.created })),
        device: dev
          ? {
              id: dev.id,
              ...open(dev.data),
              lastSeen: dev.last_seen,
              online: Date.now() - dev.last_seen < 60000,
            }
          : null,
        capabilities: { liveCalls: false, push: false },
        limitedHistory: true,
      };
    },
  };
}
