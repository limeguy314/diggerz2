'use strict';

/**
 * Binary packet codec matching the recovered diggerz client (`tb` class).
 * All multi-byte integers are little-endian.
 */

class Packet {
  constructor(size = 256) {
    this.buf = Buffer.alloc(size);
    this.offset = 0;
    this.length = 0;
  }

  static from(buffer) {
    const p = new Packet(0);
    p.buf = Buffer.from(buffer);
    p.length = p.buf.length;
    p.offset = 0;
    return p;
  }

  ensure(n) {
    if (this.offset + n <= this.buf.length) return;
    const next = Buffer.alloc(Math.max(this.buf.length * 2, this.offset + n + 64));
    this.buf.copy(next, 0, 0, this.length);
    this.buf = next;
  }

  /** Finish writing and return a slice of written bytes. */
  toBuffer() {
    return this.buf.subarray(0, this.offset);
  }

  // --- writers (match client R*) ---

  R0(v) {
    this.ensure(4);
    this.buf.writeInt32LE(v | 0, this.offset);
    this.offset += 4;
    this.length = Math.max(this.length, this.offset);
  }

  R1(v) {
    this.R0(v);
  }

  R2(v) {
    this.ensure(2);
    this.buf.writeUInt16LE(v & 0xffff, this.offset);
    this.offset += 2;
    this.length = Math.max(this.length, this.offset);
  }

  R4(v) {
    this.ensure(1);
    this.buf[this.offset++] = v & 0xff;
    this.length = Math.max(this.length, this.offset);
  }

  /** GUID = four int32s */
  R8(guid) {
    const g = guid || [0, 0, 0, 0];
    this.R1(g[0] | 0);
    this.R1(g[1] | 0);
    this.R1(g[2] | 0);
    this.R1(g[3] | 0);
  }

  /** Length-prefixed string (client stores length+1). */
  R9(str) {
    str = String(str || '');
    this.R0(str.length + 1);
    for (let i = 0; i < str.length; i++) this.R4(str.charCodeAt(i) & 0xff);
  }

  /** Float as floor + fractional*1e5 (client r8 / Q4). */
  r8(v) {
    v = Number(v) || 0;
    const whole = Math.floor(v);
    const frac = Math.floor(1e5 * (v - whole));
    this.R0(whole);
    this.R0(frac);
  }

  s0(bool) {
    this.R4(bool ? 1 : 0);
  }

  // --- readers (match client Q* / r*) ---

  Q7() {
    if (this.offset + 4 > this.length) return 0;
    const v = this.buf.readInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  Q9() {
    if (this.offset + 2 > this.length) return 0;
    const v = this.buf.readUInt16LE(this.offset);
    this.offset += 2;
    return v;
  }

  r1() {
    if (this.offset + 1 > this.length) return 0;
    return this.buf[this.offset++];
  }

  r6() {
    return this.r1() !== 0;
  }

  Q4() {
    const a = this.Q7();
    const b = this.Q7();
    return a + b / 1e5;
  }

  Q6() {
    return [this.Q7(), this.Q7(), this.Q7(), this.Q7()];
  }

  r5() {
    const len = this.Q7();
    if (len <= 0) return '';
    const n = Math.max(0, len - 1);
    let s = '';
    for (let i = 0; i < n && this.offset < this.length; i++) {
      s += String.fromCharCode(this.r1());
    }
    return s;
  }

  remaining() {
    return this.length - this.offset;
  }
}

function randomGuid() {
  return [
    (Math.random() * 0x7fffffff) | 0,
    (Math.random() * 0x7fffffff) | 0,
    (Math.random() * 0x7fffffff) | 0,
    (Math.random() * 0x7fffffff) | 0,
  ];
}

function zeroGuid() {
  return [0, 0, 0, 0];
}

function guidKey(g) {
  return (g || [0, 0, 0, 0]).join(',');
}

/** Wrap body with opcode + status header (server → client). */
function frame(opcode, status, writeFn) {
  const p = new Packet();
  p.R2(opcode);
  p.R2(status == null ? 1 : status);
  if (writeFn) writeFn(p);
  return p.toBuffer();
}

module.exports = { Packet, randomGuid, zeroGuid, guidKey, frame };
