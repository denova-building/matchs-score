const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);

/* ============================
   SOCKET.IO + CORS FIABLE
============================ */
const allowedOrigins = [
  'https://mbolostats.com',
  'https://matchs-score.onrender.com'
];

const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
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
   BROADCAST SAFE
============================ */
let isBroadcasting = false;

function safeBroadcast() {
  if (isBroadcasting) return;
  isBroadcasting = true;

  io.emit('state:update', matchState);

  setImmediate(() => {
    isBroadcasting = false;
  });
}

/* ============================
   CLOCK LOGIC
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

  safeBroadcast();
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
  console.log('✅ Client connecté');

  // Sync immédiate
  socket.emit('state:update', matchState);

  /* INIT MATCH */
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

    safeBroadcast();
  });

  /* CLOCK */
  socket.on('clock:start', startClock);
  socket.on('clock:stop', stopClock);

  socket.on('quarter:next', () => {
    stopClock();
    matchState.quarter++;
    matchState.clock.min = matchState.defaultQuarterTime;
    matchState.clock.sec = 0;
    safeBroadcast();
  });

  socket.on('overtime:start', () => {
    stopClock();
    matchState.overtime = true;
    matchState.clock.min = 5;
    matchState.clock.sec = 0;
    safeBroadcast();
  });

  /* SCORES */
  socket.on('score:add', ({ team, pts }) => {
    if (!['A', 'B'].includes(team)) return;
    if (![1, 2].includes(pts)) return;

    matchState[`score${team}`] += pts;
    safeBroadcast();
  });

  socket.on('score:sub', ({ team, pts }) => {
    if (!['A', 'B'].includes(team)) return;
    if (![1, 2].includes(pts)) return;

    matchState[`score${team}`] = Math.max(
      0,
      matchState[`score${team}`] - pts
    );
    safeBroadcast();
  });

  /* FAUTES */
  socket.on('foul:add', ({ team }) => {
    if (!['A', 'B'].includes(team)) return;

    matchState[`foul${team}`]++;
    safeBroadcast();
  });

  socket.on('foul:sub', ({ team }) => {
    if (!['A', 'B'].includes(team)) return;

    matchState[`foul${team}`] = Math.max(
      0,
      matchState[`foul${team}`] - 1
    );
    safeBroadcast();
  });

  socket.on('disconnect', () => {
    console.log('❌ Client déconnecté');
  });
});

/* ============================
   SERVER
============================ */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Socket server running on port ${PORT}`);
});
