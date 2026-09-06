'use strict';

const { Packet, frame, guidKey, zeroGuid } = require('./packet');
const { createWorld, tileAt, setTile } = require('./world');
const { createPlayer, emptyItem, item } = require('./player');

class Room {
  constructor(name = 'Free Dig') {
    this.name = name;
    this.world = createWorld(128, 80);
    this.players = new Map();
    this.damage = new Map();
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
    this.broadcastPlayerDespawn(player);
    player.ws = null;
  }

  send(ws, opcode, status, writeFn) {
    if (!ws || ws.readyState !== 1) return;
    try { ws.send(frame(opcode, status, writeFn)); } catch (e) { console.error('send failed', e.message); }
  }

  broadcast(opcode, status, writeFn, exceptWs) {
    for (const p of this.players.values()) {
      if (p.ws && p.ws !== exceptWs) this.send(p.ws, opcode, status, writeFn);
    }
  }

  onOpen(ws) {
    const player = ws._player;
    if (player) this.sendLogin(ws, player);
  }

  onMessage(ws, buffer) {
    const packet = Packet.from(buffer);
    const opcode = packet.Q9();
    const player = ws._player;
    if (!player) return;
    switch (opcode) {
      case 2: this.handleOpcode2(ws, player, packet); break;
      case 4: this.sendWorldName(ws); this.sendWorld(ws); break;
      case 6:
      case 8: this.readMovement(player, packet, opcode); this.broadcastMovement(player, ws); break;
      case 11: this.build(ws, player, packet); break;
      case 12: this.chat(ws, player, packet); break;
      case 14: this.sendInventory(ws, player); break;
      case 18: this.finishJoin(ws, player); break;
      case 28:
      case 33:
      case 52:
      case 281: this.sendInventory(ws, player); break;
      case 199:
        this.readProfile(player, packet);
        if (player.ready) {
          this.sendPlayer(ws, player);
          this.sendInventory(ws, player);
          this.sendCoins(ws, player);
          this.broadcast(5, 1, (p) => this.writePlayerBody(p, player), ws);
        }
        break;
      case 287: this.digOrAttack(ws, player, packet); break;
      default: break;
    }
  }

  handleOpcode2(ws, player, packet) {
    if (packet.remaining() >= 4) {
      const field = packet.Q9();
      if (field === 2 && packet.remaining() > 8) this.readIdentity(player, packet);
    }
    this.sendLogin(ws, player);
  }

  readIdentity(player, packet) {
    try {
      packet.r5(); packet.r5();
      const name = packet.r5();
      packet.r5(); packet.r5();
      const skinScale = packet.Q4();
      const flagL0 = packet.Q7();
      if (name && name !== 'Enter Name') player.name = String(name).slice(0, 24);
      if (isFinite(skinScale) && skinScale > 0.2 && skinScale < 3) player.skinScale = skinScale;
      player.flagL0 = flagL0 | 0;
      player.identityReceived = true;
      console.log('identity', player.name, 'skin', player.skinScale);
    } catch (e) { console.error('identity parse', e.message); }
  }

  readProfile(player, packet) {
    try {
      if (packet.Q7() !== 1) return;
      player.coins = Math.max(0, packet.Q7() | 0);
      const appLen = Math.min(16, Math.max(0, packet.Q7() | 0));
      const appearance = [];
      for (let i = 0; i < appLen; i++) appearance.push(packet.Q9() & 0xffff);
      while (appearance.length < 11) appearance.push(0);
      player.appearance = appearance.slice(0, 11);
      const slotCount = Math.min(30, Math.max(0, packet.Q7() | 0));
      const slots = [];
      for (let i = 0; i < 30; i++) slots.push(emptyItem());
      for (let i = 0; i < slotCount; i++) {
        const category = packet.r1();
        const packed = packet.Q9();
        const count = packet.Q9();
        const extra = packet.Q9();
        slots[i] = item(category, packed & 2047, (packed >> 11) & 31, count, extra, '');
      }
      if (!slots.some((s) => s.category === 2 && s.count > 0)) {
        slots[0] = item(2, 326, 1, 1, 0, '');
        slots[1] = item(2, 240, 0, 1, 0, '');
      }
      player.slots = slots;
      player.profileReceived = true;
      console.log('profile', player.name, 'coins', player.coins, 'slots', slotCount);
    } catch (e) { console.error('profile parse', e.message); }
  }

