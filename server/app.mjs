import express from "express";
import helmet from "helmet";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { hash, secret, passwordMatches, passwordHash } from "./store.mjs";
import { registerHistory } from "./history.mjs";
import { registerManagement } from './management.mjs';
import { registerVoice } from "./voice.mjs";

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_RENEW_INTERVAL_MS = 24 * 60 * 60 * 1000;

const sim = z.union([z.literal(1), z.literal(2)]);
const phone = z
  .string()
  .regex(
    /^\+[1-9]\d{6,14}$/,
    "Use an international number, e.g. +989121234567",
  );
const identifier = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[\w-]+$/);
const login = z
  .object({
    username: z.string().min(1).max(80),
    password: z.string().min(1).max(256),
  })
  .strict();
const error = (status, code, message) =>
  Object.assign(new Error(message), { status, code });
export function createApp(
  store,
  {
    origin = "http://127.0.0.1:49760",
    secure = false,
    dev = false,
    behindProxy = false,
    voiceOptions = {},
  } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  if (behindProxy) app.set("trust proxy", "loopback");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: dev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: dev
            ? ["'self'", "ws://127.0.0.1:*", "ws://localhost:*"]
            : ["'self'", origin.replace(/^http/, 'ws')],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: secure ? [] : null,
        },
      },
      strictTransportSecurity: secure ? { maxAge: 15552000 } : false,
    }),
  );
  app.use(express.json({ limit: "96kb" }));
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store, private");
    next();
  });
  const dummyPassword = passwordHash(secret());
  const attempts = new Map();
  function throttle(key, max = 8) {
    const now = Date.now();
    if (attempts.size > 10000)
      for (const [k, v] of attempts)
        if (now - v.start > 900000) attempts.delete(k);
    let a = attempts.get(key);
    if (!a || now - a.start > 900000) a = { start: now, count: 0 };
    a.count++;
    attempts.set(key, a);
    if (a.count > max)
      throw error(
        429,
        "rate_limited",
        "Too many attempts. Try again in 15 minutes.",
      );
  }
  function sameOrigin(req) {
    if (req.get("Origin") !== origin)
      throw error(403, "origin_rejected", "Request origin is not allowed.");
  }
  const cookieOptions = {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge: SESSION_DURATION_MS,
  };
  const cookieName = secure ? "__Host-relay" : "relay_session";
  function auth(req, res, next) {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    const session = token
      ? store.get(
          "SELECT * FROM sessions WHERE token=? AND expires>?",
          hash(token),
          Date.now(),
        )
      : null;
    if (!session) return next(error(401, "unauthorized", "Please sign in."));
    req.session = session;
    req.user = session.user_id;
    if (!["GET", "HEAD"].includes(req.method)) {
      try {
        sameOrigin(req);
        if (req.get("X-CSRF-Token") !== session.csrf)
          throw error(403, "csrf_rejected", "Session verification failed.");
      } catch (e) {
        return next(e);
      }
    }
    // Renew at most once per day, and only after authentication/CSRF checks.
    const renewedExpiry = Date.now() + SESSION_DURATION_MS;
    if (session.expires < renewedExpiry - SESSION_RENEW_INTERVAL_MS) {
      store.run("UPDATE sessions SET expires=? WHERE token=?", renewedExpiry, session.token);
      res.cookie(cookieName, token, cookieOptions);
    }
    next();
  }
  function deviceAuth(req, res, next) {
    const token = req.get("Authorization")?.match(/^Bearer ([\w-]{43})$/)?.[1];
    const device = token
      ? store.get("SELECT * FROM devices WHERE token=?", hash(token))
      : null;
    if (!device)
      return next(
        error(401, "device_unauthorized", "Device authentication failed."),
      );
    req.device = device;
    req.user = device.user_id;
    next();
  }
  registerHistory(app, store, deviceAuth);
  registerManagement(app, store, auth, deviceAuth);
  app.locals.voice = registerVoice(app,store,{auth,origin,secure,...voiceOptions});
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, product: "relay", version: 1 }),
  );
  app.post("/api/login", (req, res) => {
    sameOrigin(req);
    throttle("login:" + req.ip);
    const input = login.parse(req.body),
      user = store.get(
        "SELECT * FROM users WHERE username=?",
        input.username.toLowerCase(),
      );
    const valid = passwordMatches(
      input.password,
      user?.password || dummyPassword,
    );
    if (!user || !valid)
      throw error(
        401,
        "invalid_credentials",
        "Username or password is incorrect.",
      );
    const token = secret(),
      csrf = secret();
    store.run(
      "INSERT INTO sessions VALUES(?,?,?,?)",
      hash(token),
      user.id,
      csrf,
      Date.now() + SESSION_DURATION_MS,
    );
    store.audit(user.id, "login");
    res
      .cookie(cookieName, token, cookieOptions)
      .json({ user: { name: user.name, username: user.username }, csrf });
  });
  app.get("/api/session", auth, (req, res) =>
    res.json({
      user: store.get("SELECT name,username FROM users WHERE id=?", req.user),
      csrf: req.session.csrf,
    }),
  );
  app.post("/api/logout", auth, (req, res) => {
    store.run("DELETE FROM sessions WHERE token=?", req.session.token);
    res.clearCookie(cookieName, {httpOnly:true,sameSite:"strict",secure,path:"/"}).json({ ok: true });
  });
  app.get("/api/state", auth, (req, res) => res.json({...store.state(req.user),capabilities:app.locals.voice.available(req.user)}));
  app.post("/api/pairings", auth, (req, res) => {
    throttle("pair:" + req.user, 10);
    if (store.get("SELECT id FROM devices WHERE user_id=?", req.user))
      throw error(
        409,
        "already_paired",
        "Remove the existing phone before pairing another.",
      );
    const token = secret(),
      expiresAt = Date.now() + 300000;
    store.run("DELETE FROM pairings WHERE user_id=?", req.user);
    store.run(
      "INSERT INTO pairings VALUES(?,?,?)",
      hash(token),
      req.user,
      expiresAt,
    );
    store.audit(req.user, "pairing_created");
    res.status(201).json({ token, expiresAt, server: origin });
  });
  app.post("/api/device/pair", (req, res) => {
    throttle("claim:" + req.ip, 15);
    const { token, name } = z
      .object({ token: z.string().length(43), name: z.string().min(1).max(60) })
      .strict()
      .parse(req.body);
    const result = store.transaction(() => {
      const p = store.get(
        "SELECT * FROM pairings WHERE token=? AND expires>?",
        hash(token),
        Date.now(),
      );
      if (!p)
        throw error(
          401,
          "invalid_pairing",
          "Pairing code is invalid or expired.",
        );
      if (store.get("SELECT id FROM devices WHERE user_id=?", p.user_id))
        throw error(409, "already_paired", "A phone is already paired.");
      const id = randomUUID(),
        deviceToken = secret();
      store.run(
        "INSERT INTO devices(id,user_id,token,data) VALUES(?,?,?,?)",
        id,
        p.user_id,
        hash(deviceToken),
        store.seal({
          name,
          model: "",
          battery: null,
          sims: [],
          smsReady: false,
        }),
      );
      store.run("DELETE FROM pairings WHERE user_id=?", p.user_id);
      store.audit(p.user_id, "device_paired");
      return { deviceId: id, token: deviceToken };
    });
    res.status(201).json(result);
  });
  app.delete("/api/device", auth, (req, res) => {
    store.transaction(() => {
      const d = store.get("SELECT id FROM devices WHERE user_id=?", req.user);
      if (d) {
        for (const c of store.all(
          "SELECT * FROM commands WHERE device_id=? AND state='queued'",
          d.id,
        ))
          store.setStatus(c.message_id, "cancelled");
        for (const c of store.all(
          "SELECT * FROM commands WHERE device_id=? AND state='claimed'",
          d.id,
        ))
          store.setStatus(c.message_id, "unknown");
        store.run("DELETE FROM commands WHERE device_id=?", d.id);
        store.run("DELETE FROM device_events WHERE device_id=?", d.id);
        store.run("DELETE FROM devices WHERE id=?", d.id);
      }
      store.run("DELETE FROM pairings WHERE user_id=?", req.user);
      store.audit(req.user, "device_removed");
    });
    res.json({ ok: true });
  });
  app.post("/api/device/heartbeat", deviceAuth, (req, res) => {
    const data = z
      .object({
        model: z.string().max(80),
        battery: z.number().int().min(0).max(100).nullable(),
        smsReady: z.boolean(),
        sims: z
          .array(
            z
              .object({
                slot: sim,
                label: z.string().max(40),
                available: z.boolean(),
              })
              .strict(),
          )
          .max(2)
          .refine((s) => new Set(s.map((x) => x.slot)).size === s.length),
      })
      .strict()
      .parse(req.body);
    store.run(
      "UPDATE devices SET data=?,last_seen=? WHERE id=?",
      store.seal({ ...store.open(req.device.data), ...data }),
      Date.now(),
      req.device.id,
    );
    res.json({ ok: true, serverTime: Date.now() });
  });
  app.post("/api/messages", auth, (req, res) => {
    const data = z
      .object({ number: phone, sim, text: z.string().trim().min(1).max(1600) })
      .strict()
      .parse(req.body);
    const idem = identifier.parse(req.get("Idempotency-Key")),
      fingerprint = store.numberKey(JSON.stringify(data));
    const result = store.transaction(() => {
      const existing = store.get(
        "SELECT * FROM sms_requests WHERE user_id=? AND idem=?",
        req.user,
        idem,
      );
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw error(
            409,
            "idempotency_conflict",
            "Request key was used for different content.",
          );
        return {
          id: existing.message_id,
          commandId: existing.command_id,
          replayed: true,
        };
      }
      const device = store.get(
        "SELECT * FROM devices WHERE user_id=?",
        req.user,
      );
      if (!device)
        throw error(
          409,
          "device_not_paired",
          "Pair your phone before sending messages.",
        );
      const details = store.open(device.data);
      if (
        !details.smsReady ||
        !details.sims.some((s) => s.slot === data.sim && s.available)
      )
        throw error(409, "sim_unavailable", "This SIM is not ready to send.");
      throttle("sms:" + req.user, 30);
      const c = store.conversation(req.user, data.number, data.sim),
        id = randomUUID(),
        commandId = randomUUID();
      store.run(
        "INSERT INTO messages VALUES(?,?,?,?,?,0)",
        id,
        req.user,
        c.id,
        store.seal({
          text: data.text,
          sim: data.sim,
          direction: "outgoing",
          status: "queued",
        }),
        Date.now(),
      );
      store.run(
        "INSERT INTO commands VALUES(?,?,?,?,?,?,?,?,?)",
        commandId,
        req.user,
        device.id,
        id,
        "queued",
        Date.now() + 600000,
        null,
        idem,
        fingerprint,
      );
      store.run(
        "INSERT INTO sms_requests VALUES(?,?,?,?,?)",
        req.user,
        idem,
        fingerprint,
        id,
        commandId,
      );
      store.audit(req.user, "sms_queued");
      return { id, commandId, replayed: false };
    });
    res.status(result.replayed ? 200 : 201).json(result);
  });
  app.post("/api/messages/:id/cancel", auth, (req, res) => {
    const c = store.get(
      "SELECT * FROM commands WHERE message_id=? AND user_id=? AND state='queued'",
      req.params.id,
      req.user,
    );
    if (!c)
      throw error(
        409,
        "not_cancellable",
        "Only unclaimed queued messages can be cancelled.",
      );
    store.transaction(() => {
      store.run("UPDATE commands SET state='cancelled' WHERE id=?", c.id);
      store.setStatus(c.message_id, "cancelled");
    });
    res.json({ ok: true });
  });
  app.post("/api/device/commands/claim", deviceAuth, (req, res) => {
    store.expire();
    const command = store.transaction(() => {
      const c = store.get(
        "SELECT * FROM commands WHERE device_id=? AND state='queued' ORDER BY expires LIMIT 1",
        req.device.id,
      );
      if (!c) return null;
      store.run(
        "UPDATE commands SET state='claimed',claimed=? WHERE id=?",
        Date.now(),
        c.id,
      );
      store.setStatus(c.message_id, "sending");
      const m = store.get("SELECT * FROM messages WHERE id=?", c.message_id),
        conversation = store.get(
          "SELECT data FROM conversations WHERE id=?",
          m.conversation_id,
        );
      return {
        id: c.id,
        type: "send_sms",
        messageId: c.message_id,
        number: store.open(conversation.data).number,
        ...store.open(m.data),
        expiresAt: c.expires,
      };
    });
    res.json({ command });
  });
  app.post("/api/device/commands/:id/result", deviceAuth, (req, res) => {
    const { status } = z
      .object({ status: z.enum(["sent", "delivered", "failed"]) })
      .strict()
      .parse(req.body);
    const c = store.get(
      "SELECT * FROM commands WHERE id=? AND device_id=?",
      req.params.id,
      req.device.id,
    );
    if (!c) throw error(404, "not_found", "Command not found.");
    if (c.state === status) return res.json({ ok: true, replayed: true });
    if (
      !["claimed", "unknown"].includes(c.state) &&
      !(c.state === "sent" && status === "delivered")
    )
      throw error(
        409,
        "invalid_transition",
        "Command cannot move to this status.",
      );
    store.transaction(() => {
      store.run("UPDATE commands SET state=? WHERE id=?", status, c.id);
      store.setStatus(c.message_id, status);
    });
    res.json({ ok: true });
  });
  const base = {
    id: identifier,
    sim,
    number: z.string().min(1).max(80),
    timestamp: z
      .number()
      .int()
      .min(0)
      .refine((t) => t <= Date.now() + 300000),
  };
  const event = z.discriminatedUnion("type", [
    z
      .object({
        ...base,
        type: z.literal("sms"),
        text: z.string().max(10000),
        direction: z.enum(["incoming", "outgoing"]),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("call"),
        direction: z.enum(["incoming", "outgoing", "missed"]),
        duration: z.number().int().min(0).max(86400),
      })
      .strict(),
  ]);
  app.post("/api/device/events", deviceAuth, (req, res) => {
    const { events } = z
      .object({ events: z.array(event).max(50) })
      .strict()
      .parse(req.body);
    const notifications = [];
    const count = store.transaction(() => {
      let accepted = 0;
      for (const e of events) {
        const fingerprint = store.numberKey(JSON.stringify(e)),
          old = store.get(
            "SELECT fingerprint FROM device_events WHERE device_id=? AND event_id=?",
            req.device.id,
            e.id,
          );
        if (old) {
          if (old.fingerprint !== fingerprint)
            throw error(
              409,
              "event_conflict",
              "Event ID was reused with different content.",
            );
          continue;
        }
        store.run(
          "INSERT INTO device_events VALUES(?,?,?)",
          req.device.id,
          e.id,
          fingerprint,
        );
        if (e.type === "sms") {
          const c = store.conversation(req.user, e.number, e.sim);
          if(e.direction === "incoming") notifications.push({conversationId:c.id,sim:e.sim});
          store.run(
            "INSERT INTO messages VALUES(?,?,?,?,?,?)",
            randomUUID(),
            req.user,
            c.id,
            store.seal({
              text: e.text,
              sim: e.sim,
              direction: e.direction,
              status: e.direction === "incoming" ? "received" : "sent",
            }),
            e.timestamp,
            e.direction === "incoming" ? 1 : 0,
          );
        } else
          store.run(
            "INSERT INTO calls VALUES(?,?,?,?)",
            randomUUID(),
            req.user,
            store.seal({
              number: e.number,
              sim: e.sim,
              direction: e.direction,
              duration: e.duration,
            }),
            e.timestamp,
          );
        accepted++;
      }
      return accepted;
    });
    for(const sms of notifications) void app.locals.voice.notifySms(req.user,sms).catch(()=>{});
    res.json({ accepted: count, duplicates: events.length - count });
  });
  app.patch("/api/conversations/:id", auth, (req, res) => {
    const fields = z
      .object({
        archived: z.boolean().optional(),
        pinned: z.boolean().optional(),
        read: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    const c = store.get(
      "SELECT * FROM conversations WHERE id=? AND user_id=?",
      req.params.id,
      req.user,
    );
    if (!c) throw error(404, "not_found", "Conversation not found.");
    const { read, ...data } = fields;
    store.transaction(() => {
      store.run(
        "UPDATE conversations SET data=? WHERE id=?",
        store.seal({ ...store.open(c.data), ...data }),
        c.id,
      );
      if (read)
        store.run("UPDATE messages SET unread=0 WHERE conversation_id=?", c.id);
    });
    res.json({ ok: true });
  });
  app.post("/api/contacts", auth, (req, res) => {
    const contact = z
      .object({ name: z.string().trim().min(1).max(80), number: phone })
      .strict()
      .parse(req.body);
    const id =
      store.get(
        "SELECT id FROM contacts WHERE user_id=? AND number_key=?",
        req.user,
        store.numberKey(contact.number),
      )?.id || randomUUID();
    if (
      !store.get("SELECT id FROM contacts WHERE id=?", id) &&
      store.get("SELECT count(*) AS n FROM contacts WHERE user_id=?", req.user)
        .n >= 1000
    )
      throw error(
        409,
        "contact_limit",
        "Contact sync supports up to 1,000 distinct numbers.",
      );
    store.run(
      "INSERT INTO contacts(id,user_id,number_key,data) VALUES(?,?,?,?) ON CONFLICT(user_id,number_key) DO UPDATE SET data=excluded.data,deleted=0,version=contacts.version+1",
      id,
      req.user,
      store.numberKey(contact.number),
      store.seal(contact),
    );
    res.status(201).json({ id, ...contact });
  });
  app.delete("/api/contacts/:id", auth, (req, res) => {
    store.run(
      "UPDATE contacts SET deleted=1,version=version+1 WHERE id=? AND user_id=? AND deleted=0",
      req.params.id,
      req.user,
    );
    res.json({ ok: true });
  });
  app.post("/api/device/contacts/import", deviceAuth, (req, res) => {
    const { contacts } = z
      .object({
        contacts: z
          .array(
            z
              .object({
                source: z.string().regex(/^\d+$/),
                name: z.string().trim().min(1).max(80),
                number: phone,
              })
              .strict(),
          )
          .max(50),
      })
      .strict()
      .parse(req.body);
    const linked = store.transaction(() =>
      contacts.map((c) => {
        let row = store.get(
          "SELECT * FROM contacts WHERE user_id=? AND number_key=?",
          req.user,
          store.numberKey(c.number),
        );
        if (!row) {
          if (
            store.get(
              "SELECT count(*) AS n FROM contacts WHERE user_id=?",
              req.user,
            ).n >= 1000
          )
            throw error(
              409,
              "contact_limit",
              "Contact sync supports up to 1,000 distinct numbers.",
            );
          const id = randomUUID();
          store.run(
            "INSERT INTO contacts(id,user_id,number_key,data) VALUES(?,?,?,?)",
            id,
            req.user,
            store.numberKey(c.number),
            store.seal({ name: c.name, number: c.number }),
          );
          row = store.get("SELECT * FROM contacts WHERE id=?", id);
        }
        return { source: c.source, id: row.id };
      }),
    );
    res.json({ namespace: req.user, linked });
  });
  app.post("/api/device/contacts/sync", deviceAuth, (req, res) => {
    const { changes, acknowledgments } = z
      .object({
        changes: z
          .array(
            z
              .object({
                id: z.string().uuid(),
                version: z.number().int().nonnegative(),
                name: z.string().trim().min(1).max(80),
                number: phone,
                deleted: z.boolean(),
              })
              .strict(),
          )
          .max(50),
        acknowledgments: z
          .array(
            z
              .object({
                id: z.string().uuid(),
                version: z.number().int().positive(),
              })
              .strict(),
          )
          .max(1000),
      })
      .strict()
      .parse(req.body);
    const conflicts = [];
    store.transaction(() => {
      for (const c of changes) {
        const old = store.get(
          "SELECT * FROM contacts WHERE id=? AND user_id=?",
          c.id,
          req.user,
        );
        if (!old || old.version !== c.version) {
          conflicts.push(c.id);
          continue;
        }
        const value = store.open(old.data);
        const collision = store.get(
          "SELECT id FROM contacts WHERE user_id=? AND number_key=? AND id<>?",
          req.user,
          store.numberKey(c.number),
          c.id,
        );
        if (collision) {
          conflicts.push(c.id);
          continue;
        }
        if (
          value.name === c.name &&
          value.number === c.number &&
          !!old.deleted === c.deleted
        )
          continue;
        store.run(
          "UPDATE contacts SET data=?,number_key=?,deleted=?,version=version+1 WHERE id=? AND user_id=?",
          store.seal({ name: c.name, number: c.number }),
          store.numberKey(c.number),
          c.deleted ? 1 : 0,
          c.id,
          req.user,
        );
      }
      for (const ack of acknowledgments)
        store.run(
          "UPDATE contacts SET synced_version=?,synced_device=? WHERE id=? AND user_id=? AND version=?",
          ack.version,
          req.device.id,
          ack.id,
          req.user,
          ack.version,
        );
    });
    const rows = store.all(
      "SELECT * FROM contacts WHERE user_id=? ORDER BY id",
      req.user,
    );
    res.json({
      namespace: req.user,
      conflicts,
      contacts: rows.map((r) => ({
        id: r.id,
        version: r.version,
        deleted: !!r.deleted,
        ...store.open(r.data),
      })),
    });
  });
  app.post("/api/calls", auth, (_req, _res) => {
    throw error(
      501,
      "calls_not_ready",
      "Live calls require a verified phone audio bridge.",
    );
  });
  app.post("/api/password", auth, (req, res) => {
    const { currentPassword, newPassword } = z
      .object({
        currentPassword: z.string().max(256),
        newPassword: z.string().min(12).max(256),
      })
      .strict()
      .parse(req.body);
    const u = store.get("SELECT password FROM users WHERE id=?", req.user);
    throttle("password:" + req.user);
    if (!passwordMatches(currentPassword, u.password))
      throw error(401, "invalid_credentials", "Current password is incorrect.");
    store.transaction(() => {
      store.run(
        "UPDATE users SET password=? WHERE id=?",
        passwordHash(newPassword),
        req.user,
      );
      store.run("DELETE FROM sessions WHERE user_id=?", req.user);
      store.audit(req.user, "password_changed");
    });
    res.clearCookie(cookieName, {httpOnly:true,sameSite:"strict",secure,path:"/"}).json({ ok: true });
  });
  app.use("/api", (_req, _res, next) =>
    next(error(404, "not_found", "Endpoint not found.")),
  );
  app.use((err, req, res, _next) => {
    if (err instanceof z.ZodError)
      return res.status(400).json({
        error: {
          code: "invalid_request",
          message: err.issues[0]?.message || "Invalid request.",
        },
      });
    if (err.type === "entity.too.large")
      return res.status(413).json({
        error: { code: "too_large", message: "Request is too large." },
      });
    if (err.type === "entity.parse.failed")
      return res
        .status(400)
        .json({ error: { code: "invalid_json", message: "Invalid JSON." } });
    // Never log URLs, request bodies, authentication headers or database payloads.
    if (!err.status) console.error("Relay request failed:", err.name);
    res.status(err.status || 500).json({
      error: {
        code: err.code || "internal_error",
        message: err.status ? err.message : "Request could not be completed.",
      },
    });
  });
  return app;
}
