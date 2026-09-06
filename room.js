'use strict';
const { Packet, frame, guidKey, zeroGuid } = require('./packet');
const { createWorld, tileAt, setTile } = require('./world');
const { createPlayer, emptyItem, item } = require('./player');
const APPEARANCE_FOR = { 326: 4, 240: 4, 248: 4, 79: 4, 93: 4, 328: 4, 247: 1 };
const MINING = new Set([25, 21, 36, 40, 24, 27, 30, 32, 0, 1, 2, 3]);

class Room {
  constructor(name = 'Free Dig') {
    this.name = name;
    this.world = createWorld(128, 80);
    this.players = new Map();
    this.damage = new Map();
  }
  addClient(ws) {
    const player = createPlayer('Player');
    player.ws = ws; player.selectedSlot = 1;
    ws._player = player; ws._room = this;
    this.players.set(guidKey(player.id), player);
    return player;
  }
  removeClient(ws) {
    const player = ws._player; if (!player) return;
    this.players.delete(guidKey(player.id));
    this.broadcastPlayerDespawn(player);
    player.ws = null;
  }
  send(ws, opcode, status, writeFn) {
    if (!ws || ws.readyState !== 1) return;
    try { ws.send(frame(opcode, status, writeFn)); } catch (e) { console.error(e.message); }
  }
  broadcast(opcode, status, writeFn, exceptWs) {
    for (const p of this.players.values())
      if (p.ws && p.ws !== exceptWs) this.send(p.ws, opcode, status, writeFn);
  }
  onOpen(ws) { if (ws._player) this.sendLogin(ws, ws._player); }
  onMessage(ws, buffer) {
    const packet = Packet.from(buffer);
    const opcode = packet.Q9();
    const player = ws._player; if (!player) return;
    switch (opcode) {
      case 2: this.handleOpcode2(ws, player, packet); break;
      case 4: this.sendWorldName(ws); this.sendWorld(ws); break;
      case 6: case 8: this.readMovement(player, packet, opcode); this.broadcastMovement(player, ws); break;
      case 11: this.build(ws, player, packet); break;
      case 12: this.chat(ws, player, packet); break;
      case 14: this.sendInventory(ws, player); break;
      case 18: this.finishJoin(ws, player); break;
      case 28: this.swap(ws, player, packet); break;
      case 33: this.equip(ws, player, packet); break;
      case 52: case 281: this.sendInventory(ws, player); break;
      case 199:
        this.readProfile(player, packet);
        if (player.ready) this.pushLoadout(ws, player);
        break;
      case 287: this.digOrAttack(ws, player, packet); break;
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
      if (name && String(name).trim() && name !== 'Enter Name')
        player.name = String(name).trim().slice(0, 24);
      if (isFinite(skinScale) && skinScale > 0.2 && skinScale < 3) player.skinScale = skinScale;
      player.flagL0 = flagL0 | 0;
      console.log('identity', player.name, player.skinScale);
    } catch (e) {}
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
      const pick = slots.findIndex((s) => s.category === 2 && s.id === 240 && s.count > 0);
      player.selectedSlot = pick >= 0 ? pick : 0;
      player.slots = slots;
      player.profileReceived = true;
      console.log('profile', player.name, 'slots', slotCount);
    } catch (e) { console.error('profile', e.message); }
  }
  pushLoadout(ws, player) {
    this.sendPlayer(ws, player);
    this.sendInventory(ws, player);
    this.sendCoins(ws, player);
    this.broadcast(5, 1, (p) => this.writePlayerBody(p, player), ws);
  }
  finishJoin(ws, player) {
    player.x = 12;
    player.y = this.world.surface - 2;
    this.sendPlayer(ws, player);
    this.sendInventory(ws, player);
    this.sendAccess(ws);
    this.sendCoins(ws, player);
    setTimeout(() => {
      if (player.ws) {
        this.sendAccess(player.ws);
        this.sendInventory(player.ws, player);
        this.sendPlayer(player.ws, player);
      }
    }, 400);
    setTimeout(() => {
      if (player.ws) {
        this.sendAccess(player.ws);
        this.sendInventory(player.ws, player);
      }
    }, 1200);
    this.message(ws, '^2Online unlocked. ^7Dig, place, equip tools. Type /name YourName');
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
  writePlayerBody(p, player, opts = {}) {
    const hidden = !!opts.hidden;
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
  sendPlayer(ws, player) { this.send(ws, 5, 1, (p) => this.writePlayerBody(p, player)); }
  sendPlayerTo(ws, player) { this.send(ws, 5, 1, (p) => this.writePlayerBody(p, player)); }
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
  sendAccess(ws) {
    // Opcode 143 -> X31 sets l.a44 / l.a45 (dig + build). Opcode 8 is NOT access.
    this.send(ws, 143, 1, (p) => { p.s0(true); p.s0(true); });
  }
  sendCoins(ws, player) { this.send(ws, 17, 1, (p) => p.R0(player.coins | 0)); }
  sendTile(x, y, id, variant = 0) {
    this.broadcast(11, 1, (p) => {
      p.R2(1); p.R0(x | 0); p.R0(0); p.R0(y | 0);
      p.R2((id & 2047) | ((variant & 31) << 11));
    });
  }
  sendHit(x, y, stage) {
    this.broadcast(68, 1, (p) => { p.r8(x); p.r8(0); p.r8(y); p.R0(stage | 0); });
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
  equip(ws, player, packet) {
    const slot = packet.Q7();
    if (slot < 0 || slot >= (player.slots || []).length) { this.sendInventory(ws, player); return; }
    const it = player.slots[slot];
    if (!it || it.count <= 0) { this.sendInventory(ws, player); return; }
    player.selectedSlot = slot;
    if (it.category === 2) {
      const appSlot = APPEARANCE_FOR[it.id];
      if (appSlot != null) {
        if (!player.appearance) player.appearance = [0, 247, 0, 0, 326, 0, 0, 0, 0, 0, 0];
        player.appearance[appSlot] = it.id;
      }
    }
    this.sendPlayer(ws, player);
    this.sendInventory(ws, player);
    this.broadcast(5, 1, (p) => this.writePlayerBody(p, player), ws);
  }
  swap(ws, player, packet) {
    try {
      packet.Q6(); const from = packet.Q9(); packet.Q6(); const to = packet.Q9();
      if (from < 0 || to < 0 || from >= player.slots.length || to >= player.slots.length) return;
      const hold = player.slots[from];
      player.slots[from] = player.slots[to];
      player.slots[to] = hold;
      this.sendInventory(ws, player);
    } catch (e) { this.sendInventory(ws, player); }
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
        const idx = player.slots.findIndex((s) => s.category === 1 && s.count > 0 && (!id || s.id === id));
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
      this.sendTile(x, y, placeId, variant || itemRef.variant || 0);
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
      this.pushLoadout(ws, player);
      return;
    }
    if (text) {
      const line = '^7' + player.name + ': ' + text.slice(0, 120);
      for (const p of this.players.values()) if (p.ws) this.message(p.ws, line);
    }
  }
  digOrAttack(ws, player, packet) {
    let attackX, attackY, toX, toY, attackType;
    try {
      attackX = packet.Q4(); attackY = packet.Q4();
      toX = packet.Q4(); toY = packet.Q4();
      attackType = packet.r1();
      if (packet.remaining() >= 4) {
        const sel = packet.Q7();
        if (sel >= 0 && sel < (player.slots || []).length) player.selectedSlot = sel;
      }
      if (packet.remaining() >= 16) { try { packet.Q6(); } catch (e) {} }
    } catch (e) { return; }
    const isMining = MINING.has(attackType);
    let tx = Math.round(toX), ty = Math.round(toY);
    if (!tileAt(this.world, tx, ty)) { tx = Math.round(attackX); ty = Math.round(attackY); }
    if (!tileAt(this.world, tx, ty)) {
      const px = Math.round(player.x), py = Math.round(player.y);
      let best = null, bestD = 99;
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
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
      this.weaponTerrain(player, attackX, attackY, toX, toY, attackType);
      return;
    }
    if (!hasTile) return;
    setTile(this.world, tx, ty, 0);
    this.sendHit(tx, ty, 5);
    this.sendTile(tx, ty, 0);
  }
  weaponTerrain(player, fromX, fromY, toX, toY, attackType) {
    const px = player.x, py = player.y;
    let dx = toX - px, dy = toY - py;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= dist; dy /= dist;
    let range = 6;
    if ([20, 22, 23, 29, 31, 33, 35, 37, 39].includes(attackType)) range = 12;
    let broken = 0;
    const steps = Math.max(4, Math.ceil(range * 2));
    for (let s = 1; s <= steps; s++) {
      const t = (s / steps) * range;
      const tx = Math.round(px + dx * t), ty = Math.round(py + dy * t);
      if (tileAt(this.world, tx, ty)) {
        setTile(this.world, tx, ty, 0);
        this.sendTile(tx, ty, 0);
        if (++broken >= 4) break;
      }
    }
  }
}
module.exports = { Room };
