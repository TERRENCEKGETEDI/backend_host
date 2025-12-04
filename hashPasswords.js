const bcrypt = require('bcryptjs');

const users = [
  { email: 'admin@example.com', password: 'admin123' },
  { email: 'manager@example.com', password: 'manager123' },
  { email: 'teamleader1@example.com', password: 'tl123' },
  { email: 'teamleader2@example.com', password: 'tl123' },
  { email: 'teamleader3@example.com', password: 'tl123' },
  { email: 'teamleader4@example.com', password: 'tl123' },
  { email: 'worker1@example.com', password: 'worker123' },
  { email: 'worker2@example.com', password: 'worker123' },
  // ... repeat for all 22 users
];

users.forEach(user => {
  const hash = bcrypt.hashSync(user.password, 10);
  console.log(`UPDATE users SET password='${hash}' WHERE email='${user.email}';`);
});
