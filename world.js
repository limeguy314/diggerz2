'use strict';

/** Shared Dig+Trade-style tile world. */

function createWorld(width = 128, height = 80) {
  const tiles = new Uint16Array(width * height);
  const surface = 18;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let id = 0;
      if (x === 0 || x === width - 1 || y === height - 1) id = 108;
      else if (y === surface) id = 100;
      else if (y > surface) {
        const depth = y - surface;
        const cave =
          depth > 7 &&
          y < height - 3 &&
          Math.sin(x * 0.31 + y * 0.17) + Math.sin(x * 0.09 - y * 0.37) > 1.25;
        id = cave ? 0 : 108;
      }
      tiles[x + y * width] = id;
    }
  }
  return { width, height, tiles, surface };
}

function tileAt(world, x, y) {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return 0;
  return world.tiles[x + y * world.width] || 0;
}

function setTile(world, x, y, id) {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
  world.tiles[x + y * world.width] = id & 0xffff;
  return true;
}

module.exports = { createWorld, tileAt, setTile };
