'use strict';

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { Server } = require('socket.io');
const game = require('./src/game');
const { createStore } = require('./src/store');

const PORT = Number(process.env.PORT) || 3001;
const store = createStore(process.env.DATA_FILE);
const state = store.load();

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/statement.js', (_req, res) => res.sendFile(path.join(__dirname, 'src', 'statement.js')));
const server = http.createServer(app);
const io = new Server(server);

// playerId -> number of open sockets (a player may have several tabs open)
const connections = new Map();

function setConnected(playerId, delta) {
  const n = (connections.get(playerId) || 0) + delta;
  if (n <= 0) connections.delete(playerId);
  else connections.set(playerId, n);
  const p = game.getPlayer(state, playerId);
  if (p) p.connected = n > 0;
}

function broadcast() {
  io.emit('state', game.publicState(state));
}

function commit() {
  try {
    store.save(state);
  } catch (err) {
    console.error('Failed to save game state:', err.message);
  }
  broadcast();
}

function bind(socket, player) {
  if (socket.data.playerId === player.id) return;
  if (socket.data.playerId) setConnected(socket.data.playerId, -1);
  socket.data.playerId = player.id;
  socket.join(`player:${player.id}`);
  setConnected(player.id, 1);
}

const reply = (cb, value) => { if (typeof cb === 'function') cb(value); };

io.on('connection', (socket) => {
  socket.emit('state', game.publicState(state));

  socket.on('resume', ({ secret } = {}, cb) => {
    const player = game.findBySecret(state, secret);
    if (!player) return reply(cb, { ok: false, error: 'Session not found' });
    bind(socket, player);
    reply(cb, { ok: true, playerId: player.id });
    broadcast();
  });

  socket.on('join', (payload = {}, cb) => {
    if (socket.data.playerId) return reply(cb, { ok: false, error: 'Already in the game' });
    const res = game.join(state, null, payload);
    if (!res.ok) return reply(cb, res);
    bind(socket, res.player);
    reply(cb, { ok: true, playerId: res.player.id, secret: res.player.secret });
    commit();
  });

  socket.on('action', ({ type, payload } = {}, cb) => {
    const fn = Object.hasOwn(game.actions, type) ? game.actions[type] : null;
    if (!fn) return reply(cb, { ok: false, error: 'Unknown action' });
    const actorId = socket.data.playerId;
    if (!actorId || !game.getPlayer(state, actorId)) return reply(cb, { ok: false, error: 'Not in game' });

    const res = fn(state, actorId, payload || {});
    reply(cb, { ok: res.ok, error: res.error, needLoan: res.needLoan });
    if (!res.ok) return;

    if (type === 'kickPlayer') {
      connections.delete(res.removed.id);
      io.to(`player:${res.removed.id}`).emit('kicked');
      io.in(`player:${res.removed.id}`).socketsLeave(`player:${res.removed.id}`);
      for (const s of io.sockets.sockets.values()) {
        if (s.data.playerId === res.removed.id) s.data.playerId = null;
      }
    }
    commit();
  });

  socket.on('disconnect', () => {
    if (socket.data.playerId) {
      setConnected(socket.data.playerId, -1);
      broadcast();
    }
  });
});

function lanUrls() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${PORT}`);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  Cashflow Banker is running!\n');
  console.log(`  On this computer:  http://localhost:${PORT}`);
  for (const url of lanUrls()) console.log(`  On your network:   ${url}`);
  console.log(`\n  Game data: ${store.file}\n`);
});
