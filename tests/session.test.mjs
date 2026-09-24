import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore,hash} from '../server/store.mjs';
import {createApp} from '../server/app.mjs';
test('persistent sessions renew only valid authorized requests and logout revokes them',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'relay-session-')),store=createStore(directory);
 store.createUser('fixture','Fixture','synthetic-password');
 const origin='https://relay.example',app=createApp(store,{origin,secure:true}),server=app.listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 try{
 const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'fixture',password:'synthetic-password'})});
 const header=login.headers.get('set-cookie'),cookie=header.split(';')[0],token=cookie.split('=')[1],{csrf}=await login.json();
 assert.match(header,/Max-Age=2592000/);assert.match(header,/HttpOnly/);assert.match(header,/Secure/);assert.match(header,/SameSite=Strict/);
 const request=(path,options={})=>fetch(base+path,{...options,headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':csrf,...options.headers}});
 assert.equal((await request('/api/session')).headers.get('set-cookie'),null,'fresh sessions do not churn cookies');
 store.run('UPDATE sessions SET expires=? WHERE token=?',Date.now()+3600000,hash(token));
 const invalid=await request('/api/logout',{method:'POST',headers:{'X-CSRF-Token':'invalid'}});
 assert.equal(invalid.status,403);assert.equal(invalid.headers.get('set-cookie'),null);
 const renewed=await request('/api/session');assert.equal(renewed.status,200);assert.match(renewed.headers.get('set-cookie'),/Max-Age=2592000/);
 assert.ok(store.get('SELECT expires FROM sessions WHERE token=?',hash(token)).expires>Date.now()+29*86400000);
 const logout=await request('/api/logout',{method:'POST'});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Expires=Thu, 01 Jan 1970/);
 assert.equal((await request('/api/session')).status,401);
 store.run('INSERT INTO sessions VALUES(?,?,?,?)',hash(token),store.get('SELECT id FROM users WHERE username=?','fixture').id,csrf,Date.now()-1);
 assert.equal((await request('/api/session')).status,401,'expired sessions cannot renew');
 }finally{app.locals.voice.close();await new Promise(r=>server.close(r));store.db.close();rmSync(directory,{recursive:true,force:true});}
});
