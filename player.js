'use strict';

const { randomGuid, zeroGuid } = require('./packet');

function emptyItem() {
  return { category: 0, id: 0, variant: 0, count: 0, extra: 0, text: '' };
}

function item(category, id, variant, count, extra, text) {
  return {
    category: category | 0,
    id: id | 0,
    variant: variant | 0,
    count: count | 0,
    extra: extra | 0,
    text: text || '',
  };
}

function createPlayer(name) {
  const slots = [];
  for (let i = 0; i < 30; i++) slots.push(emptyItem());
  // Starter loadout (matches recovered Free Dig defaults)
  slots[0] = item(2, 326, 1, 1, 0, ''); // Mortar
  slots[1] = item(2, 240, 0, 1, 0, ''); // Pickaxe
  slots[2] = item(1, 100, 0, 24, 0, ''); // Grass
  slots[3] = item(1, 108, 0, 40, 0, ''); // Dirt

  return {
    id: randomGuid(),
    pocketId: randomGuid(),
    zeroId: zeroGuid(),
    name: (name || 'Player').slice(0, 24),
    x: 12,
    y: 16,
    appearance: [0, 0, 0, 0, 326, 0, 0, 0, 0, 0, 0],
    appearanceText: '',
    slots,
    coins: 0,
    hp: 3,
    maxHp: 3,
    ws: null,
    ready: false,
  };
}

module.exports = { createPlayer, emptyItem, item };
