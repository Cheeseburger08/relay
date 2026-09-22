import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/client.js', ['client.js', 'text/javascript']],
  ['/worklet.js', ['worklet.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
]);
const equal = (a, b) => {
  if(typeof a !== 'string') return false;
  const aa=Buffer.from(a), bb=Buffer.from(b);
  return aa.length===bb.length && timingSafeEqual(aa,bb);
};

/** Dedicated loopback audio lab; never mounted on Relay's public application. */
export async function createLab({ bridgeFactory, port = 0 }) {
  let origin, active;
  let bootstrap = randomBytes(32).toString('hex');
  const cookie = randomBytes(32).toString('hex');
  const authorized = req => (req.headers.cookie || '').split(';').some(v => equal(v.trim(), `relay_audio_lab=${cookie}`));
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'microphone=(self), camera=()');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ${origin.replace('http:', 'ws:')}; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`);
    if (req.headers.host !== new URL(origin).host) { res.writeHead(403).end(); return; }
    if (req.method === 'POST' && req.url === '/unlock') {
      if (req.headers.origin !== origin) { res.writeHead(403).end(); return; }
      let body = '';
      try {
        for await (const chunk of req) {
          body += chunk.toString();
          if (body.length > 128) { res.writeHead(413).end(); return; }
        }
        if (!bootstrap || !equal(body, bootstrap)) { res.writeHead(401).end(); return; }
        bootstrap = null;
        res.setHeader('Set-Cookie', `relay_audio_lab=${cookie}; HttpOnly; SameSite=Strict; Path=/`);
        res.writeHead(204).end();
      } catch { if (!res.headersSent) res.writeHead(400).end(); }
      return;
    }
    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(authorized(req) ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ authorized: authorized(req) })); return;
    }
    const asset = assets.get(req.url);
    if (req.method !== 'GET' || !asset) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` });
    res.end(readFileSync(new URL(asset[0], import.meta.url)));
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 640, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/audio' || req.headers.host !== new URL(origin).host || req.headers.origin !== origin || !authorized(req) || active) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => { active = ws; wss.emit('connection', ws); });
  });
  wss.on('connection', ws => {
    let bridge, started = false, ended = false, ready = false;
    let up = 0, down = 0, lastMic = Date.now(), windowAt = Date.now(), frames = 0;
    const send = data => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
    const stop = reason => {
      if (ended) return; ended = true;
      clearTimeout(deadline); clearInterval(health);
      send({ type: 'ended', reason });
      bridge?.stop(); ws.close();
      // Do not allow a new session until native cleanup finishes.
      Promise.resolve(bridge?.closed).finally(() => { if (active === ws) active = null; });
    };
    const deadline = setTimeout(() => stop('Two-minute test limit reached.'), 120000);
    const health = setInterval(() => {
      if (!started || (ready && Date.now() - lastMic > 2500)) return stop('Browser microphone stream stopped.');
      send({ type: 'stats', up, down });
    }, 1000);
    ws.on('message', (data, binary) => {
      if (ended) return;
      if (!started) {
        let message; try { message = JSON.parse(data.toString()); } catch { return stop('Invalid start request.'); }
        if (binary || message.type !== 'start' || !['first', 'second'].includes(message.route)) return stop('Invalid route.');
        started = true;
        try {
          bridge = bridgeFactory(message.route, {
            onReady: () => { ready = true; lastMic = Date.now(); send({ type: 'ready' }); },
            onPcm: pcm => {
              if (ended) return;
              if (ws.bufferedAmount > 16000) return stop('Playback fell behind; stopped to avoid delayed audio.');
              down += pcm.length; ws.send(pcm);
            },
            onEnd: reason => stop(reason),
          });
        } catch { stop('Phone connection could not start.'); }
        return;
      }
      if (!binary || data.length !== 640) return stop('Invalid audio frame.');
      if (Date.now() - windowAt >= 1000) { windowAt = Date.now(); frames = 0; }
      if (++frames > 100) return stop('Audio arrived too quickly.');
      if (ready) { lastMic = Date.now(); up += data.length; try { bridge.feed(data); } catch { stop('Phone playback failed.'); } }
    });
    ws.on('close', () => stop('Browser disconnected.'));
    ws.on('error', () => stop('Browser connection failed.'));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, launchUrl: `${origin}/#${bootstrap}`,
    close: async () => { active?.terminate(); wss.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
