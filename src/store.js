'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createState } = require('./game');

function createStore(file = path.join(__dirname, '..', 'data', 'game.json')) {
  function load() {
    try {
      const state = { ...createState(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
      for (const p of state.players) p.connected = false;
      return state;
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`Could not read ${file} (${err.message}); starting a new game.`);
      return createState();
    }
  }

  // Atomic write: a crash mid-write never leaves a half-written file.
  function save(state) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
  }

  return { load, save, file };
}

module.exports = { createStore };
