'use strict';

function createWorld(width = 128, height = 80) {
  const surface = 28;
  const tiles = new Uint16Array(width * height);
  for (let x = 0; x < width; x++) {
    for (let y = surface; y < height; y++) {
      let id = 100;
      if (y === surface) id = 101;
      if (y > surface + 8) id = 108;
      if (y > surface + 20) id = 110;
      tiles[x + y * width] = id;
    }
  }
  for (let x = 8; x < 20; x++) {
    for (let y = surface - 6; y < surface; y++) {
      if (y >= 0) tiles[x + y * width] = 0;
    }
  }
  return { width, height, surface, tiles };
}

function tileAt(world, x, y) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return 0;
  return world.tiles[x + y * world.width] | 0;
}

function setTile(world, x, y, id) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return;
  world.tiles[x + y * world.width] = id & 0xffff;
}

module.exports = { createWorld, tileAt, setTile };
