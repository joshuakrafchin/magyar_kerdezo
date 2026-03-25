const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));

// API & auth routes
app.use(routes);

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Magyar Kérdező running on port ${PORT}`);
});
