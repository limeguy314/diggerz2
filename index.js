'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Room } = require('./room');

const PORT = Number(process.env.PORT) || 10000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const room = new Room(process.env.WORLD_NAME || 'Free Dig');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const FORCE_HOST_INJECT = `
<script id="diggerz-force-host">
(function () {
  try {
    var p = new URLSearchParams(location.search);
    if (p.get('local') === '1') { window.__diggerzForceRemote = false; return; }
    // Prefer full offline Dig+Trade logic (mining/inv) on this host.
    // Remote Cr multiplayer is incomplete for dig/build; Dig+Trade works.
    window.__diggerzForceRemote = false;
    window.__diggerzRemoteHost = p.get('server') || location.hostname;
    try { localStorage.removeItem('diggerzServerUrl'); } catch (e) {}
    console.log('[diggerz] Dig+Trade local service (full dig/inv) on', window.__diggerzRemoteHost);
  } catch (e) {}
})();
</script>
<script>
(function () {
  function killLobby() {
    window.DiggerzBeginBackgroundMatchmaking = function () { console.log('[diggerz] lobby disabled'); };
    window.DiggerzOpenPvp22 = function () {};
    try { var el = document.getElementById('diggerz-pvp22'); if (el) el.style.display = 'none'; } catch (e) {}
  }
  killLobby();
  var n = 0;
  var t = setInterval(function () {
    killLobby();
    try {
      if (typeof l !== 'undefined') { l.a44 = true; l.a45 = true; }
      if (typeof q !== 'undefined' && q.player && typeof l !== 'undefined' && l.z39) {
        if (!q.player.l9) q.player.l9 = 90;
        l.z39.l9 = 0.45 + 1.1 * (q.player.l9 || 90) / 100;
      }
    } catch (e) {}
    if (++n > 80) clearInterval(t);
  }, 250);
})();
</script>
`;

function forceOnlineClient(html) {
  // Full offline Dig+Trade mining/inventory/equip logic (proven working)
  html = html.replace(/var useLocalDigTrade = [^;]+;/, 'var useLocalDigTrade = true;');
  html = html.replace(
    'function svc(){return window.Main&&window.Main.diggerzService?window.Main.diggerzService:null}',
    'function svc(){if(window.Main&&window.Main.diggerzService)return window.Main.diggerzService;if(window.DiggerzOnlineAdmin)return window.DiggerzOnlineAdmin;return null}'
  );
  return html;
}

function injectHtml(buf, offlineAllowed) {
  let html = buf.toString('utf8');
  // Always enable Dig+Trade local service for playable dig/build/inv
  html = forceOnlineClient(html);
  if (html.indexOf('admin-bridge.js') === -1) {
    const tag = '<script src="/admin-bridge.js"></script>';
    if (html.indexOf('<head>') !== -1) html = html.replace('<head>', '<head>' + tag, 1);
    else html = tag + html;
  }
  if (html.indexOf('id="diggerz-force-host"') === -1) {
    if (html.indexOf('<head>') !== -1) html = html.replace('<head>', '<head>' + FORCE_HOST_INJECT, 1);
    else html = FORCE_HOST_INJECT + html;
  }
  html = html.replace(
    'function svc(){return window.Main&&window.Main.diggerzService?window.Main.diggerzService:null}',
    'function svc(){if(window.Main&&window.Main.diggerzService)return window.Main.diggerzService;if(window.DiggerzOnlineAdmin)return window.DiggerzOnlineAdmin;return null}'
  );
  return Buffer.from(html, 'utf8');
}

function sendFile(res, filePath, offlineAllowed) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
      res.end(err.code === 'ENOENT' ? 'not found' : 'error');
      return;
    }
    let body = data;
    if (ext === '.html' && path.basename(filePath) === 'index.html') body = injectHtml(data, offlineAllowed);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(body);
  });
}

function resolveStatic(urlPath) {
  let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  for (const fp of [path.join(PUBLIC, rel), path.join(ROOT, rel)]) {
    if ((fp.startsWith(PUBLIC) || fp.startsWith(ROOT)) && fs.existsSync(fp) && fs.statSync(fp).isFile()) return fp;
  }
  return null;
}

const server = http.createServer((req, res) => {
  const rawUrl = req.url || '/';
  const url = rawUrl.split('?')[0];
  const qs = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : '';
  const offlineAllowed = /(^|&)local=1(&|$)/.test(qs);
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'diggerz-server', players: room.players.size, world: room.name }));
    return;
  }
  const filePath = resolveStatic(url);
  if (!filePath) { res.writeHead(404); res.end('not found'); return; }
  sendFile(res, filePath, offlineAllowed);
});

const wss = new WebSocketServer({
  server,
  handleProtocols: (protocols) => { const list = [...protocols]; return list.length ? list[0] : 'diggerz'; },
});

wss.on('connection', (ws) => {
  console.log('client connected', { players: room.players.size + 1 });
  room.addClient(ws);
  room.onOpen(ws);
  ws.on('message', (data) => {
    try { room.onMessage(ws, Buffer.isBuffer(data) ? data : Buffer.from(data)); }
    catch (e) { console.error('packet error', e); }
  });
  ws.on('close', () => { room.removeClient(ws); });
  ws.on('error', (err) => console.error('ws error', err.message));
});

server.listen(PORT, () => {
  console.log('diggerz-server on :' + PORT);
  console.log('Dig+Trade local logic enabled for dig/inv');
});
