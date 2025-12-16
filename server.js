const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);

/* ============================
   SOCKET.IO — RENDER SAFE
============================ */
const { Server } = require('socket.io');

const io = new Server(server, {
  transports: ['polling', 'websocket'],
  cors: {
    origin: true,           // ⬅️ OBLIGATOIRE SUR RENDER
    methods: ['GET', 'POST'],
    credentials: true
  },
  allowEIO3: true
});

/* ============================
   ÉTAT DU MATCH
============================ */
const matchState = {
  teamA: '',
  teamB: '',
  scoreA: 0,
  scoreB: 0,
  foulA: 0,
  foulB: 0,
  quarter: 1,
  overtime: false,
  defaultQuarterTime: 10,
  clock: {
    min: 10,
    sec: 0,
    running: false,
    interval: null
  }
};

/* ============================
   BROADCAST (SYNC SAFE)
============================ */
function broadcast() {
  io.emit('state:update', matchState);
}

/* ============================
   CLOCK
============================ */
function tick() {
  if (!matchState.clock.running) return;

  if (matchState.clock.sec === 0) {
    if (matchState.clock.min === 0) {
      stopClock();
      return;
    }
    matchState.clock.min--;
    matchState.clock.sec = 59;
  } else {
    matchState.clock.sec--;
  }

  broadcast();
}

function startClock() {
  if (matchState.clock.interval) return;
  matchState.clock.running = true;
  matchState.clock.interval = setInterval(tick, 1000);
}

function stopClock() {
  matchState.clock.running = false;
  clearInterval(matchState.clock.interval);
  matchState.clock.interval = null;
}

/* ============================
   SOCKET EVENTS
============================ */
io.on('connection', socket => {
  console.log('✅ Client connecté depuis', socket.handshake.headers.origin);

  socket.emit('state:update', matchState);

  socket.on('match:init', data => {
    stopClock();

    matchState.teamA = data.teamA || 'ÉQUIPE A';
    matchState.teamB = data.teamB || 'ÉQUIPE B';
    matchState.scoreA = 0;
    matchState.scoreB = 0;
    matchState.foulA = 0;
    matchState.foulB = 0;
    matchState.quarter = 1;
    matchState.overtime = false;

    matchState.defaultQuarterTime = parseInt(data.quarterTime) || 10;
    matchState.clock.min = matchState.defaultQuarterTime;
    matchState.clock.sec = 0;

    broadcast();
  });

  socket.on('clock:start', startClock);
  socket.on('clock:stop', stopClock);

  socket.on('quarter:next', () => {
    stopClock();
    matchState.quarter++;
    matchState.clock.min = matchState.defaultQuarterTime;
    matchState.clock.sec = 0;
    broadcast();
  });

  socket.on('overtime:start', () => {
    stopClock();
    matchState.overtime = true;
    matchState.clock.min = 5;
    matchState.clock.sec = 0;
    broadcast();
  });

  socket.on('score:add', ({ team, pts }) => {
    if (!['A', 'B'].includes(team)) return;
    if (![1, 2].includes(pts)) return;
    matchState[`score${team}`] += pts;
    broadcast();
  });

  socket.on('score:sub', ({ team, pts }) => {
    if (!['A', 'B'].includes(team)) return;
    if (![1, 2].includes(pts)) return;
    matchState[`score${team}`] = Math.max(0, matchState[`score${team}`] - pts);
    broadcast();
  });

  socket.on('foul:add', ({ team }) => {
    if (!['A', 'B'].includes(team)) return;
    matchState[`foul${team}`]++;
    broadcast();
  });

  socket.on('foul:sub', ({ team }) => {
    if (!['A', 'B'].includes(team)) return;
    matchState[`foul${team}`] = Math.max(0, matchState[`foul${team}`] - 1);
    broadcast();
  });
});

/* ============================
   SERVER
============================ */
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Socket server running on port ${PORT}`);
});
