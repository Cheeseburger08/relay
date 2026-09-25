import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { hash } from './store.mjs';
import webpush from 'web-push';

const send=(ws,value)=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(value));};
const states=new Set(['ringing','dialing','active','held','ended']);
const idPattern=/^[\w-]{8,80}$/;
export const RECONNECT_GRACE_MS=60000;
export function registerVoice(app,store,{auth,origin,secure,reconnectGraceMs=RECONNECT_GRACE_MS,healthIntervalMs=1000}) {
  store.db.exec('CREATE TABLE IF NOT EXISTS push_subscriptions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),data TEXT NOT NULL);');
  const phones=new Map(),browsers=new Map(),calls=new Map(),owners=new Map(),pending=new Map();
  const acknowledgments=new Map();
  const recoveries=new Map(),controllers=new Map(),ending=new Map(),reservations=new Map();
  const diagnostics=new Map();
  const trace=(user,event,extra={})=>{const list=diagnostics.get(user)||[];list.push({at:Date.now(),event,...extra});if(list.length>100)list.shift();diagnostics.set(user,list);};
  const publicKey=process.env.VAPID_PUBLIC_KEY,privateKey=process.env.VAPID_PRIVATE_KEY;
  const pushReady=!!(publicKey&&privateKey);
  const view=(user,browser)=>({type:'state',audioHere:!!browser&&owners.get(user)===browser,audioElsewhere:!!browser&&!!owners.get(user)&&owners.get(user)!==browser,online:!!phones.get(user)?.callKnown,call:calls.get(user)||null,claimed:!!owners.get(user),reconnectMs:Math.max(0,(recoveries.get(user)?.deadline||0)-Date.now())});
  const broadcast=user=>{for(const ws of browsers.get(user)||[])send(ws,view(user,ws));};
  const stopMedia=user=>{send(phones.get(user),{type:'media',enabled:false});owners.delete(user);broadcast(user);};
  const command=(user,action,extra={})=>{
    if(!phones.get(user))return;
    const id=randomUUID(),issuedAt=Date.now();
    acknowledgments.set(id,{user,action,issuedAt});
    send(phones.get(user),{type:'command',id,action,issuedAt,expires:issuedAt+(action==='dtmf'?1000:10000),...extra});
  };
  function recover(user,reason){
    const call=calls.get(user);
    if(!call||ending.has(user)||call.state==='ended'||(!controllers.has(user)&&!owners.has(user)))return;
    trace(user,'recovery',{reason});
    let recovery=recoveries.get(user);
    if(!recovery||recovery.callId!==call.id){recovery={callId:call.id,deadline:Date.now()+reconnectGraceMs};recoveries.set(user,recovery);}
    send(phones.get(user),{type:'media',enabled:false,recover:true,callId:call.id,remainingMs:Math.max(0,recovery.deadline-Date.now())});
    owners.delete(user);broadcast(user);
    for(const b of browsers.get(user)||[])send(b,{type:'recovering',message:reason,remainingMs:Math.max(0,recovery.deadline-Date.now())});
  }
  const dataChanged=user=>{for(const ws of browsers.get(user)||[])send(ws,{type:"data_changed"});};
  async function push(user,payload,ttl=30) {
    if(!pushReady)return;
    await Promise.all(store.all('SELECT * FROM push_subscriptions WHERE user_id=?',user).map(async row=> {
      try { await webpush.sendNotification(store.open(row.data),JSON.stringify(payload),{TTL:ttl,urgency:'high',timeout:10000,vapidDetails:{subject:origin,publicKey,privateKey}}); trace(user,"push_accepted",{kind:payload.type||"call"}); }
      catch(e){trace(user,'push_failed',{kind:payload.type||'call',status:e.statusCode||null});if([404,410].includes(e.statusCode))store.run('DELETE FROM push_subscriptions WHERE id=?',row.id);}
    }));
  }
  const notify=(user,call)=>push(user,{type:'call',body:`SIM ${call.sim||'unknown'} is ringing. Open Relay to answer.`,callId:call.id});
  const notifySms=(user,sms)=>push(user,{type:'sms',body:`New message on SIM ${sms.sim}. Open Relay to read it.`,conversationId:sms.conversationId},3600);
  app.get('/api/voice',auth,(req,res)=>res.json({...view(req.user),pushKey:pushReady?publicKey:null}));
  app.get('/api/voice/diagnostics',auth,(req,res)=>res.json({events:diagnostics.get(req.user)||[]}));
  app.post('/api/voice/push',auth,(req,res)=>{
    const s=req.body;
    let u;try{u=new URL(s.endpoint);}catch{return res.status(400).json({error:{message:'Invalid push subscription'}});}
    const host=u.hostname;
    if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||
      !(host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host.endsWith('.push.apple.com')||host.endsWith('.notify.windows.com'))||
      !/^[\w-]{80,180}$/.test(s.keys?.p256dh||'')||!/^[\w-]{16,80}$/.test(s.keys?.auth||''))return res.status(400).json({error:{message:'Unsupported push subscription'}});
    const id=hash(s.endpoint),existing=store.get('SELECT user_id FROM push_subscriptions WHERE id=?',id);
    if(existing&&existing.user_id!==req.user)return res.sendStatus(409);
    if(!existing&&store.all('SELECT id FROM push_subscriptions WHERE user_id=?',req.user).length>=10)return res.sendStatus(429);
    store.run('INSERT INTO push_subscriptions(id,user_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',id,req.user,store.seal({endpoint:s.endpoint,keys:s.keys}));res.sendStatus(204);
  });
  app.post('/api/voice/push/status',auth,(req,res)=>{
    const endpoint=req.body?.endpoint;
    res.json({enabled:typeof endpoint==='string'&&!!store.get('SELECT id FROM push_subscriptions WHERE id=? AND user_id=?',hash(endpoint),req.user)});
  });
  app.delete('/api/voice/push',auth,(req,res)=>{
    if(typeof req.body?.endpoint!=='string')return res.sendStatus(400);
    store.run('DELETE FROM push_subscriptions WHERE id=? AND user_id=?',hash(req.body.endpoint),req.user);res.sendStatus(204);
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
  function browserAuth(req){const name=secure?'__Host-relay':'relay_session';const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);return token?store.get('SELECT * FROM sessions WHERE token=? AND expires>?',hash(token),Date.now()):null;}
  function deviceAuth(req){const token=req.headers.authorization?.match(/^Bearer ([\w-]{43})$/)?.[1];return token?store.get('SELECT * FROM devices WHERE token=?',hash(token)):null;}
  function attach(server){
    server.on('upgrade',(req,socket,head)=>{
      const device=req.url==='/api/voice/device',browser=req.url==='/api/voice/browser';
      if(!device&&!browser){socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');return;}
      const identity=device?deviceAuth(req):(req.headers.origin===origin?browserAuth(req):null);
      if(!identity){socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;}
      wss.handleUpgrade(req,socket,head,ws=>{ws.user=identity.user_id;ws.device=device;ws.req=req;wss.emit('connection',ws);});
    });
  }
  wss.on('connection',ws=>{
    const user=ws.user;ws.alive=true;ws.lastAudio=Date.now();ws.window=Date.now();ws.count=0;
    if(ws.device){const previous=phones.get(user);if(previous)recover(user,'Phone connection interrupted; reconnecting.');phones.set(user,ws);ws.callKnown=false;previous?.close(1000,'Replaced');}
    else{const set=browsers.get(user)||new Set();if(set.size>=5){ws.close();return;}set.add(ws);browsers.set(user,set);}
    if(ws.device)send(ws,{type:'hello',serverTime:Date.now()});
    broadcast(user);
    ws.on('pong',()=>{ws.alive=true;});
    ws.on('message',(data,binary)=>{
      if(Date.now()-ws.window>=1000){ws.window=Date.now();ws.count=0;}
      if(++ws.count>400){trace(user,'rate_limit',{side:ws.device?'phone':'browser'});ws.close(1008,'Rate limit');return;}
      if(binary){
        if(ws.device&&phones.get(user)!==ws)return;
        if(data.length!==640){ws.close(1008,'Invalid audio');return;}
        const target=ws.device?owners.get(user):(owners.get(user)===ws?phones.get(user):null);
        if(calls.get(user)?.state!=='active'||!target)return;
        // A brief backlog drops late speech, not the working call connection.
        // Only successfully forwarded packets count toward media health.
        if(target.bufferedAmount>6400){if(Date.now()-(ws.lastDrop||0)>5000){trace(user,'backpressure',{side:ws.device?'downlink':'uplink',queuedBytes:target.bufferedAmount});ws.lastDrop=Date.now();}return;}
        if(target.readyState!==WebSocket.OPEN)return;
        ws.lastAudio=Date.now();
        ws.receivedAudio=true;
        if(target.readyState===WebSocket.OPEN)target.send(data);
        const phone=phones.get(user),owner=owners.get(user);
        if(phone?.receivedAudio&&owner?.receivedAudio&&!phone.restored){phone.restored=true;recoveries.delete(user);send(phone,{type:'media_restored',callId:calls.get(user)?.id});broadcast(user);}
        return;
      }
      let msg;try{msg=JSON.parse(data.toString());}catch{ws.close(1008,'Invalid message');return;}
      if(!msg||typeof msg!=='object'||Array.isArray(msg)){ws.close(1008,'Invalid message');return;}
      if(ws.device){
        if(phones.get(user)!==ws)return;
        if(msg.type==='command_result'){
          const request=acknowledgments.get(msg.id);
          if(!request||request.user!==user)return;
          acknowledgments.delete(msg.id);
          if(!msg.accepted){
            const errors={expired:'The call command expired before the phone could act. Please try again.',permission:'Android denied the call command. Check Relay phone permissions.',unavailable:'The phone could not perform this action. The call or SIM may no longer be available.',duplicate:'This call command was already received.'};
            for(const b of browsers.get(user)||[])send(b,{type:'error',message:errors[msg.code]||'The phone rejected the call command.'});
            send(ws,{type:'sync'});
          }else for(const b of browsers.get(user)||[])send(b,{type:'command_accepted',action:request.action});
          return;
        }
        if(msg.type==='state'){
          ws.callKnown=true;
          pending.delete(user);
          const c=msg.call,old=calls.get(user);
          if(c===null){calls.delete(user);recoveries.delete(user);controllers.delete(user);reservations.delete(user);ending.delete(user);stopMedia(user);return;}
          if(!c||!idPattern.test(c.id)||!states.has(c.state)||![0,1,2].includes(c.sim)||typeof c.number!=='string'||c.number.length>40)return;
          const call={id:c.id,state:c.state,sim:c.sim,number:c.number};
          if(old?.id!==c.id){recoveries.delete(user);reservations.delete(user);ending.delete(user);}
          if(old?.id!==c.id&&owners.has(user))stopMedia(user);
          calls.set(user,call);
          if(c.state==='ringing'&&(old?.id!==c.id||old?.state!=='ringing'))void notify(user,call);
          if(c.state==='ended'){recoveries.delete(user);controllers.delete(user);reservations.delete(user);ending.delete(user);}
          if(c.state!=='active')stopMedia(user);
          if(ending.get(user)===c.id)command(user,'hangup',{callId:c.id});
          broadcast(user);
        } else if(msg.type==='media_error'){
          const reason=['player_error','player_exit','status_error','writer_error','capture_error'].includes(msg.reason)?msg.reason:'unspecified';
          trace(user,'phone_audio_error',{reason});
          recover(user,'Phone audio interrupted; retrying while keeping the call connected.');
        } else if(msg.type==='command_error'){
          if(msg.action==='dial'&&pending.has(user)){pending.delete(user);calls.delete(user);}
          for(const b of browsers.get(user)||[])send(b,{type:'error',message:'The phone could not complete the call command.'});broadcast(user);
        }
        return;
      }
      const call=calls.get(user);
      if(msg.type==='hangup'&&call&&msg.callId===call.id){recoveries.delete(user);ending.set(user,call.id);stopMedia(user);command(user,'hangup',{callId:call.id});if(!phones.get(user))send(ws,{type:'error',message:'End requested. Waiting for the phone connection to return.'});return;}
      if(!phones.get(user)){send(ws,{type:'error',message:'Phone is offline.'});return;}
      if(msg.type==='check'){command(user,'check');return;}
      if(msg.type==='dial'){
        if(call&&call.state!=='ended'){send(ws,{type:'error',message:'A call is already in progress.'});return;}
        if(!/^\+[1-9]\d{6,14}$/.test(msg.number)||![1,2].includes(msg.sim))return;
        // Mark pending immediately to prevent duplicate paid outgoing calls.
        calls.set(user,{id:randomUUID(),state:'dialing',number:msg.number,sim:msg.sim});controllers.set(user,ws);pending.set(user,Date.now());broadcast(user);command(user,'dial',{number:msg.number,sim:msg.sim});return;
      }
      if(!call||msg.callId!==call.id)return;
      if(msg.type==='dtmf'&&call.state==='active'&&owners.get(user)===ws&&typeof msg.digit==='string'&&/^[0-9*#]$/.test(msg.digit)){
        if(Date.now()-(ws.lastTone||0)<150)return;ws.lastTone=Date.now();command(user,'dtmf',{callId:call.id,digit:msg.digit});return;
      }
      if(msg.type==='answer'&&call.state==='ringing'){controllers.set(user,ws);command(user,'answer',{callId:call.id});}
      if((msg.type==='attach'||msg.type==='takeover')&&call.state==='active'){
        if(!phones.get(user).callKnown||ending.has(user))return;
        const takeover=msg.type==='takeover',previous=owners.get(user);
        const clientId=typeof msg.clientId==='string'&&idPattern.test(msg.clientId)?msg.clientId:null;
        if(takeover&&!clientId)return;
        const reservation=reservations.get(user);
        if(!takeover&&((reservation?.callId===call.id&&reservation.clientId!==clientId)||ws.yieldedCallId===call.id)){
          send(ws,{type:'audio_taken',callId:call.id,message:'Call audio moved to another browser. Use audio here to take it back.'});return;
        }
        if(!takeover&&previous&&previous!==ws){send(ws,{type:'error',message:'Another browser is using this call. Choose Use audio here to move it.'});return;}
        if(previous===ws){send(ws,{type:'media_ready'});return;}
        if(takeover){
          reservations.set(user,{callId:call.id,clientId});ws.yieldedCallId=null;
          for(const other of browsers.get(user)||[])if(other!==ws){
            other.yieldedCallId=call.id;
            // pause also silences pre-update clients before the ownership notice.
            send(other,{type:'state',...view(user,other),claimed:false,audioHere:false,audioElsewhere:true});
            send(other,{type:'audio_taken',callId:call.id,message:'Call audio moved to another browser. Use audio here to take it back.'});
          }
          trace(user,'audio_transferred');
        }else trace(user,'audio_attached');
        owners.set(user,ws);controllers.set(user,ws);ws.lastAudio=Date.now();ws.receivedAudio=false;
        const phone=phones.get(user);phone.receivedAudio=false;phone.restored=false;phone.lastAudio=Date.now();
        // A browser handoff reuses the working phone stream; only a detached stream needs starting.
        if(!previous)send(phone,{type:'media',enabled:true,callId:call.id});
        send(ws,{type:'media_ready'});broadcast(user);
      }
      if((msg.type==='detach'||msg.type==='pause')&&(owners.get(user)===ws||controllers.get(user)===ws))recover(user,'Audio connection interrupted; reconnecting.');
    });
    ws.on('error',()=>{});
    ws.on('close',(code)=>{
      trace(user,'socket_closed',{side:ws.device?'phone':'browser',code});
      if(ws.device&&phones.get(user)===ws){recover(user,'Phone disconnected; waiting for reconnection.');phones.delete(user);if(!recoveries.has(user)&&!ending.has(user))calls.delete(user);owners.delete(user);pending.delete(user);for(const [id,r] of acknowledgments)if(r.user===user)acknowledgments.delete(id);}
      if(!ws.device){browsers.get(user)?.delete(ws);if(owners.get(user)===ws||controllers.get(user)===ws)recover(user,'Browser disconnected; waiting for reconnection.');}
      broadcast(user);
    });
  });
  const heartbeat=setInterval(()=>{
    for(const ws of wss.clients){
      const valid=ws.device?deviceAuth(ws.req):browserAuth(ws.req);
      if(!valid||!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();if(ws.device)send(ws,{type:'hello',serverTime:Date.now()});
    }
  },15000);heartbeat.unref();
  const mediaHealth=setInterval(()=>{
    for(const [user,ws] of owners)if(Date.now()-ws.lastAudio>5000||Date.now()-(phones.get(user)?.lastAudio||0)>5000)recover(user,'Audio stream interrupted; reconnecting.');
    for(const [user,recovery] of recoveries)if(Date.now()>=recovery.deadline){recoveries.delete(user);ending.set(user,recovery.callId);stopMedia(user);command(user,'hangup',{callId:recovery.callId});for(const b of browsers.get(user)||[])send(b,{type:'recovery_expired',message:'Audio did not recover within 60 seconds. Ending the call.'});}
    for(const [user,at] of pending)if(Date.now()-at>15000){pending.delete(user);phones.get(user)?.close(1011,'Call state timeout');}
    for(const [id,r] of acknowledgments)if(Date.now()-r.issuedAt>11000){acknowledgments.delete(id);for(const b of browsers.get(r.user)||[])send(b,{type:'error',message:'The phone did not confirm the call command. Check its connection before trying again.'});send(phones.get(r.user),{type:'sync'});}
  },healthIntervalMs);mediaHealth.unref();
  return {attach,notifySms,dataChanged,available:user=>({liveCalls:phones.has(user),push:pushReady}),close(){clearInterval(heartbeat);clearInterval(mediaHealth);for(const ws of wss.clients)ws.terminate();wss.close();}};
}
