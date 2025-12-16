const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);

/* ============================
   SOCKET.IO — RENDER SAFE
============================ */
const { Server } = require('socket.io');

const io = new Server(server, {
  transports: ['polling', 'websocket'], // polling obligatoire sur Render
  cors: {
    origin: true,          // accepte dynamiquement toutes les origines
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
   LOGS POUR CRASH
============================ */
process.on('uncaughtException', function(err) {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', function(reason, promise) {
  console.error('Unhandled Rejection:', reason);
});

/* ============================
   BROADCAST SAFE
============================ */
function broadcast() {
  try {
    io.emit('state:update', matchState);
  } catch(err) {
    console.error('Erreur broadcast:', err);
  }
}

/* ============================
   CLOCK
============================ */
function tick() {
  try {
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
  } catch(err) {
    console.error('Erreur tick:', err);
  }
}

function startClock() {
  try {
    if (matchState.clock.interval) return;
    matchState.clock.running = true;
    matchState.clock.interval = setInterval(tick, 1000);
  } catch(err) {
    console.error('Erreur startClock:', err);
  }
}

function stopClock() {
  try {
    matchState.clock.running = false;
    clearInterval(matchState.clock.interval);
    matchState.clock.interval = null;
  } catch(err) {
    console.error('Erreur stopClock:', err);
  }
}

/* ============================
   SOCKET EVENTS
============================ */
io.on('connection', socket => {
  console.log('✅ Client connecté depuis', socket.handshake.headers.origin);

  // Sync initial
  try { socket.emit('state:update', matchState); } 
  catch(err){ console.error('Erreur init emit:', err); }

  // INIT MATCH
  socket.on('match:init', data => {
    try {
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
    } catch(err){ console.error('Erreur match:init:', err); }
  });

  // CLOCK
  socket.on('clock:start', () => { try { startClock(); } catch(err){console.error(err);} });
  socket.on('clock:stop', () => { try { stopClock(); } catch(err){console.error(err);} });

  socket.on('quarter:next', () => {
    try {
      stopClock();
      matchState.quarter++;
      matchState.clock.min = matchState.defaultQuarterTime;
      matchState.clock.sec = 0;
      broadcast();
    } catch(err){console.error(err);}
  });

  socket.on('overtime:start', () => {
    try {
      stopClock();
      matchState.overtime = true;
      matchState.clock.min = 5;
      matchState.clock.sec = 0;
      broadcast();
    } catch(err){console.error(err);}
  });

  // SCORES
  socket.on('score:add', ({ team, pts }) => {
    try {
      if (!['A','B'].includes(team)) return;
      if (![1,2].includes(pts)) return;
      matchState[`score${team}`] += pts;
      broadcast();
    } catch(err){console.error('Erreur score:add:', err);}
  });

  socket.on('score:sub', ({ team, pts }) => {
    try {
      if (!['A','B'].includes(team)) return;
      if (![1,2].includes(pts)) return;
      matchState[`score${team}`] = Math.max(0, matchState[`score${team}`]-pts);
      broadcast();
    } catch(err){console.error('Erreur score:sub:', err);}
  });

  // FAUTES
  socket.on('foul:add', ({ team }) => {
    try {
      if (!['A','B'].includes(team)) return;
      matchState[`foul${team}`]++;
      broadcast();
    } catch(err){console.error('Erreur foul:add:', err);}
  });

  socket.on('foul:sub', ({ team }) => {
    try {
      if (!['A','B'].includes(team)) return;
      matchState[`foul${team}`] = Math.max(0, matchState[`foul${team}`]-1);
      broadcast();
    } catch(err){console.error('Erreur foul:sub:', err);}
  });

  socket.on('disconnect', () => {
    console.log('❌ Client déconnecté');
  });
});

/* ============================
   SERVER
============================ */
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Socket server running on port ${PORT}`);
});
