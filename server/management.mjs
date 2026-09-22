import {z} from 'zod';
import {randomUUID,createHash} from 'node:crypto';
export const managementSchema=`
CREATE TABLE IF NOT EXISTS history_guards(device_id TEXT NOT NULL,source_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(device_id,source_id));
CREATE TABLE IF NOT EXISTS deleted_history(user_id TEXT NOT NULL,kind TEXT NOT NULL,target_id TEXT NOT NULL,PRIMARY KEY(user_id,kind,target_id));
CREATE TABLE IF NOT EXISTS history_actions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,device_id TEXT NOT NULL,source_id TEXT NOT NULL,kind TEXT NOT NULL,action TEXT NOT NULL,data TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',error TEXT);
CREATE TABLE IF NOT EXISTS blocked_numbers(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,number_key TEXT NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,synced_version INTEGER NOT NULL DEFAULT 0,synced_device TEXT,UNIQUE(user_id,number_key));`;
const fail=(status,message)=>{throw Object.assign(new Error(message),{status,code:'sync_conflict'});};
const normalizeNumber=n=>{if(!/^[+0-9 ()-]+$/.test(n))return n;let p=n.replace(/[ ()-]/g,'');if(p.startsWith('00'))p='+'+p.slice(2);if(/^09\d{9}$/.test(p))p='+98'+p.slice(1);return p;};
export function historyGuard(e){return {timestamp:e.timestamp,originalNumber:e.originalNumber,...(e.type==='sms'?{textHash:createHash('sha256').update(e.text).digest('hex')}:{})};}
export function removeHistory(store,user,kind,id,fromPhone=false){
 const table=kind==='sms'?'messages':'calls';
 const row=store.get(`SELECT * FROM ${table} WHERE id=? AND user_id=?`,id,user);
 if(!row)fail(404,'History item not found.');
 if(store.get('SELECT 1 FROM deleted_history WHERE user_id=? AND kind=? AND target_id=?',user,kind,id))return;
 const link=store.get('SELECT h.* FROM history_links h JOIN devices d ON d.id=h.device_id WHERE d.user_id=? AND h.kind=? AND h.target_id=?',user,kind,id);
 const guard=link&&store.get('SELECT data FROM history_guards WHERE device_id=? AND source_id=?',link.device_id,link.source_id);
 const command=kind==='sms'&&store.get('SELECT * FROM commands WHERE message_id=? AND user_id=?',id,user);
 if(!fromPhone){
  if(command&&['claimed','unknown'].includes(command.state))fail(409,'Wait for this message’s send result before deleting it.');
  if(link&&!guard)fail(409,'Wait for the phone to refresh this history item before deleting it.');
  if(!link&&store.get('SELECT id FROM devices WHERE user_id=?',user)&&!(command&&['queued','cancelled','expired','failed'].includes(command.state)))fail(409,'This item is waiting for its phone history link. Try again after synchronization.');
 }
 store.run('INSERT INTO deleted_history VALUES(?,?,?)',user,kind,id);
 if(command?.state==='queued')store.run("UPDATE commands SET state='cancelled' WHERE id=?",command.id);
 if(kind==='sms')store.run('UPDATE messages SET data=?,unread=0 WHERE id=?',store.seal({deleted:true}),id);
 else store.run('UPDATE calls SET data=? WHERE id=?',store.seal({deleted:true}),id);
 if(link&&!fromPhone)store.run('INSERT INTO history_actions(id,user_id,device_id,source_id,kind,action,data) VALUES(?,?,?,?,?,?,?)',randomUUID(),user,link.device_id,link.source_id,kind,'delete',guard.data);
 if(link&&fromPhone)store.run("UPDATE history_actions SET status='done',error=NULL WHERE device_id=? AND source_id=? AND action='delete'",link.device_id,link.source_id);
}
export function registerManagement(app,store,auth,deviceAuth){
 for(const [route,kind,table] of [['messages','sms','messages'],['calls','call','calls']]){
  app.delete(`/api/${route}/:id`,auth,(req,res)=>{store.transaction(()=>removeHistory(store,req.user,kind,req.params.id));res.sendStatus(204);});
  app.delete(`/api/${route}`,auth,(req,res)=>{store.transaction(()=>{for(const r of store.all(`SELECT id FROM ${table} WHERE user_id=?`,req.user))removeHistory(store,req.user,kind,r.id);});res.sendStatus(204);});
 }
 app.delete('/api/conversations/:id',auth,(req,res)=>{
  if(!store.get('SELECT id FROM conversations WHERE id=? AND user_id=?',req.params.id,req.user))fail(404,'Conversation not found.');
  store.transaction(()=>{for(const row of store.all('SELECT id FROM messages WHERE conversation_id=? AND user_id=?',req.params.id,req.user))removeHistory(store,req.user,'sms',row.id);});res.sendStatus(204);
 });
 const source=z.string().regex(/^(smsdb|call)-[0-9]+-[0-9]+$/);
 app.post('/api/device/history/sync',deviceAuth,(req,res)=>{
  const body=z.object({missing:z.array(source).max(100),results:z.array(z.object({id:z.string().uuid(),ok:z.boolean(),error:z.enum(['permission','changed','unavailable']).optional()}).strict()).max(100)}).strict().parse(req.body);
  store.transaction(()=>{
   for(const id of body.missing){const link=store.get('SELECT * FROM history_links WHERE device_id=? AND source_id=?',req.device.id,id);if(link)removeHistory(store,req.user,link.kind,link.target_id,true);}
   for(const r of body.results)store.run('UPDATE history_actions SET status=?,error=? WHERE id=? AND device_id=? AND user_id=?',r.ok?'done':'failed',r.ok?null:r.error||'unavailable',r.id,req.device.id,req.user);
  });
  const actions=store.all("SELECT * FROM history_actions WHERE device_id=? AND user_id=? AND status!='done' ORDER BY rowid LIMIT 50",req.device.id,req.user).map(r=>({id:r.id,source:r.source_id,kind:r.kind,action:r.action,...store.open(r.data)}));
  res.json({actions});
 });
 const number=z.string().trim().min(1).max(80).refine(s=>!/[\r\n\u0000]/.test(s)).transform(normalizeNumber);
 app.post('/api/blocks',auth,(req,res)=>{
  const b=z.object({number,blocked:z.boolean()}).strict().parse(req.body);
  store.run('INSERT INTO blocked_numbers(id,user_id,number_key,data,deleted) VALUES(?,?,?,?,?) ON CONFLICT(user_id,number_key) DO UPDATE SET deleted=excluded.deleted,version=blocked_numbers.version+1',randomUUID(),req.user,store.numberKey(b.number),store.seal({number:b.number}),b.blocked?0:1);res.sendStatus(204);
 });
 app.post('/api/device/blocks/sync',deviceAuth,(req,res)=>{
  const b=z.object({imported:z.array(number).max(100),changes:z.array(z.object({id:z.string().uuid(),version:z.number().int().positive(),blocked:z.boolean()}).strict()).max(100),acknowledgments:z.array(z.object({id:z.string().uuid(),version:z.number().int().positive()}).strict()).max(2000)}).strict().parse(req.body);
  store.transaction(()=>{
   for(const n of b.imported)store.run('INSERT OR IGNORE INTO blocked_numbers(id,user_id,number_key,data) VALUES(?,?,?,?)',randomUUID(),req.user,store.numberKey(n),store.seal({number:n}));
   for(const c of b.changes)store.run('UPDATE blocked_numbers SET deleted=?,version=version+1 WHERE id=? AND user_id=? AND version=? AND deleted<>?',c.blocked?0:1,c.id,req.user,c.version,c.blocked?0:1);
   for(const a of b.acknowledgments)store.run('UPDATE blocked_numbers SET synced_version=?,synced_device=? WHERE id=? AND user_id=? AND version=?',a.version,req.device.id,a.id,req.user,a.version);
  });
  res.json({blocks:store.all('SELECT * FROM blocked_numbers WHERE user_id=? ORDER BY id',req.user).map(r=>({id:r.id,...store.open(r.data),version:r.version,blocked:!r.deleted}))});
 });
}
