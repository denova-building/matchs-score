const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

/* ============================
   CORS
============================ */
app.use(cors({
  origin: 'https://mbolostats.com',
  methods: ['GET','POST'],
  credentials: true
}));

/* ============================
   SOCKET.IO
============================ */
const io = new Server(server, {
  cors: {
    origin: 'https://mbolostats.com',
    methods: ['GET','POST'],
    credentials: true
  },
  transports: ['websocket', 'polling']
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
  },
  possession: {
    team: 'A',
    time: 12,
    running: false,
    interval: null
  }
};

/* ============================
   BROADCAST SAFE
============================ */
function broadcast() {
  const safeState = {
    teamA: matchState.teamA,
    teamB: matchState.teamB,
    scoreA: matchState.scoreA,
    scoreB: matchState.scoreB,
    foulA: matchState.foulA,
    foulB: matchState.foulB,
    quarter: matchState.quarter,
    overtime: matchState.overtime,
    clock: {
      min: matchState.clock.min,
      sec: matchState.clock.sec
    },
    possession: {
      team: matchState.possession.team,
      time: matchState.possession.time
    }
  };
  io.emit('state:update', safeState);
}

/* ============================
   CHRONO PRINCIPAL
============================ */
function tickMainClock() {
  if (!matchState.clock.running) return;

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
  if (matchState.clock.running) return;
  matchState.clock.running = true;
  matchState.clock.interval = setInterval(tickMainClock, 1000);
}

function stopMainClock() {
  matchState.clock.running = false;
  if (matchState.clock.interval) {
    clearInterval(matchState.clock.interval);
    matchState.clock.interval = null;
  }

  // Stopper aussi le chrono de possession
  if (matchState.possession.running) stopPossession();
}

/* ============================
   CHRONO DE POSSESSION
============================ */
function tickPossession() {
  if (!matchState.possession.running) return;

  if (matchState.possession.time === 0) {
    stopPossession();
    return;
  }

  matchState.possession.time--;
  broadcast();
}


function startPossession(team) {
  console.log(matchState.possession.running);
  console.log(matchState.possession.time);
    // Si déjà en cours, ne rien faire
    if (matchState.possession.running) return;

    // Si le temps était déjà entamé, on reprend, sinon on remet à 12
    if (!matchState.possession.time || matchState.possession.time <= 0) {
        matchState.possession.time = 12;
    }

    matchState.possession.team = team;
    matchState.possession.running = true;
    matchState.possession.interval = setInterval(() => {
      if (!matchState.possession.running) return;

      if (matchState.possession.time === 0) {
        stopPossession();
        return;
      }

      matchState.possession.time--;
      broadcast(); // ✅ UN SEUL canal
    }, 1000);


    /*matchState.possession.interval = setInterval(() => {
        if (!matchState.possession.running) return;

        if (matchState.possession.time === 0) {
            stopPossession();
            return;
        }

        matchState.possession.time--;
        io.emit('possession:update', {
            team: matchState.possession.team,
            time: matchState.possession.time,
            running: matchState.possession.running
        });
    }, 1000);*/
}

function stopPossession() {
  matchState.possession.running = false;
  clearInterval(matchState.possession.interval);
  matchState.possession.interval = null;
}


/*function stopPossession() {
    matchState.possession.running = false;
    clearInterval(matchState.possession.interval);
    matchState.possession.interval = null;

    io.emit('possession:update', {
        team: matchState.possession.team,
        time: matchState.possession.time,
        running: matchState.possession.running
    });
}*/



function resetPossession() {
  stopPossession();
  //matchState.possession.team = null;
  matchState.possession.team = 'A';
  matchState.possession.time = 12;
  broadcast();
}

/* ============================
   SOCKET EVENTS
============================ */
io.on('connection', socket => {
  console.log('✅ Client connecté');

  socket.emit('state:update', {
    ...matchState,
    clock: { min: matchState.clock.min, sec: matchState.clock.sec },
    possession: { team: matchState.possession.team, time: matchState.possession.time }
  });

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

    broadcast();
  });

  /* CLOCK */
  socket.on('clock:start', startMainClock);
  socket.on('clock:stop', stopMainClock);

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
    if (!['A','B'].includes(team)) return;
    if (![1,2].includes(pts)) return;
    matchState[`score${team}`] += pts;
    broadcast();
  });

  socket.on('score:sub', ({ team, pts }) => {
    if (!['A','B'].includes(team)) return;
    if (![1,2].includes(pts)) return;
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
    startMainClock(); //chrono global
    startPossession(team);
    broadcast();
  });

  /*socket.on('possession:stop', () => {
    stopPossession();
    broadcast();
  });*/

  socket.on('possession:reset', () => {
    resetPossession();
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
  console.log(`🚀 Serveur lancé sur ${PORT}`);
});
