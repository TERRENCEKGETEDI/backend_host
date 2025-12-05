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
    origin: "https://water-guard-app.web.app", // hosted frontend
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 5000;

// ===================
// Middleware
// ===================
app.use(cors({
  origin: 'https://water-guard-app.web.app', // hosted frontend
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ===================
// Database Connection
// ===================
sequelize.authenticate()
  .then(() => {
    console.log('Database connected');
    return sequelize.sync();
  })
  .then(() => console.log('Models synced'))
  .catch(err => console.error('Database error:', err));

// ===================
// Routes
// ===================
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const managerRoutes = require('./routes/manager');
const publicRoutes = require('./routes/public');
const teamleaderRoutes = require('./routes/teamleader');
const workerRoutes = require('./routes/worker');

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/manager', managerRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/teamleader', teamleaderRoutes);
app.use('/api/worker', workerRoutes);

// ===================
// SOCKET.IO Auth
// ===================
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

io.on('connection', (socket) => {
  console.log('User connected:', socket.user.name);

  socket.join(`user_${socket.user.id}`);
  socket.join(`role_${socket.user.role}`);

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.user.name);
  });
});

// Global Notifications
global.sendNotification = (userId, event, data) => {
  io.to(`user_${userId}`).emit(event, data);
};

global.sendRoleNotification = (role, event, data) => {
  io.to(`role_${role}`).emit(event, data);
};

// ===================
// Test Routes
// ===================
app.get('/', (req, res) => {
  res.send('Sewage Management API');
});

app.get('/test-db', async (req, res) => {
  try {
    const users = await User.findAll({ limit: 1 });
    res.json({ success: true, data: users });
  } catch (err) {
    console.error('Test DB error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===================
// Start Server
// ===================
server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);

  try {
    const AutomatedSchedulingService = require('./services/AutomatedSchedulingService');

    if (process.env.AUTOMATION_ENABLED === 'true') {
      AutomatedSchedulingService.startScheduling();
      console.log('Automated scheduling service started');
    } else {
      console.log('Automated scheduling service disabled');
    }

  } catch (error) {
    console.error('Failed to initialize automated scheduling service:', error);
  }
});
