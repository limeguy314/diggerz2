'use strict';

const { Packet, frame, guidKey, zeroGuid } = require('./packet');
const { createWorld, tileAt, setTile } = require('./world');
const { createPlayer } = require('./player');

/**
 * One multiplayer room. Implements the subset of the recovered Dig+Trade
 * protocol needed for connect → spawn → move → dig → build → weapons → chat.
 */
class Room {
  constructor(name = 'Free Dig') {
    this.name = name;
    this.world = createWorld(128, 80);
    this.players = new Map(); // guidKey -> player
    this.damage = new Map(); // "x:y" -> hits
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
    player.ws = null;
    // TODO: broadcast leave if you add multi-player visibility packets
  }

  send(ws, opcode, status, writeFn) {
    if (!ws || ws.readyState !== 1) return;
    try {
      ws.send(frame(opcode, status, writeFn));
    } catch (e) {
      console.error('send failed', e.message);
    }
  }

  broadcast(opcode, status, writeFn, exceptWs) {
    for (const p of this.players.values()) {
      if (p.ws && p.ws !== exceptWs) this.send(p.ws, opcode, status, writeFn);
    }
  }

  /** Client → server packet. */
  onMessage(ws, buffer) {
    const packet = Packet.from(buffer);
    const opcode = packet.Q9();
    // Client A17 may send body only (opcode + payload) without status, or with.
    // Local service A17 writes opcode then body. Cr pads to 8. Read carefully.
    const player = ws._player;
    if (!player) return;

    switch (opcode) {
      case 2:
        // Client requests login after socket open (some builds).
        this.sendLogin(ws, player);
        break;
      case 4:
        this.sendWorldName(ws);
        this.sendWorld(ws);
        break;
      case 6:
        this.readMovement(player, packet);
        break;
      case 11:
        this.build(ws, player, packet);
        break;
      case 12:
        this.chat(ws, player, packet);
        break;
      case 14:
        this.sendInventory(ws, player);
        break;
      case 16:
        // pickup — ignore body for now
        break;
      case 18:
        // Full spawn request after world
        this.sendPlayer(ws, player);
        this.sendInventory(ws, player);
        this.sendAccess(ws);
        this.sendCoins(ws, player);
        this.message(ws, '^2Server ready. ^7WASD move; pickaxe digs; guns fire (opcode 287 echo).');
        player.ready = true;
        break;
      case 28:
      case 33:
      case 52:
      case 281:
        // equip / swap / drop / variant — acknowledge inventory
        this.sendInventory(ws, player);
        break;
      case 287:
        this.digOrAttack(ws, player, packet);
        break;
      case 288:
        break;
      default:
        // Unknown — ignore
        break;
    }
  }

  // --- outbound helpers (mirror DiggerzService) ---

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

  sendWorldName(ws) {
    this.send(ws, 95, 1, (p) => p.R9(this.name));
  }

  sendWorld(ws) {
    const s = this.world;
    this.send(ws, 4, 1, (p) => {
      p.R0(0);
      p.R2(s.width);
      p.R2(5);
      p.R2(s.height);
      const chunksX = Math.ceil(s.width / 4);
      const chunksY = Math.ceil(s.height / 4);
      p.R0(chunksX * chunksY);
      for (let cx = 0; cx < chunksX; cx++) {
        for (let cy = 0; cy < chunksY; cy++) {
          p.R0(cx);
          p.R0(0);
          p.R0(cy);
          for (let dx = 0; dx < 4; dx++) {
            for (let dl = 0; dl < 4; dl++) {
              for (let dy = 0; dy < 4; dy++) {
                const x = cx * 4 + dx;
                const y = cy * 4 + dy;
                const id =
                  dl === 0 && x < s.width && y < s.height
                    ? s.tiles[x + y * s.width]
                    : 0;
                p.R2(id);
              }
            }
          }
        }
      }
    });
  }

  sendPlayer(ws, player) {
    this.send(ws, 5, 1, (p) => {
      p.R8(player.id);
      p.R9(player.name);
      p.r8(player.x);
      p.r8(0);
      p.r8(player.y);
      p.r8(0);
      p.R2(player.appearance.length);
      for (let i = 0; i < player.appearance.length; i++) p.R2(player.appearance[i] || 0);
      p.R9(player.appearanceText || '');
      p.R2(0);
      p.R4(0);
      p.R2(0);
      p.s0(false);
      p.R2(1);
      p.R0(0);
      p.s0(false);
      p.R0(0);
      p.R2(0);
      p.R8(zeroGuid());
      p.R4(0);
      p.r8(1.44);
      p.r8(1);
    });
  }

