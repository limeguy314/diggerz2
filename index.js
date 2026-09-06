'use strict';

/**
 * diggerz-server — flat layout.
 * When serving index.html, rewrites the client so FIGHT always uses this host
 * (binary Cr socket → single shared Room). Offline only with ?local=1.
 */

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
    if (p.get('local') === '1') {
      window.__diggerzForceRemote = false;
      return;
    }
    window.__diggerzForceRemote = true;
    window.__diggerzRemoteHost = p.get('server') || location.hostname;
    try { localStorage.removeItem('diggerzServerUrl'); } catch (e) {}
    console.log('[diggerz] FORCE online →', window.__diggerzRemoteHost);
  } catch (e) {}
})();
</script>
<script>
(function () {
  function killLobby() {
    window.DiggerzBeginBackgroundMatchmaking = function () {
      console.log('[diggerz] lobby disabled');
    };
    window.DiggerzOpenPvp22 = function () {};
    try {
      var el = document.getElementById('diggerz-pvp22');
      if (el) el.style.display = 'none';
    } catch (e) {}
  }
  killLobby();
  var n = 0;
  var t = setInterval(function () {
    killLobby();
    try {
      if (window.__diggerzForceRemote && window.__diggerzRemoteHost && typeof q !== 'undefined') {
        q.SERVER_ADDRESS = window.__diggerzRemoteHost;
      }
    } catch (e) {}
    if (++n > 80) clearInterval(t);
  }, 250);
})();
</script>
`;

/** Rewrite minified client so it cannot choose offline Dig+Trade / recovery room. */
function forceOnlineClient(html) {
  html = html.replace(
    /var useLocalDigTrade = [^;]+;/,
    'var useLocalDigTrade = false; /* server inject: online only */'
  );
  html = html.replace(
    /if \(\(l\.A46 \|\| l\.A45\) && !\(this\.R36 instanceof DiggerzService\)(?: && !window\.__diggerzForceRemote)?\)/g,
    'if (false /* server inject: no offline recovery */)'
  );
  html = html.replace(
    /q\.SERVER_ADDRESS\s*=\s*[^;]+;/,
    'q.SERVER_ADDRESS = (window.__diggerzRemoteHost || location.hostname);'
  );
  if (html.indexOf('Wj.create("wss://" + a + ":443"') !== -1) {
    html = html.replace(
      'Wj.create("wss://" + a + ":443", ["" + c], null, !1);',
      'Wj.create((location.protocol==="https:"?"wss://":"ws://")+a+(location.port?":"+location.port:""), ["" + c], null, !1);'
    );
  }
  html = html.replace(
    /window\.DiggerzBeginBackgroundMatchmaking\s*=\s*function\s*\([^)]*\)\s*\{[^}]*\}/,
    'window.DiggerzBeginBackgroundMatchmaking=function(){console.log("[diggerz] lobby off")}'
  );
  return html;
}

function injectHtml(buf, offlineAllowed) {
  let html = buf.toString('utf8');
  if (!offlineAllowed) {
    html = forceOnlineClient(html);
  }
  if (html.indexOf('id="diggerz-force-host"') === -1) {
    if (html.indexOf('<head>') !== -1) {
      html = html.replace('<head>', '<head>' + FORCE_HOST_INJECT, 1);
    } else {
      html = FORCE_HOST_INJECT + html;
    }
  }
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
    if (ext === '.html' && path.basename(filePath) === 'index.html') {
      body = injectHtml(data, offlineAllowed);
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  });
}

function resolveStatic(urlPath) {
  let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const candidates = [path.join(PUBLIC, rel), path.join(ROOT, rel)];
  for (const fp of candidates) {
    if ((fp.startsWith(PUBLIC) || fp.startsWith(ROOT)) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      return fp;
    }
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
    res.end(JSON.stringify({
      ok: true,
      service: 'diggerz-server',
      players: room.players.size,
      world: room.name,
    }));
    return;
  }

  const filePath = resolveStatic(url);
  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  sendFile(res, filePath, offlineAllowed);
});

const wss = new WebSocketServer({
  server,
  handleProtocols: (protocols) => {
    const list = [...protocols];
    return list.length ? list[0] : 'diggerz';
  },
});

wss.on('connection', (ws, req) => {
  console.log('client connected', {
    proto: req.headers['sec-websocket-protocol'] || '',
    ip: req.socket.remoteAddress,
    players: room.players.size + 1,
  });
  room.addClient(ws);
  room.onOpen(ws);
  ws.on('message', (data) => {
    try {
      room.onMessage(ws, Buffer.isBuffer(data) ? data : Buffer.from(data));
    } catch (e) {
      console.error('packet error', e);
    }
  });
  ws.on('close', () => {
    room.removeClient(ws);
    console.log('client disconnected', { players: room.players.size });
  });
  ws.on('error', (err) => console.error('ws error', err.message));
});

server.listen(PORT, () => {
  console.log('diggerz-server on :' + PORT);
  console.log('online-only inject active (use ?local=1 for offline Dig+Trade)');
  console.log('game:   http://localhost:' + PORT + '/');
  console.log('health: http://localhost:' + PORT + '/health');
});
