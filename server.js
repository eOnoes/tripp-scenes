const express = require('express');
const path = require('path');

const app = express();
const preferredPort = Number(process.env.PORT) || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function listen(port) {
  const server = app.listen(port, () => {
    console.log(`Tripp.Scenes running at http://localhost:${port}`);
  });

  server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
      listen(port + 1);
      return;
    }

    throw error;
  });
}

listen(preferredPort);
