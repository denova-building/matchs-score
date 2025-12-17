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
  clock: { min: 10, sec: 0, running: false, interval: null },
  possession: { team: null, time: 12, running: false, interval: null }
};

/* ============================
   EMITS SÉPARÉS
============================ */
const emitState = () => io.emit('state:update', {
  teamA: matchState.teamA,
  teamB: matchState.teamB,
  scoreA: matchState.scoreA,
  scoreB: matchState.scoreB,
  foulA: matchState.foulA,
  foulB: matchState.foulB,
  quarter: matchState.quarter
});

const emitClock = () => io.emit('clock:update', {
  min: matchState.clock.min,
  sec: matchState.clock.sec,
  running: matchState.clock.running
});

const emitPossession = () => io.emit('possession:update', {
  team: matchState.possession.team,
  time: matchState.possession.time,
  running: matchState.possession.running
});

/* ============================
   CHRONO PRINCIPAL
============================ */
function startClock() {
  if (matchState.clock.interval) return;
  matchState.clock.running = true;
  matchState.clock.interval = setInterval(() => {
    if (matchState.clock.min === 0 && matchState.clock.sec === 0) return stopClock();
    if (matchState.clock.sec === 0) {
      matchState.clock.min--;
      matchState.clock.sec = 59;
    } else matchState.clock.sec--;
    emitClock();
  }, 1000);
}

function stopClock() {
  matchState.clock.running = false;
  clearInterval(matchState.clock.interval);
  matchState.clock.interval = null;
  emitClock();
}

/* ============================
   POSSESSION 12s
============================ */
function startPossession(team) {
  stopPossession();
  matchState.possession.team = team;
  matchState.possession.time = 12;
  matchState.possession.running = true;

  matchState.possession.interval = setInterval(() => {
    if (matchState.possession.time <= 0) return stopPossession();
    matchState.possession.time--;
    emitPossession();
  }, 1000);
}

function stopPossession() {
  clearInterval(matchState.possession.interval);
  matchState.possession.interval = null;
  matchState.possession.running = false;
  emitPossession();
}

function resetPossession() {
  stopPossession();
  matchState.possession.team = null;
  matchState.possession.time = 12;
  emitPossession();
}

/* ============================
   SOCKET EVENTS
============================ */
io.on('connection', socket => {
  socket.emit('state:update', matchState);
  emitClock();
  emitPossession();

  socket.on('match:init', d => {
    stopClock(); resetPossession();
    matchState.teamA = d.teamA || 'A';
    matchState.teamB = d.teamB || 'B';
    matchState.defaultQuarterTime = d.quarterTime || 10;
    matchState.clock.min = matchState.defaultQuarterTime;
    matchState.clock.sec = 0;
    matchState.scoreA = matchState.scoreB = 0;
    matchState.foulA = matchState.foulB = 0;
    matchState.quarter = 1;
    emitState(); emitClock();
  });

  socket.on('clock:start', startClock);
  socket.on('clock:stop', stopClock);
  socket.on('quarter:next', () => {
    stopClock();
    matchState.quarter++;
    matchState.clock.min = matchState.defaultQuarterTime;
    matchState.clock.sec = 0;
    emitState(); emitClock();
  });

  socket.on('score:add', d => { matchState[`score${d.team}`] += d.pts; emitState(); });
  socket.on('score:sub', d => { matchState[`score${d.team}`] = Math.max(0, matchState[`score${d.team}`] - d.pts); emitState(); });
  socket.on('foul:add', d => { matchState[`foul${d.team}`]++; emitState(); });
  socket.on('foul:sub', d => { matchState[`foul${d.team}`] = Math.max(0, matchState[`foul${d.team}`] - 1); emitState(); });

  socket.on('possession:start', d => startPossession(d.team));
  socket.on('possession:stop', stopPossession);
  socket.on('possession:reset', resetPossession);
});

/* ============================
   SERVER
============================ */
server.listen(process.env.PORT || 3000);
