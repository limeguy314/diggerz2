'use strict';

const { Packet, frame, guidKey, zeroGuid } = require('./packet');
const { createWorld, tileAt, setTile } = require('./world');
const { createPlayer, emptyItem, item } = require('./player');

const MINING = new Set([25, 21, 36, 40, 24, 27, 30, 32, 0, 1, 2, 3]);

class Room {
  constructor(name = 'Free Dig') {
    this.name = name;
    this.world = createWorld(128, 80);
    this.players = new Map();
  }

  addClient(ws) {
    const player = createPlayer('Player');
    player.ws = ws;
    ws._player = player;
    ws._room = this;
    this.players.set(guidKey(player.id), player);
    return player;
  }

  removeClient(ws) {
    const player = ws._player;
    if (!player) return;
    this.players.delete(guidKey(player.id));
    this.broadcast(5, 1, (p) => this.writePlayerBody(p, player, true));
    player.ws = null;
  }

  send(ws, opcode, status, writeFn) {
    if (!ws || ws.readyState !== 1) return;
    try { ws.send(frame(opcode, status, writeFn)); } catch (e) { console.error('send', e.message); }
  }

  broadcast(opcode, status, writeFn, exceptWs) {
    for (const p of this.players.values()) {
      if (p.ws && p.ws !== exceptWs) this.send(p.ws, opcode, status, writeFn);
    }
  }

  onOpen(ws) { if (ws._player) this.sendLogin(ws, ws._player); }

  onMessage(ws, buffer) {
    const packet = Packet.from(buffer);
    const opcode = packet.Q9();
    const player = ws._player;
    if (!player) return;
    switch (opcode) {
      case 2: this.sendLogin(ws, player); break;
      case 4: this.sendWorldName(ws); this.sendWorld(ws); break;
      case 6: case 8: this.readMovement(player, packet, opcode); this.broadcastMovement(player, ws); break;
      case 11: this.build(ws, player, packet); break;
      case 12: this.chat(ws, player, packet); break;
      case 14: case 52: case 281: this.sendInventory(ws, player); break;
      case 18: this.finishJoin(ws, player); break;
      case 33: this.equip(ws, player, packet); break;
      case 287: this.digOrAttack(ws, player, packet); break;
    }
  }

  sendLogin(ws, player) {
    this.send(ws, 2, 1, (p) => {
      p.R8(player.id); p.R8(player.pocketId); p.R8(player.zeroId);
      p.R9('0.946'); p.s0(true); p.R9('0:reconstructed');
      for (let i = 0; i < 7; i++) p.R8(zeroGuid());
    });
  }

  sendWorldName(ws) { this.send(ws, 95, 1, (p) => p.R9(this.name)); }

  sendWorld(ws) {
    const s = this.world;
    this.send(ws, 4, 1, (p) => {
      p.R0(0); p.R2(s.width); p.R2(5); p.R2(s.height);
      const chunksX = Math.ceil(s.width / 4), chunksY = Math.ceil(s.height / 4);
      p.R0(chunksX * chunksY);
      for (let cx = 0; cx < chunksX; cx++) {
        for (let cy = 0; cy < chunksY; cy++) {
          p.R0(cx); p.R0(0); p.R0(cy);
          for (let dx = 0; dx < 4; dx++)
            for (let dl = 0; dl < 4; dl++)
              for (let dy = 0; dy < 4; dy++) {
                const x = cx * 4 + dx, y = cy * 4 + dy;
                p.R2(dl === 0 && x < s.width && y < s.height ? s.tiles[x + y * s.width] : 0);
              }
        }
      }
    });
  }

  writePlayerBody(p, player, hidden) {
    p.R8(player.id);
    p.R9(player.name || 'Player');
    p.r8(player.x); p.r8(0); p.r8(player.y); p.r8(0);
    const app = player.appearance || [];
    p.R2(11);
    for (let i = 0; i < 11; i++) p.R2(app[i] || 0);
    p.R9(player.appearanceText || '');
    p.R2(0); p.R4(0); p.R2(player.flagL0 | 0);
    p.s0(false); p.R2(1); p.R0(0); p.s0(false); p.R0(0); p.R2(0);
    p.R8(zeroGuid()); p.R4(0);
    p.r8(player.skinScale != null ? player.skinScale : 1.44);
    p.r8(hidden ? 0 : 1);
  }

  sendPlayer(ws, player) { this.send(ws, 5, 1, (p) => this.writePlayerBody(p, player, false)); }

  sendInventory(ws, player) {
    this.send(ws, 14, 1, (p) => {
      p.R8(player.id); p.R4(0);
      const slots = player.slots || [];
      const n = Math.min(127, Math.max(slots.length, 30));
      p.R4(n);
      for (let i = 0; i < n; i++) {
        const it = slots[i] || emptyItem();
        p.R4(it.category | 0);
        p.R2((it.id & 2047) | ((it.variant & 31) << 11));
        p.R2(it.count | 0); p.R2(it.extra | 0);
      }
      p.R2(0);
    });
  }

  sendAccess(ws) { this.send(ws, 143, 1, (p) => { p.s0(true); p.s0(true); }); }
  sendCoins(ws, player) { this.send(ws, 17, 1, (p) => p.R0(player.coins | 0)); }
  message(ws, text) { this.send(ws, 13, 1, (p) => { p.R4(0); p.R9(text); }); }

