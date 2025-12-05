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

// =======================
// CORS Config
// =======================
const allowedOrigins = [
  'https://frontend-host-8p8p.onrender.com',
  'https://water-guard-app.web.app', // your hosted frontend
  'http://localhost:3000'            // optional, for local dev
];

app.use(cors({
  origin: function(origin, callback){
    // allow requests with no origin (like mobile apps or Postman)
    if(!origin) return callback(null, true);
    if(allowedOrigins.indexOf(origin) === -1){
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  methods: ['GET','POST','PUT','DELETE'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true
}));

// =======================
// Body Parser
// =======================
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// =======================
// Database
// =======================
sequelize.authenticate()
  .then(() => console.log('Database connected'))
  .then(() => sequelize.sync())
  .then(() => console.log('Models synced'))
  .catch(err => console.error('Database error:', err));

// =======================
// Routes
// =======================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/manager', require('./routes/manager'));
app.use('/api/public', require('./routes/public'));
app.use('/api/teamleader', require('./routes/teamleader'));
app.use('/api/worker', require('./routes/worker'));

// =======================
// Socket.IO
// =======================
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET','POST'],
    credentials: true
  }
});

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if(token){
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findByPk(decoded.id);
      if(user){
        socket.user = user;
        return next();
      }
    } catch(err){
      console.error('Socket auth error:', err);
    }
  }
  next(new Error('Authentication error'));
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.user?.name);
  if(socket.user){
    socket.join(`user_${socket.user.id}`);
    socket.join(`role_${socket.user.role}`);
  }

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.user?.name);
  });
});

// =======================
// Global Notifications
// =======================
global.sendNotification = (userId, event, data) => io.to(`user_${userId}`).emit(event, data);
global.sendRoleNotification = (role, event, data) => io.to(`role_${role}`).emit(event, data);

// =======================
// Test route
// =======================
app.get('/', (req,res) => res.send('Sewage Management API'));

// =======================
// Start server
// =======================
const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
});