const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

/* ============================
   CORS EXPRESS (OBLIGATOIRE)
============================ */
app.use(cors({
  origin: [
    'https://mbolostats.com',
    'https://www.mbolostats.com'
  ],
  methods: ['GET', 'POST'],
  credentials: true
}));

app.get('/', (req, res) => {
  res.send('Socket server running ✅');
});

/* ============================
   SOCKET.IO — RENDER SAFE
============================ */
const io = new Server(server, {
  transports: ['polling', 'websocket'],
  cors: {
    origin: [
      'https://mbolostats.com',
      'https://www.mbolostats.com'
    ],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

/* ============================
   MATCH STATE (JSON PUR)
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
    running: false
  },
  possession: {
    team: null,
    time: 12,
    running: false
  }
};

/* ============================
   RUNTIME (INTERVALS SEULEMENT)
============================ */
const runtime = {
  clockInterval: null,
  possessionInterval: null
};

/* ============================
   EMITS SÉPARÉS (IMPORTANT)
============================ */
const emitState = () => {
  io.emit('state:update', {
    teamA: matchState.teamA,
    teamB: matchState.teamB,
    scoreA: matchState.scoreA,
    scoreB: matchState.scoreB,
    foulA: matchState.foulA,
    foulB: matchState.foulB,
    quarter: matchState.quarter
  });
};

const emitClock = () => {
  io.emit('clock:update', {
    min: matchState.clock.min,
    sec: matchState.clock.sec,
    running: matchState.clock.running
  });
};

const emitPossession = () => {
  io.emit('possession:update', {
    team: matchState.possession.team,
    time: matchState.possession.time,
    running: matchState.possession.running
  });
};

/* ============================
   CHRONO PRINCIPAL
============================ */
function startClock() {
  if (runtime.clockInterval) return;

  matchState.clock.running = true;

  runtime.clockInterval = setInterval(() => {
    if (matchState.clock.min === 0 && matchState.clock.sec === 0) {
      stopClock();
      return;
    }

    if (matchState.clock.sec === 0) {
      matchState.clock.min--;
      matchState.clock.sec = 59;
    } else {
      matchState.clock.sec--;
    }

    emitClock();
  }, 1000);
}

function stopClock() {
  clearInterval(runtime.clockInterval);
  runtime.clockInterval = null;
  matchState.clock.running = false;
  emitClock();
}

/* ============================
   CHRONO POSSESSION 12s
============================ */
function startPossession(team) {
  stopPossession();

  matchState.possession.team = team;
  matchState.possession.time = 12;
  matchState.possession.running = true;

  runtime.possessionInterval = setInterval(() => {
    if (matchState.possession.time <= 0) {
      stopPossession();
      return;
    }

    matchState.possession.time--;
    emitPossession();
  }, 1000);
}

function stopPossession() {
  clearInterval(runtime.possessionInterval);
  runtime.possessionInterval = null;
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
  console.log('✅ Client connecté');

  emitState();
  emitClock();
  emitPossession();

  /* INIT MATCH */
  socket.on('match:init', data => {
    stopClock();
    resetPossession();

    matchState.teamA = data.teamA || 'Équipe A';
    matchState.teamB = data.teamB || 'Équipe B';
    matchState.defaultQuarterTime = parseInt(data.quarterTime) || 10;

    matchState.scoreA = 0;
    matchState.scoreB = 0;
    matchState.foulA = 0;
    matchState.foulB = 0;
    matchState.quarter = 1;
    matchState.overtime = false;

    matchState.clock.min = matchState.defaultQuarterTime;
    matchState.clock.sec = 0;

    emitState();
    emitClock();
  });

  /* CLOCK */
  socket.on('clock:start', startClock);
  socket.on('clock:stop', stopClock);

  socket.on('quarter:next', () => {
    stopClock();
    matchState.quarter++;
    matchState.clock.min = matchState.defaultQuarterTime;
    matchState.clock.sec = 0;
    emitState();
    emitClock();
  });

  socket.on('overtime:start', () => {
    stopClock();
    matchState.overtime = true;
    matchState.clock.min = 5;
    matchState.clock.sec = 0;
    emitState();
    emitClock();
  });

  /* SCORES */
  socket.on('score:add', ({ team, pts }) => {
    if (!['A', 'B'].includes(team)) return;
    if (![1, 2].includes(pts)) return;
    matchState[`score${team}`] += pts;
    emitState();
  });

  socket.on('score:sub', ({ team, pts }) => {
    if (!['A', 'B'].includes(team)) return;
    if (![1, 2].includes(pts)) return;
    matchState[`score${team}`] = Math.max(0, matchState[`score${team}`] - pts);
    emitState();
  });

  /* FAUTES */
  socket.on('foul:add', ({ team }) => {
    if (!['A', 'B'].includes(team)) return;
    matchState[`foul${team}`]++;
    emitState();
  });

  socket.on('foul:sub', ({ team }) => {
    if (!['A', 'B'].includes(team)) return;
    matchState[`foul${team}`] = Math.max(0, matchState[`foul${team}`] - 1);
    emitState();
  });

  /* POSSESSION */
  socket.on('possession:start', ({ team }) => {
    if (!['A', 'B'].includes(team)) return;
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