  sendInventory(ws, player) {
    this.send(ws, 14, 1, (p) => {
      p.R8(player.id);
      p.R4(0);
      const slots = player.slots;
      p.R4(Math.min(127, slots.length));
      const texts = [];
      for (let i = 0; i < slots.length && i < 127; i++) {
        const item = slots[i] || { category: 0, id: 0, variant: 0, count: 0, extra: 0 };
        p.R4(item.category);
        p.R2((item.id & 2047) | ((item.variant & 31) << 11));
        p.R2(item.count);
        p.R2(item.extra || 0);
        if (item.text) texts.push([i, item.text]);
      }
      p.R2(texts.length);
      for (let i = 0; i < texts.length; i++) {
        p.R0(texts[i][0]);
        p.R9(texts[i][1]);
      }
    });
  }

  sendAccess(ws) {
    this.send(ws, 8, 1, (p) => {
      p.R2(1);
      p.R2(1);
    });
  }

  sendCoins(ws, player) {
    this.send(ws, 17, 1, (p) => p.R0(player.coins | 0));
  }

  sendTile(x, y, id, variant = 0) {
    this.broadcast(11, 1, (p) => {
      p.R2(1);
      p.R0(x);
      p.R0(0);
      p.R0(y);
      p.R2((id & 2047) | ((variant & 31) << 11));
    });
  }

  sendHit(x, y, stage) {
    this.broadcast(68, 1, (p) => {
      p.r8(x);
      p.r8(0);
      p.r8(y);
      p.R0(stage);
    });
  }

  message(ws, text) {
    this.send(ws, 13, 1, (p) => {
      p.R4(0);
      p.R9(text);
    });
  }

  readMovement(player, packet) {
    // Client movement packets vary; try to read two floats if present.
    if (packet.remaining() >= 16) {
      const x = packet.Q4();
      const y = packet.Q4();
      if (isFinite(x) && isFinite(y)) {
        player.x = x;
        player.y = y;
      }
    }
  }

  build(ws, player, packet) {
    // Simplified: ignore full layout, no-op safe
  }

  chat(ws, player, packet) {
    const text = packet.r5 ? packet.r5() : '';
    // Some clients send string differently — try remaining as best-effort
    this.message(ws, '^7[Server] ' + (text || 'ok'));
  }

  digOrAttack(ws, player, packet) {
    const attackX = packet.Q4();
    const attackY = packet.Q4();
    const toX = packet.Q4();
    const toY = packet.Q4();
    const attackType = packet.r1();
    // optional slot / guid may follow

    const isMining =
      attackType === 25 ||
      attackType === 21 ||
      attackType === 36 ||
      attackType === 40;

    if (!isMining) {
      // Echo projectile so client y32 spawns gun/mortar visuals
      this.send(ws, 287, 1, (p) => {
        p.r8(attackX);
        p.r8(attackY);
        p.r8(toX);
        p.r8(toY);
        p.R0(attackType | 0);
        p.R8(player.id);
      });
      // Broadcast to others so they see the shot
      this.broadcast(
        287,
        1,
        (p) => {
          p.r8(attackX);
          p.r8(attackY);
          p.r8(toX);
          p.r8(toY);
          p.R0(attackType | 0);
          p.R8(player.id);
        },
        ws
      );
      this.weaponTerrain(player, attackX, attackY, toX, toY, attackType);
      return;
    }

    // Mining
    let tx = Math.round(attackX);
    let ty = Math.round(attackY);
    const id = tileAt(this.world, tx, ty);
    if (!id) return;
    const key = tx + ':' + ty;
    const hits = (this.damage.get(key) || 0) + 1;
    this.damage.set(key, hits);
    this.sendHit(tx, ty, hits);
    if (hits < 5) return;
    setTile(this.world, tx, ty, 0);
    this.damage.delete(key);
    this.sendTile(tx, ty, 0);
  }

  weaponTerrain(player, fromX, fromY, toX, toY, attackType) {
    const px = player.x;
    const py = player.y;
    let dx = toX - px;
    let dy = toY - py;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= dist;
    dy /= dist;
    let range = 4;
    if ([26, 28, 4, 7, 1, 10].includes(attackType)) range = 10;
    if ([20, 22, 23, 29, 31, 33, 35, 37, 39].includes(attackType)) range = 12;
    let broken = 0;
    const steps = Math.max(4, Math.ceil(range * 2));
    for (let s = 1; s <= steps; s++) {
      const t = (s / steps) * range;
      const tx = Math.round(px + dx * t);
      const ty = Math.round(py + dy * t);
      if (tileAt(this.world, tx, ty)) {
        setTile(this.world, tx, ty, 0);
        this.sendTile(tx, ty, 0);
        broken++;
        if ([26, 28].includes(attackType) || range <= 4) break;
        if (broken >= 3) break;
      }
    }
  }

  /**
   * After TCP/WS connect the original client expects a login response (opcode 2)
   * before continuing. Push login immediately on open.
   */
  onOpen(ws) {
    const player = ws._player;
    if (!player) return;
    this.sendLogin(ws, player);
  }
}

module.exports = { Room };
