const $=id=>document.getElementById(id);
let ws,session,state={online:false,call:null},audio,wantAudio=false,reconnect,ringContext,ringTimer,pushKey;
const message=text=>{$('message').textContent=text;};
const send=value=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(value));};
function stopAudio(){const old=audio;audio=null;wantAudio=false;if(old){old.stream?.getTracks().forEach(t=>t.stop());old.node?.disconnect();old.ctx?.close().catch(()=>{});}$('mute').hidden=true;$('mic').value=0;$('caller-level').value=0;}
async function prepareAudio(){
  if(audio)return !!audio.node;const a={};audio=a;
  try{
    a.ctx=new AudioContext({sampleRate:16000,latencyHint:'interactive'});await a.ctx.resume();
    a.stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    if(audio!==a){a.stream.getTracks().forEach(t=>t.stop());return;}
    if(a.ctx.sampleRate!==16000)throw new Error('Unsupported audio sample rate');
    await a.ctx.audioWorklet.addModule('/voice-worklet.js');if(audio!==a)return;
    a.node=new AudioWorkletNode(a.ctx,'relay-pcm',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
    a.gain=a.ctx.createGain();a.gain.gain.value=Number($('volume').value);
    a.source=a.ctx.createMediaStreamSource(a.stream);a.source.connect(a.node);a.node.connect(a.gain).connect(a.ctx.destination);
    a.node.port.onmessage=({data})=>{
      if(audio!==a)return;
      if(data.type==='mic'&&a.attached&&ws?.readyState===WebSocket.OPEN){if(ws.bufferedAmount>16000){send({type:'detach',callId:state.call?.id});stopAudio();message('Network fell behind; call stopped.');return;}ws.send(data.buffer);}
      if(data.type==='levels'){$('mic').value=data.mic;$('caller-level').value=data.caller;}
      if(data.type==='error'){send({type:'detach',callId:state.call?.id});stopAudio();message(data.message);}
    };
    a.node.onprocessorerror=()=>{send({type:'detach',callId:state.call?.id});stopAudio();message('Browser audio stopped.');};
    a.stream.getTracks().forEach(t=>t.onended=()=>{if(audio===a){send({type:'detach',callId:state.call?.id});stopAudio();}});
    $('mute').hidden=false;wantAudio=true;return true;
  }catch(e){stopAudio();throw e;}
}
function render(){
  const c=state.call;
  $('connection').textContent=state.online?'Xperia connected':'Xperia offline — calls unavailable';
  $('call-title').textContent=c?c.state==='ringing'?'Incoming call':c.state==='ended'?'Call ended':'Cellular call':'No call in progress';
  $('caller').textContent=c?`${c.number||'Unknown caller'} · SIM ${c.sim||'unknown'}`:'';
  $('call-state').textContent=c?c.state:'';
  $('answer').hidden=c?.state!=='ringing';$('hangup').hidden=!c||c.state==='ended';
  $('attach').hidden=c?.state!=='active'||!!audio?.attached;
  $('dial').disabled=!state.online||!!(c&&c.state!=='ended');
  clearInterval(ringTimer);
  if(c?.state==='ringing'&&ringContext?.state==='running')ringTimer=setInterval(()=>{const oscillator=ringContext.createOscillator(),gain=ringContext.createGain();oscillator.frequency.value=660;gain.gain.value=.025;oscillator.connect(gain).connect(ringContext.destination);oscillator.start();oscillator.stop(ringContext.currentTime+.18);},1400);
  if(!c||c.state==='ended'){stopAudio();return;}
  if(c.state==='active'&&wantAudio&&audio&&!audio.requested){audio.requested=true;send({type:'attach',callId:c.id});}
}
function connect(){
  ws=new WebSocket(`${location.origin.replace('http','ws')}/api/voice/browser`);ws.binaryType='arraybuffer';
  ws.onmessage=({data})=>{
    if(typeof data!=='string'){if(audio?.attached){audio.node.port.postMessage({type:'pcm',buffer:data},[data]);if(!audio.received){audio.received=true;message('Live phone audio received.');}}return;}
    const msg=JSON.parse(data);
    if(msg.type==='state'){if(audio?.attached&&(!msg.claimed||msg.call?.id!==state.call?.id))stopAudio();state=msg;render();}
    if(msg.type==='media_ready'&&audio){audio.attached=true;message('Starting phone audio…');render();}
    if(msg.type==='error'){message(msg.message);stopAudio();render();}
  };
  ws.onclose=()=>{stopAudio();state={online:false,call:null};render();$('connection').textContent='Connection lost; reconnecting…';reconnect=setTimeout(async()=>{const r=await fetch('/api/session');if(r.ok)connect();else location.href='/';},3000);};
  ws.onerror=()=>{};
}
$('answer').onclick=async()=>{const id=state.call?.id;try{if(!await prepareAudio()||state.call?.id!==id||state.call?.state!=='ringing')return;send({type:'answer',callId:id});message('Answering…');}catch{message('Microphone access is required to answer.');}};
$('attach').onclick=async()=>{try{await prepareAudio();render();}catch{message('Could not open the microphone.');}};
$('dial').onclick=async()=>{const number=$('number').value.trim();if(!/^\+[1-9]\d{6,14}$/.test(number)){message('Enter an international phone number, including +.');return;}try{if(!await prepareAudio())return;send({type:'dial',number,sim:Number($('sim').value)});message('Calling…');}catch{message('Microphone access is required to call.');}};
$('hangup').onclick=()=>{send({type:'hangup',callId:state.call?.id});stopAudio();message('Ending call…');};
$('mute').onclick=()=>{if(!audio)return;audio.muted=!audio.muted;audio.node.port.postMessage({type:'mute',value:audio.muted});$('mute').textContent=audio.muted?'Unmute microphone':'Mute microphone';};
$('volume').oninput=()=>{if(audio?.gain)audio.gain.gain.value=Number($('volume').value);};
$('notify').onclick=async()=>{
  try{
    ringContext??=new AudioContext();await ringContext.resume();
    if(!('PushManager'in window)||!('serviceWorker'in navigator)||!pushKey)throw new Error('Push is unavailable here. On iPhone, open Relay from the Home Screen.');
    if(await Notification.requestPermission()!=='granted')throw new Error('Notification permission was not granted.');
    await navigator.serviceWorker.register('/voice-sw.js',{scope:'/'});const registration=await navigator.serviceWorker.ready;
    const key=Uint8Array.from(atob(pushKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    const result=await fetch('/api/voice/push',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify(subscription)});
    if(!result.ok)throw new Error('Push subscription could not be saved.');$('push-status').textContent='Notifications enabled. Tap an incoming-call notification to open Relay and answer.';
  }catch(e){$('push-status').textContent=e.message;}
};
window.addEventListener('pagehide',()=>{clearTimeout(reconnect);clearInterval(ringTimer);stopAudio();ws?.close();});
try{const response=await fetch('/api/session');if(!response.ok){location.href='/';}else{session=await response.json();const info=await(await fetch('/api/voice')).json();pushKey=info.pushKey;state=info;render();connect();}}catch{$('connection').textContent='Could not reach Relay. Reload to retry.';}
