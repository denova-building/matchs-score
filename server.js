const express = require('express');
const http = require('http');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);

/* ============================
   SOCKET.IO + CORS
============================ */
const io = require('socket.io')(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowedOrigins = [
        /\.onrender\.com$/,
        /\.mbolostats\.com$/,
        'https://onrender.com',
        'https://mbolostats.com'
      ];
      if (allowedOrigins.some(o => typeof o === 'string' ? o === origin : o.test(origin))) {
        callback(null, true);
      } else {
        callback(new Error('CORS not allowed'));
      }
    },
    methods: ['GET', 'POST']
  }
});

/* ============================
   MIDDLEWARE
============================ */
app.use(cors());
app.use(bodyParser.json());

/* ============================
   ROUTE HTTP POUR RENDER / TEST
============================ */
app.get('/', (req,res)=>{
  res.send('Server running ✅');
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
  clock: {
    min: 10,
    sec: 0,
    running: false,
    interval: null
  },
  possession: {
    team: null,
    sec: 12,
    running: false,
    interval: null
  }
};

/* ============================
   BROADCAST
============================ */
function broadcast() {
  io.emit('state:update', matchState);
}

/* ============================
   CHRONO PRINCIPAL
============================ */
function startClock() {
  if (matchState.clock.running) return;
  matchState.clock.running = true;

  matchState.clock.interval = setInterval(() => {
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
    broadcast();
  }, 1000);
}

function stopClock() {
  matchState.clock.running = false;
  clearInterval(matchState.clock.interval);
  matchState.clock.interval = null;
  broadcast();
}

/* ============================
   CHRONO POSSESSION
============================ */
function startPossession(team) {
  if (matchState.possession.running) return;
  matchState.possession.team = team;
  matchState.possession.sec = 12;
  matchState.possession.running = true;

  matchState.possession.interval = setInterval(() => {
    if (matchState.possession.sec <= 0) {
      stopPossession();
      return;
    }
    matchState.possession.sec--;
    io.emit('possession:update', {
      team: matchState.possession.team,
      sec: matchState.possession.sec,
      running: matchState.possession.running
    });
  }, 1000);
}

function stopPossession() {
  matchState.possession.running = false;
  clearInterval(matchState.possession.interval);
  matchState.possession.interval = null;
  io.emit('possession:update', {
    team: matchState.possession.team,
    sec: matchState.possession.sec,
    running: matchState.possession.running
  });
}

function resetPossession(team = null) {
  stopPossession();
  matchState.possession.team = team;
  matchState.possession.sec = 12;
  io.emit('possession:update', {
    team: matchState.possession.team,
    sec: matchState.possession.sec,
    running: matchState.possession.running
  });
}

/* ============================
   SOCKET.IO EVENTS
============================ */
io.on('connection', socket => {
  console.log('✅ Client connecté');

  // Envoi immédiat de l'état complet
  socket.emit('state:update', matchState);
  socket.emit('possession:update', matchState.possession);

  /* INIT MATCH */
  socket.on('match:init', data => {
    stopClock();
    stopPossession();

    matchState.teamA = data.teamA || 'ÉQUIPE A';
    matchState.teamB = data.teamB || 'ÉQUIPE B';
    matchState.scoreA = 0;
    matchState.scoreB = 0;
    matchState.foulA = 0;
    matchState.foulB = 0;
    matchState.quarter = 1;
    matchState.overtime = false;
    matchState.clock.min = parseInt(data.quarterTime) || 10;
    matchState.clock.sec = 0;

    broadcast();
  });

  /* CLOCK PRINCIPAL */
  socket.on('clock:start', startClock);
  socket.on('clock:stop', stopClock);
  socket.on('quarter:next', () => {
    stopClock();
    matchState.quarter++;
    matchState.clock.min = 10;
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

  /* SCORES */
  socket.on('score:add', ({ team, pts }) => {
    if (![1,2].includes(pts)) return;
    matchState[`score${team}`] += pts;
    broadcast();
  });
  socket.on('score:sub', ({ team, pts }) => {
    if (![1,2].includes(pts)) return;
    matchState[`score${team}`] = Math.max(0, matchState[`score${team}`] - pts);
    broadcast();
  });

  /* FAUTES */
  socket.on('foul:add', ({ team }) => {
    matchState[`foul${team}`]++;
    broadcast();
  });
  socket.on('foul:sub', ({ team }) => {
    matchState[`foul${team}`] = Math.max(0, matchState[`foul${team}`] - 1);
    broadcast();
  });

  /* POSSESSION */
  socket.on('possession:start', ({ team }) => startPossession(team));
  socket.on('possession:stop', stopPossession);
  socket.on('possession:reset', ({ team }) => resetPossession(team));

  socket.on('disconnect', () => console.log('❌ Client déconnecté'));
});

/* ============================
   SERVER
============================ */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Socket server running ${PORT}`);
});
