const $=id=>document.getElementById(id);
let allowed=false,session=null;
function status(text){$('status').textContent=text;}
function stop(reason='Audio stopped. The cellular call remains connected.'){
  const old=session; session=null;
  if(old){old.stream?.getTracks().forEach(track=>track.stop());old.socket?.close();old.node?.disconnect();old.source?.disconnect();old.context?.close().catch(()=>{});}
  $('start').disabled=!allowed;$('stop').disabled=true;$('mute').disabled=true;$('route').disabled=false;
  $('mute').textContent='Mute microphone';$('mic').value=0;$('caller').value=0;status(reason);
}
async function start(){
  if(session||!allowed)return;
  const current={}; session=current;
  $('start').disabled=true;$('stop').disabled=false;$('route').disabled=true;
  status('Allow microphone access, then keep the Xperia test screen open.');
  try{
    current.context=new AudioContext({sampleRate:16000,latencyHint:'interactive'});
    await current.context.resume();
    current.stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    current.inputLatency=current.stream.getAudioTracks()[0]?.getSettings().latency;
    current.maxHandoff=0;
    if(session!==current){current.stream.getTracks().forEach(t=>t.stop());return;}
    if(current.context.sampleRate!==16000)throw new Error('This browser does not support the test sample rate.');
    await current.context.audioWorklet.addModule('/worklet.js');
    if(session!==current)return;
    current.node=new AudioWorkletNode(current.context,'relay-pcm',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
    current.gain=current.context.createGain(); current.gain.gain.value=Number($('volume').value);
    current.source=current.context.createMediaStreamSource(current.stream);
    current.source.connect(current.node);current.node.connect(current.gain).connect(current.context.destination);
    const ws=current.socket=new WebSocket(`${location.origin.replace('http:','ws:')}/audio`);
    ws.binaryType='arraybuffer';
    ws.onopen=()=>{if(session!==current)return;ws.send(JSON.stringify({type:'start',route:$('route').value}));status('Connecting to the Xperia’s enabled live test…');};
    ws.onmessage=({data})=>{
      if(session!==current)return;
      if(typeof data!=='string'){current.node.port.postMessage({type:'pcm',buffer:data},[data]);return;}
      const message=JSON.parse(data);
      if(message.type==='ready'){current.ready=true;$('mute').disabled=false;status('Audio stream connected. Speak to the caller and check both directions.');}
      if(message.type==='ended')stop(message.reason);
      if(message.type==='stats')$('stats').textContent=`Microphone sent: ${(message.up/32000).toFixed(1)} s · Caller received: ${(message.down/32000).toFixed(1)} s. Counters do not prove audibility.`;
    };
    ws.onclose=()=>{if(session===current)stop('Connection closed. Re-enable the Xperia live test before restarting.');};
    ws.onerror=()=>{if(session===current)stop('Connection failed. Check USB and the Xperia test screen.');};
    current.node.port.onmessage=({data})=>{
      if(session!==current)return;
      if(data.type==='mic'&&current.ready&&ws.readyState===WebSocket.OPEN){
        current.maxHandoff=Math.max(current.maxHandoff,Math.max(0,current.context.currentTime-data.captureAt)*1000);
        if(ws.bufferedAmount>6400)return stop('Microphone stream fell behind. Restart the test.');
        ws.send(data.buffer);
      }
      if(data.type==='levels'){
        $('mic').value=data.mic;$('caller').value=data.caller;
        const ms=value=>Number.isFinite(value)?`${Math.round(value*1000)} ms`:'not reported';
        $('latency').textContent=`Reported input: ${ms(current.inputLatency)} · Browser base: ${ms(current.context.baseLatency)} · Output: ${ms(current.context.outputLatency)} · Caller queue: ${Math.round(data.queuedMs)} ms · Largest worklet handoff: ${Math.round(current.maxHandoff)} ms · Outgoing socket queue: ${Math.round(ws.bufferedAmount/32)} ms. Excludes cellular-network delay.`;
      }
      if(data.type==='error')stop(data.message);
    };
    current.node.onprocessorerror=()=>{if(session===current)stop('Browser audio processing stopped.');};
    current.stream.getTracks().forEach(track=>track.onended=()=>{if(session===current)stop('Microphone disconnected.');});
    current.context.onstatechange=()=>{if(session===current&&current.context.state!=='running')stop('Browser audio was suspended.');};
  }catch(error){if(session===current)stop(error.name==='NotAllowedError'?'Microphone permission is required. Use your browser’s microphone permission control.':`Could not start audio: ${error.message}`);}
}
$('start').onclick=start;$('stop').onclick=()=>stop();
$('volume').oninput=()=>{if(session?.gain)session.gain.gain.value=Number($('volume').value);};
$('mute').onclick=()=>{if(!session?.node)return;session.muted=!session.muted;session.node.port.postMessage({type:'mute',value:session.muted});$('mute').textContent=session.muted?'Unmute microphone':'Mute microphone';};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&session)stop('Test stopped because the browser tab was hidden.');});
window.addEventListener('pagehide',()=>stop());
try{
  const token=location.hash.slice(1);history.replaceState(null,'','/');
  if(token){const response=await fetch('/unlock',{method:'POST',body:token});if(!response.ok)throw new Error('The private launch link expired. Reopen the current link from the laptop.');}
  allowed=(await fetch('/status')).ok;
  $('start').disabled=!allowed;
  status(allowed?'Ready. Enable the Xperia live test during a call, then press Start.':'Open the private launch link prepared on this laptop.');
}catch(error){status(error.message);}