  finishJoin(ws, player) {
    this.sendPlayer(ws, player);
    this.sendInventory(ws, player);
    this.sendAccess(ws);
    this.sendCoins(ws, player);
    this.message(ws, '^2Connected to fight server. ^7Mining and loadout synced when available.');
    player.ready = true;
    this.syncPeers(ws, player);
  }

  syncPeers(ws, joiner) {
    for (const other of this.players.values()) {
      if (!other.ready || other === joiner) continue;
      this.sendPlayerTo(ws, other);
      if (other.ws) this.sendPlayerTo(other.ws, joiner);
    }
  }

  broadcastPlayerDespawn(player) {
    this.broadcast(5, 1, (p) => this.writePlayerBody(p, player, { hidden: true }));
  }

  sendLogin(ws, player) {
    this.send(ws, 2, 1, (p) => {
      p.R8(player.id);
      p.R8(player.pocketId);
      p.R8(player.zeroId);
      p.R9('0.946');
      p.s0(true);
      p.R9('0:reconstructed');
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
          for (let dx = 0; dx < 4; dx++) {
            for (let dl = 0; dl < 4; dl++) {
              for (let dy = 0; dy < 4; dy++) {
                const x = cx * 4 + dx, y = cy * 4 + dy;
                p.R2(dl === 0 && x < s.width && y < s.height ? s.tiles[x + y * s.width] : 0);
              }
            }
          }
        }
      }
    });
  }

  writePlayerBody(p, player, opts = {}) {
    const hidden = !!opts.hidden;
    p.R8(player.id);
    p.R9(player.name);
    p.r8(player.x); p.r8(0); p.r8(player.y); p.r8(0);
    const app = player.appearance || [];
    p.R2(Math.max(app.length, 11));
    for (let i = 0; i < Math.max(app.length, 11); i++) p.R2(app[i] || 0);
    p.R9(player.appearanceText || '');
    p.R2(0); p.R4(0);
    p.R2(player.flagL0 | 0);
    p.s0(false); p.R2(1); p.R0(0); p.s0(false); p.R0(0); p.R2(0);
    p.R8(zeroGuid()); p.R4(0);
    p.r8(player.skinScale != null ? player.skinScale : 1.44);
    p.r8(hidden ? 0 : 1);
  }

  sendPlayer(ws, player) { this.send(ws, 5, 1, (p) => this.writePlayerBody(p, player)); }
  sendPlayerTo(ws, player) { this.send(ws, 5, 1, (p) => this.writePlayerBody(p, player)); }

  sendInventory(ws, player) {
    this.send(ws, 14, 1, (p) => {
      p.R8(player.id); p.R4(0);
      const slots = player.slots || [];
      p.R4(Math.min(127, slots.length));
      const texts = [];
      for (let i = 0; i < slots.length && i < 127; i++) {
        const it = slots[i] || emptyItem();
        p.R4(it.category);
        p.R2((it.id & 2047) | ((it.variant & 31) << 11));
        p.R2(it.count); p.R2(it.extra || 0);
        if (it.text) texts.push([i, it.text]);
      }
      p.R2(texts.length);
      for (let i = 0; i < texts.length; i++) { p.R0(texts[i][0]); p.R9(texts[i][1]); }
    });
  }

  sendAccess(ws) { this.send(ws, 8, 1, (p) => { p.R2(1); p.R2(1); }); }
  sendCoins(ws, player) { this.send(ws, 17, 1, (p) => p.R0(player.coins | 0)); }

  sendTile(x, y, id, variant = 0) {
    this.broadcast(11, 1, (p) => {
      p.R2(1); p.R0(x); p.R0(0); p.R0(y);
      p.R2((id & 2047) | ((variant & 31) << 11));
    });
  }

  sendHit(x, y, stage) {
    this.broadcast(68, 1, (p) => { p.r8(x); p.r8(0); p.r8(y); p.R0(stage); });
  }

  message(ws, text) { this.send(ws, 13, 1, (p) => { p.R4(0); p.R9(text); }); }

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

  build(ws, player, packet) {
    try {
      if (packet.remaining() < 12) return;
      const x = packet.Q7(); packet.Q7(); const y = packet.Q7();
      if (x < 1 || y < 1 || x >= this.world.width - 1 || y >= this.world.height - 1) return;
      if (tileAt(this.world, x, y)) return;
      let blockId = 108;
      for (const s of player.slots) {
        if (s.category === 1 && s.count > 0) { blockId = s.id; s.count--; break; }
      }
      setTile(this.world, x, y, blockId);
      this.sendTile(x, y, blockId);
      this.sendInventory(ws, player);
    } catch (e) {}
  }

  chat(ws, player, packet) {
    let text = '';
    try { text = packet.r5(); } catch (e) {}
    const m = /^\/name\s+(.+)/i.exec(text || '');
    if (m) {
      player.name = String(m[1]).slice(0, 24);
      this.message(ws, '^2Name set to ' + player.name);
      this.broadcast(5, 1, (p) => this.writePlayerBody(p, player), null);
      return;
    }
    if (text) {
      const line = '^7' + player.name + ': ' + text.slice(0, 120);
      for (const p of this.players.values()) if (p.ws) this.message(p.ws, line);
    }
  }

  digOrAttack(ws, player, packet) {
    let attackX = packet.Q4(), attackY = packet.Q4();
    const toX = packet.Q4(), toY = packet.Q4();
    const attackType = packet.r1();
    if (packet.remaining() >= 16) { try { packet.Q6(); } catch (e) {} }
    const miningTypes = new Set([25, 21, 36, 40, 24, 27, 30, 32]);
    if (!miningTypes.has(attackType)) {
      const writeShot = (p) => {
        p.r8(attackX); p.r8(attackY); p.r8(toX); p.r8(toY);
        p.R0(attackType | 0); p.R8(player.id);
      };
      this.send(ws, 287, 1, writeShot);
      this.broadcast(287, 1, writeShot, ws);
      this.weaponTerrain(player, attackX, attackY, toX, toY, attackType);
      return;
    }
    let tx = Math.round(attackX), ty = Math.round(attackY);
    if (!tileAt(this.world, tx, ty)) { tx = Math.round(toX); ty = Math.round(toY); }
    if (!tileAt(this.world, tx, ty)) {
      const px = Math.round(player.x), py = Math.round(player.y);
      let best = null, bestD = 99;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const x = px + dx, y = py + dy;
        if (tileAt(this.world, x, y)) {
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = { x, y }; }
        }
      }
      if (best) { tx = best.x; ty = best.y; }
    }
    if (!tileAt(this.world, tx, ty)) return;
    const key = tx + ':' + ty;
    const hits = (this.damage.get(key) || 0) + 1;
    this.damage.set(key, hits);
    this.sendHit(tx, ty, Math.min(hits, 5));
    if (hits < 2) return;
    setTile(this.world, tx, ty, 0);
    this.damage.delete(key);
    this.sendTile(tx, ty, 0);
  }

  weaponTerrain(player, fromX, fromY, toX, toY, attackType) {
    const px = player.x, py = player.y;
    let dx = toX - px, dy = toY - py;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= dist; dy /= dist;
    let range = 4;
    if ([26, 28, 4, 7, 1, 10].includes(attackType)) range = 10;
    if ([20, 22, 23, 29, 31, 33, 35, 37, 39].includes(attackType)) range = 12;
    let broken = 0;
    const steps = Math.max(4, Math.ceil(range * 2));
    for (let s = 1; s <= steps; s++) {
      const t = (s / steps) * range;
      const tx = Math.round(px + dx * t), ty = Math.round(py + dy * t);
      if (tileAt(this.world, tx, ty)) {
        setTile(this.world, tx, ty, 0);
        this.sendTile(tx, ty, 0);
        broken++;
        if ([26, 28].includes(attackType) || range <= 4) break;
        if (broken >= 3) break;
      }
    }
  }
}

module.exports = { Room };
