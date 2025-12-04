require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');

const { sequelize, User } = require('./models');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ===== Test DB connection with Sequelize =====
sequelize.authenticate()
  .then(() => {
    console.log('Connecting to PostgreSQL database...');
    return sequelize.sync();
  })
  .then(() => console.log('Models synced'))
  .catch(err => {
    console.error('Database error:', err);
  });

// ==== ROUTES ====
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/manager', require('./routes/manager'));
app.use('/api/public', require('./routes/public'));
app.use('/api/teamleader', require('./routes/teamleader'));
app.use('/api/worker', require('./routes/worker'));

// ===== SOCKET.IO AUTH =====
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findByPk(decoded.id);

      if (user) {
        socket.user = user;
        return next();
      }
    } catch (err) {
      console.error('Socket authentication error:', err);
    }
  }
  return next(new Error('Authentication error'));
});

// ===== SOCKET.IO EVENTS =====
io.on('connection', (socket) => {
  console.log('User connected:', socket.user?.name);

  if (socket.user) {
    socket.join(`user_${socket.user.id}`);
    socket.join(`role_${socket.user.role}`);
  }

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.user?.name);
  });
});

// ===== GLOBAL NOTIFICATION FUNCTIONS =====
global.sendNotification = (userId, event, data) => {
  io.to(`user_${userId}`).emit(event, data);
};

global.sendRoleNotification = (role, event, data) => {
  io.to(`role_${role}`).emit(event, data);
};

// ===== DEFAULT ROUTE =====
app.get('/', (req, res) => {
  res.send('Sewage Management API');
});

// ===== DEBUG: TEST DB ROUTE =====
app.get('/test-db', async (req, res) => {
  try {
    const users = await User.findAll({ limit: 1 });
    res.json({ success: true, data: users });
  } catch (err) {
    console.error('Test DB error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== START SERVER =====
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  try {
    const AutomatedSchedulingService = require('./services/AutomatedSchedulingService');

    if (process.env.AUTOMATION_ENABLED === 'true') {
      AutomatedSchedulingService.startScheduling();
      console.log('Automated scheduling service initialized and started');
    } else {
      console.log('Automated scheduling service available but disabled');
    }

  } catch (error) {
    console.error('Failed to initialize automated scheduling service:', error);
  }
});
