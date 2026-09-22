import { z } from "zod";
import { randomUUID } from "node:crypto";
import { historyGuard } from './management.mjs';

export function registerHistory(app, store, deviceAuth) {
  const record = z
    .object({
      id: z.string().regex(/^(smsdb|call)-[0-9]+-[0-9]+$/),
      type: z.enum(["sms", "call"]),
      number: z.string().min(1).max(80),
      originalNumber: z.string().max(80),
      sim: z.number().int().min(0).max(2),
      timestamp: z.number().int().nonnegative().max(8640000000000000),
      sentTimestamp: z.number().int().nonnegative().max(8640000000000000),
      direction: z.enum([
        "incoming",
        "outgoing",
        "missed",
        "rejected",
        "blocked",
        "voicemail",
        "unknown",
      ]),
      text: z.string().max(10000).optional(),
      status: z
        .enum(["received", "sent", "failed", "draft", "pending"])
        .optional(),
      read: z.boolean().optional(),
      duration: z.number().int().min(0).max(86400).optional(),
    })
    .strict()
    .refine((e) =>
      e.type === "sms"
        ? ["incoming", "outgoing"].includes(e.direction) &&
          e.text !== undefined &&
          e.status !== undefined &&
          e.read !== undefined
        : e.duration !== undefined,
    );
  app.post("/api/device/history", deviceAuth, (req, res) => {
    const { records } = z
      .object({ records: z.array(record).min(1).max(25) })
      .strict()
      .parse(req.body);
    let imported = 0,
      matched = 0,
      duplicates = 0;
    store.transaction(() => {
      for (const e of records) {
        const fingerprint = store.numberKey(JSON.stringify(e));
        let previous = store.get(
          "SELECT * FROM history_links WHERE device_id=? AND source_id=?",
          req.device.id,
          e.id,
        );
        // Upgrade old SMS row-only identities without duplicating imported rows.
        // A date-qualified identity also prevents a deleted row ID from hiding a
        // later message when Android reuses IDs after clearing the inbox.
        if(!previous&&e.type==='sms'&&!e.id.endsWith('-0')){
          const legacyId=e.id.replace(/-[0-9]+$/,'-0');
          const legacy=store.get('SELECT * FROM history_links WHERE device_id=? AND source_id=?',req.device.id,legacyId);
          if(legacy){
            const guard=store.get('SELECT data FROM history_guards WHERE device_id=? AND source_id=?',req.device.id,legacyId);
            const timestamp=guard?store.open(guard.data).timestamp:store.get('SELECT created FROM messages WHERE id=?',legacy.target_id)?.created;
            if(timestamp===e.timestamp){
              store.run('UPDATE history_links SET source_id=? WHERE device_id=? AND source_id=?',e.id,req.device.id,legacyId);
              store.run('UPDATE history_guards SET source_id=? WHERE device_id=? AND source_id=?',e.id,req.device.id,legacyId);
              store.run('UPDATE history_actions SET source_id=? WHERE device_id=? AND source_id=?',e.id,req.device.id,legacyId);
              previous={...legacy,source_id:e.id};
            }
          }
        }
        if (previous) {
          if(store.get('SELECT 1 FROM deleted_history WHERE user_id=? AND kind=? AND target_id=?',req.user,previous.kind,previous.target_id)){duplicates++;continue;}
          store.run('INSERT OR REPLACE INTO history_guards VALUES(?,?,?)',req.device.id,e.id,store.seal(historyGuard(e)));
          if (previous.fingerprint !== fingerprint) {
            if (e.type !== previous.kind)
              throw Object.assign(new Error("History source type changed."), {
                status: 409,
                code: "history_conflict",
              });
            if (e.type === "sms") {
              const command = store.get(
                "SELECT id FROM commands WHERE message_id=? AND user_id=?",
                previous.target_id,
                req.user,
              );
              if (!command) {
                const c = store.conversation(req.user, e.number, e.sim);
                store.run(
                  "UPDATE messages SET conversation_id=?,data=?,created=?,unread=? WHERE id=? AND user_id=?",
                  c.id,
                  store.seal({
                    text: e.text,
                    sim: e.sim,
                    direction: e.direction,
                    status: e.status,
                  }),
                  e.timestamp,
                  e.read ? 0 : 1,
                  previous.target_id,
                  req.user,
                );
              }
            } else
              store.run(
                "UPDATE calls SET data=?,created=? WHERE id=? AND user_id=?",
                store.seal({
                  number: e.number,
                  sim: e.sim,
                  direction: e.direction,
                  duration: e.duration,
                }),
                e.timestamp,
                previous.target_id,
                req.user,
              );
            store.run(
              "UPDATE history_links SET fingerprint=? WHERE device_id=? AND source_id=?",
              fingerprint,
              req.device.id,
              e.id,
            );
          }
          duplicates++;
          continue;
        }
        // Match each legacy live record at most once. Two identical provider rows
        // remain two records, rather than being collapsed by a content hash.
        const table = e.type === "sms" ? "messages" : "calls";
        const candidates = store.all(
          `SELECT r.* FROM ${table} r WHERE r.user_id=? AND NOT EXISTS (SELECT 1 FROM history_links h WHERE h.device_id=? AND h.kind=? AND h.target_id=r.id) AND (ABS(r.created-?)<=300000 OR ABS(r.created-?)<=300000) ORDER BY ABS(r.created-?)`,
          req.user,
          req.device.id,
          e.type,
          e.timestamp,
          e.sentTimestamp,
          e.timestamp,
        );
        let found;
        for (const row of candidates) {
          const value = store.open(row.data);
          const address =
            e.type === "sms"
              ? store.open(
                  store.get(
                    "SELECT data FROM conversations WHERE id=?",
                    row.conversation_id,
                  ).data,
                ).number
              : value.number;
          if (
            ![e.number, e.originalNumber].includes(address) ||
            value.sim !== e.sim ||
            value.direction !== e.direction
          )
            continue;
          if (e.type === "sms") {
            if (value.text !== e.text) continue;
            if (
              e.direction === "outgoing" &&
              (!["sent", "failed"].includes(e.status) ||
                !["sent", "delivered", "sending", "unknown", "failed"].includes(
                  value.status,
                ))
            )
              continue;
            const allowed = e.direction === "outgoing" ? 300000 : 0;
            if (
              Math.min(
                Math.abs(row.created - e.timestamp),
                e.sentTimestamp
                  ? Math.abs(row.created - e.sentTimestamp)
                  : Infinity,
              ) > allowed
            )
              continue;
          } else if (
            value.duration !== e.duration ||
            row.created !== e.timestamp
          )
            continue;
          found = row.id;
          break;
        }
        const id = found || randomUUID();
        if (found) matched++;
        else {
          if (e.type === "sms") {
            const c = store.conversation(req.user, e.number, e.sim);
            store.run(
              "INSERT INTO messages VALUES(?,?,?,?,?,?)",
              id,
              req.user,
              c.id,
              store.seal({
                text: e.text,
                sim: e.sim,
                direction: e.direction,
                status: e.status,
              }),
              e.timestamp,
              e.read ? 0 : 1,
            );
          } else
            store.run(
              "INSERT INTO calls VALUES(?,?,?,?)",
              id,
              req.user,
              store.seal({
                number: e.number,
                sim: e.sim,
                direction: e.direction,
                duration: e.duration,
              }),
              e.timestamp,
            );
          imported++;
        }
        store.run(
          "INSERT INTO history_links VALUES(?,?,?,?,?)",
          req.device.id,
          e.id,
          e.type,
          id,
          fingerprint,
        );
        store.run('INSERT OR REPLACE INTO history_guards VALUES(?,?,?)',req.device.id,e.id,store.seal(historyGuard(e)));
        if(store.get('SELECT 1 FROM pending_history_deletes WHERE user_id=? AND kind=? AND target_id=?',req.user,e.type,id)){
          store.run('INSERT INTO history_actions(id,user_id,device_id,source_id,kind,action,data) VALUES(?,?,?,?,?,?,?)',randomUUID(),req.user,req.device.id,e.id,e.type,'delete',store.seal(historyGuard(e)));
          store.run(`UPDATE ${table} SET data=? WHERE id=? AND user_id=?`,store.seal({deleted:true}),id,req.user);
          store.run('DELETE FROM pending_history_deletes WHERE user_id=? AND kind=? AND target_id=?',req.user,e.type,id);
        }
      }
    });
    res.json({ imported, matched, duplicates });
  });
}
