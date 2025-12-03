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
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Test DB connection and sync models
sequelize.authenticate()
  .then(() => {
    console.log('Database connected');
    return sequelize.sync(); // Sync models with DB
  })
  .then(() => console.log('Models synced'))
  .catch(err => console.error('Database error:', err));

// Routes
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

// Socket.io connection handling
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

  // Join user-specific room
  socket.join(`user_${socket.user.id}`);

  // Join role-specific room
  socket.join(`role_${socket.user.role}`);

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.user.name);
  });
});

// Global notification function
global.sendNotification = (userId, event, data) => {
  io.to(`user_${userId}`).emit(event, data);
};

global.sendRoleNotification = (role, event, data) => {
  io.to(`role_${role}`).emit(event, data);
};

app.get('/', (req, res) => {
  res.send('Sewage Management API');
});

server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  // Initialize automated scheduling service
  try {
    const AutomatedSchedulingService = require('./services/AutomatedSchedulingService');
    
    // Start automated scheduling if enabled
    if (process.env.AUTOMATION_ENABLED === 'true') {
      AutomatedSchedulingService.startScheduling();
      console.log('Automated scheduling service initialized and started');
    } else {
      console.log('Automated scheduling service available but disabled (set AUTOMATION_ENABLED=true to enable)');
    }
  } catch (error) {
    console.error('Failed to initialize automated scheduling service:', error);
  }
});