  finishJoin(ws, player) {
    player.x = 12;
    player.y = this.world.surface - 2;
    this.sendPlayer(ws, player);
    this.sendInventory(ws, player);
    this.sendAccess(ws);
    this.sendCoins(ws, player);
    this.message(ws, '^2Connected to server. WASD move.');
    player.ready = true;
    for (const other of this.players.values()) {
      if (!other.ready || other === player) continue;
      this.send(ws, 5, 1, (p) => this.writePlayerBody(p, other, false));
      if (other.ws) this.send(other.ws, 5, 1, (p) => this.writePlayerBody(p, player, false));
    }
    setTimeout(() => {
      if (player.ws) {
        this.sendAccess(player.ws);
        this.sendInventory(player.ws, player);
      }
    }, 500);
  }

  readMovement(player, packet, opcode) {
    try {
      if (opcode === 8) {
        packet.r6();
        const x = packet.Q4(); packet.Q4(); const y = packet.Q4();
        if (isFinite(x) && isFinite(y)) { player.x = x; player.y = y; }
        return;
      }
      if (packet.remaining() >= 16) {
        const x = packet.Q4(), y = packet.Q4();
        if (isFinite(x) && isFinite(y)) { player.x = x; player.y = y; }
      }
    } catch (e) {}
  }

  broadcastMovement(player, exceptWs) {
    this.broadcast(6, 1, (p) => {
      p.R8(player.id);
      p.r8(player.x); p.r8(player.y); p.r8(0); p.r8(0); p.r8(0); p.r8(0);
      p.R2(0); p.R4(0); p.R4(0); p.R2(0); p.R2(0);
    }, exceptWs);
  }

  equip(ws, player, packet) {
    try {
      const slot = packet.Q7() | 0;
      if (slot >= 0 && slot < (player.slots || []).length) {
        const it = player.slots[slot];
        if (it && it.count) player.selectedSlot = slot;
      }
    } catch (e) {}
    this.sendInventory(ws, player);
  }

  build(ws, player, packet) {
    try {
      packet.Q4(); packet.Q4(); packet.Q4(); packet.Q4();
      const id = packet.Q9();
      const x = packet.Q7();
      const layer = packet.Q7();
      const y = packet.Q7();
      const slot = packet.Q9();
      const variant = packet.Q9();
      if (layer !== 0) return;
      if (x < 1 || y < 1 || x >= this.world.width - 1 || y >= this.world.height - 1) return;
      if (tileAt(this.world, x, y)) return;
      let itemRef = player.slots[slot];
      if (!itemRef || itemRef.category !== 1 || itemRef.count <= 0) {
        const idx = player.slots.findIndex((s) => s.category === 1 && s.count > 0);
        if (idx < 0) return;
        itemRef = player.slots[idx];
      }
      itemRef.count--;
      if (itemRef.count <= 0) {
        const i = player.slots.indexOf(itemRef);
        if (i >= 0) player.slots[i] = emptyItem();
      }
      const placeId = id || itemRef.id;
      setTile(this.world, x, y, placeId);
      this.broadcast(11, 1, (p) => {
        p.R2(1); p.R0(x | 0); p.R0(0); p.R0(y | 0);
        p.R2((placeId & 2047) | ((variant & 31) << 11));
      });
      this.sendInventory(ws, player);
    } catch (e) { console.error('build', e.message); }
  }

  chat(ws, player, packet) {
    let text = '';
    try { text = packet.r5(); } catch (e) {}
    const m = /^\/name\s+(.+)/i.exec(text || '');
    if (m) {
      player.name = String(m[1]).slice(0, 24);
      this.message(ws, '^2Name set to ' + player.name);
      this.sendPlayer(ws, player);
      this.broadcast(5, 1, (p) => this.writePlayerBody(p, player, false), ws);
      return;
    }
    if (!text) return;
    text = String(text).slice(0, 120);
    for (const p of this.players.values()) {
      if (!p.ws) continue;
      this.send(p.ws, 12, 1, (pkt) => { pkt.R8(player.id); pkt.R9(text); });
    }
  }

  digOrAttack(ws, player, packet) {
    let attackX, attackY, toX, toY, attackType;
    try {
      attackX = packet.Q4(); attackY = packet.Q4();
      toX = packet.Q4(); toY = packet.Q4();
      attackType = packet.r1();
    } catch (e) { return; }
    const isMining = MINING.has(attackType);
    let tx = Math.round(toX), ty = Math.round(toY);
    if (!tileAt(this.world, tx, ty)) { tx = Math.round(attackX); ty = Math.round(attackY); }
    if (!tileAt(this.world, tx, ty)) {
      const px = Math.round(player.x), py = Math.round(player.y);
      let best = null, bestD = 99;
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const x = px + dx, y = py + dy;
          if (tileAt(this.world, x, y)) {
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = { x, y }; }
          }
        }
      if (best) { tx = best.x; ty = best.y; }
    }
    const hasTile = !!tileAt(this.world, tx, ty);
    if (!isMining && !hasTile) {
      const writeShot = (p) => {
        p.r8(attackX); p.r8(attackY); p.r8(toX); p.r8(toY);
        p.R0(attackType | 0); p.R8(player.id);
      };
      this.send(ws, 287, 1, writeShot);
      this.broadcast(287, 1, writeShot, ws);
      return;
    }
    if (!hasTile) return;
    setTile(this.world, tx, ty, 0);
    this.broadcast(68, 1, (p) => { p.r8(tx); p.r8(0); p.r8(ty); p.R0(5); });
    this.broadcast(11, 1, (p) => {
      p.R2(1); p.R0(tx | 0); p.R0(0); p.R0(ty | 0); p.R2(0);
    });
  }
}

module.exports = { Room };
