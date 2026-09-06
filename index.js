'use strict';

/**
 * diggerz-server — flat layout (all files in repo root OR public/).
 * Works with GitHub "upload files" into the root.
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

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
      res.end(err.code === 'ENOENT' ? 'not found' : 'error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(data);
  });
}

function resolveStatic(urlPath) {
  let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const candidates = [
    path.join(PUBLIC, rel),
    path.join(ROOT, rel),
  ];
  for (const fp of candidates) {
    if ((fp.startsWith(PUBLIC) || fp.startsWith(ROOT)) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      return fp;
    }
  }
  return null;
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];

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
  sendFile(res, filePath);
});

const wss = new WebSocketServer({
  server,
  handleProtocols: (protocols) => {
    const list = [...protocols];
    if (list.length === 0) return false;
    return list[0];
  },
});

wss.on('connection', (ws, req) => {
  console.log('client connected', {
    proto: req.headers['sec-websocket-protocol'] || '',
    ip: req.socket.remoteAddress,
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
  console.log('game:   http://localhost:' + PORT + '/');
  console.log('health: http://localhost:' + PORT + '/health');
});
