const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

/* ============================
   SOCKET.IO — RENDER SAFE
============================ */
const io = new Server(server, {
  transports: ['polling', 'websocket'],
  cors: {
    origin: true,
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
    interval: null
  },
  possession: {
    team: null,
    time: 12,
    interval: null
  }
};

let gameRunning = false; // état maître

/* ============================
   BROADCAST
============================ */
function broadcast() {
  io.emit('state:update', matchState);
}

/* ============================
   CHRONO PRINCIPAL
============================ */
function tickMainClock() {
  if (!gameRunning) return;

  if (matchState.clock.sec === 0) {
    if (matchState.clock.min === 0) {
      stopMainClock();
      return;
    }
    matchState.clock.min--;
    matchState.clock.sec = 59;
  } else {
    matchState.clock.sec--;
  }

  broadcast();
}

function startMainClock() {
  if (matchState.clock.interval) return;
  matchState.clock.interval = setInterval(tickMainClock, 1000);
}

function stopMainClock() {
  clearInterval(matchState.clock.interval);
  matchState.clock.interval = null;
}

/* ============================
   CHRONO DE POSSESSION
============================ */
function tickPossession() {
  if (!gameRunning) return;

  if (matchState.possession.time === 0) {
    stopPossession();
    return;
  }

  matchState.possession.time--;
  broadcast();
}

function startPossession(team) {
  stopPossession(); // reset
  if (!gameRunning) return;

  matchState.possession.team = team;
  matchState.possession.time = 12;
  matchState.possession.interval = setInterval(tickPossession, 1000);
  broadcast();
}

function stopPossession() {
  clearInterval(matchState.possession.interval);
  matchState.possession.interval = null;
  broadcast();
}

function resetPossession() {
  stopPossession();
  matchState.possession.team = null;
  matchState.possession.time = 12;
  broadcast();
}

/* ============================
   SOCKET EVENTS
============================ */
io.on('connection', socket => {
  console.log('✅ Client connecté');

  socket.emit('state:update', matchState);

  /* INIT MATCH */
  socket.on('match:init', data => {
    stopMainClock();
    resetPossession();

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

    gameRunning = false; // match initialisé mais pas démarré
    broadcast();
  });

  /* START / STOP JEU */
  socket.on('game:start', () => {
    gameRunning = true;
    startMainClock();
    if (matchState.possession.team) startPossession(matchState.possession.team);
  });

  socket.on('game:stop', () => {
    gameRunning = false;
    stopMainClock();
    stopPossession();
  });

  /* QUARTER / OVERTIME */
  socket.on('quarter:next', () => {
    stopMainClock();
    matchState.quarter++;
    matchState.clock.min = matchState.defaultQuarterTime;
    matchState.clock.sec = 0;
    broadcast();
  });

  socket.on('overtime:start', () => {
    stopMainClock();
    matchState.overtime = true;
    matchState.clock.min = 5;
    matchState.clock.sec = 0;
    broadcast();
  });

  /* SCORES */
  socket.on('score:add', ({ team, pts }) => {
    if (!['A','B'].includes(team) || ![1,2].includes(pts)) return;
    matchState[`score${team}`] += pts;
    broadcast();
  });

  socket.on('score:sub', ({ team, pts }) => {
    if (!['A','B'].includes(team) || ![1,2].includes(pts)) return;
    matchState[`score${team}`] = Math.max(0, matchState[`score${team}`] - pts);
    broadcast();
  });

  /* FAUTES */
  socket.on('foul:add', ({ team }) => {
    if (!['A','B'].includes(team)) return;
    matchState[`foul${team}`]++;
    broadcast();
  });

  socket.on('foul:sub', ({ team }) => {
    if (!['A','B'].includes(team)) return;
    matchState[`foul${team}`] = Math.max(0, matchState[`foul${team}`] - 1);
    broadcast();
  });

  /* POSSESSION */
  socket.on('possession:start', ({ team }) => {
    if (!['A','B'].includes(team)) return;
    startPossession(team);
  });

  socket.on('possession:stop', stopPossession);
  socket.on('possession:reset', resetPossession);

  socket.on('disconnect', () => {
    console.log('❌ Client déconnecté');
  });
});

/* ============================
   SERVER
============================ */
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Serveur lancé sur le port ${PORT}`);
});
