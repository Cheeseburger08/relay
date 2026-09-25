import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as wait} from 'node:timers/promises';
import {createStore,hash} from '../server/store.mjs';
import {registerPushTests} from '../server/push-tests.mjs';

test('background notification tests are targeted, authenticated, cancelable and acknowledged without a login',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'relay-push-test-')),store=createStore(dir),origin='https://relay.test';
 const owner=store.createUser('one','One','synthetic-password'),other=store.createUser('two','Two','synthetic-password');
 store.db.exec('CREATE TABLE push_subscriptions(id TEXT PRIMARY KEY,user_id TEXT,data TEXT)');
 const endpoints=['https://fcm.googleapis.com/fixture-one','https://fcm.googleapis.com/fixture-two','https://fcm.googleapis.com/fixture-three'];
 for(const endpoint of endpoints)store.run('INSERT INTO push_subscriptions VALUES(?,?,?)',hash(endpoint),owner,store.seal({endpoint}));
 const app=express();app.use(express.json());
 const auth=(req,res,next)=>{if(![owner,other].includes(req.get('X-Test-User'))||req.get('X-CSRF-Token')!=='synthetic')return res.sendStatus(401);req.user=req.get('X-Test-User');next();};
 const sent=[];
 const service=registerPushTests(app,store,{auth,origin,delayMs:50,send:async(row,payload)=>{sent.push({row,payload});}});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const request=(path,body,user=owner,extra={})=>fetch(`http://127.0.0.1:${server.address().port}/api/voice/push/`+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'X-Test-User':user,'X-CSRF-Token':'synthetic',...extra},body:JSON.stringify(body)});
 try{
 assert.equal((await request('test',{endpoint:endpoints[0]},'anonymous')).status,401);
 assert.equal((await request('test',{endpoint:endpoints[0]},other)).status,409);
 const scheduled=await request('test',{endpoint:endpoints[0]});assert.equal(scheduled.status,202);
 assert.equal((await scheduled.json()).test.state,'scheduled');
 assert.equal((await request('test',{endpoint:endpoints[0]})).status,429);
 assert.equal(service.status(other,hash(endpoints[0])),null);
 for(let n=0;n<30&&sent.length<1;n++)await wait(10);
 assert.equal(sent.length,1);assert.equal(sent[0].row.id,hash(endpoints[0]));
 assert.equal(sent[0].payload.type,'test');
 const state=service.status(owner,hash(endpoints[0]));assert.equal(state.state,'accepted');assert.equal(state.receipt,undefined);
 const receipt=sent[0].payload.receipt;
 assert.equal((await request('receipt',{receipt},'anonymous',{Origin:'https://evil.test'})).status,403);
 assert.equal((await request('receipt',{receipt:'x'.repeat(43)},'anonymous')).status,404);
 assert.equal((await request('receipt',{receipt},'anonymous')).status,204);
 const displayed=service.status(owner,hash(endpoints[0]));assert.equal(displayed.state,'displayed');assert.ok(displayed.displayedAt>=displayed.sentAt);
 assert.equal((await request('receipt',{receipt},'anonymous')).status,204);
 assert.equal(service.status(owner,hash(endpoints[0])).displayedAt,displayed.displayedAt);
 await request('test',{endpoint:endpoints[1]});service.cancel(owner,hash(endpoints[1]));await wait(70);assert.equal(sent.length,1);assert.equal(service.status(owner,hash(endpoints[1])).state,'cancelled');
 await request('test',{endpoint:endpoints[2]});service.close();await wait(70);assert.equal(sent.length,1);
 }finally{service.close();await new Promise(resolve=>server.close(resolve));store.db.close();rmSync(dir,{recursive:true,force:true});}
});
