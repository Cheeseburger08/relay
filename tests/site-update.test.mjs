import {test} from 'node:test';
import assert from 'node:assert/strict';
import {watchSiteUpdate} from '../src/site-update.js';

test('update check tolerates offline HTML and announces a new build once without navigating',async t=>{
 const original={document:globalThis.document,fetch:globalThis.fetch};
 const listeners=new Map();let html='',fail=true,announcements=0,checks=0;
 globalThis.document={scripts:[{getAttribute:()=>'/assets/index-old.js'}],visibilityState:'visible',addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:n=>listeners.delete(n)};
 globalThis.fetch=async(_url,options)=>{checks++;assert.equal(options.cache,'no-store');assert.equal(options.credentials,'omit');if(fail)throw Error('Offline');return {ok:true,text:async()=>html};};
 const stop=watchSiteUpdate(()=>announcements++);
 t.after(()=>{stop();Object.assign(globalThis,original);});
 await new Promise(r=>setImmediate(r));assert.equal(announcements,0);
 fail=false;html='<html>temporary proxy error</html>';await listeners.get('visibilitychange')();assert.equal(announcements,0);
 html='<script type="module" src="/assets/index-old.js"></script>';await listeners.get('visibilitychange')();assert.equal(announcements,0);
 html='<script type="module" src="/assets/index-new.js"></script>';await listeners.get('visibilitychange')();assert.equal(announcements,1);
 const count=checks;await listeners.get('visibilitychange')();assert.equal(checks,count);assert.equal(announcements,1);
 stop();assert.equal(listeners.size,0);
});
