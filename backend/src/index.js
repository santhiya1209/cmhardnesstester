const path = require('path');
const express = require('express');
const cors = require('cors');

const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 4000;

function createApp() {
  const app = express();
  app.use(express.json());

  if (!isProd) {
    app.use(cors());
  }

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      env: process.env.NODE_ENV,
      db: {
        location: process.env.DB_LOCATION,
        filename: process.env.DB_FILENAME,
      },
    });
  });

  if (isProd) {
    const frontendDist = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
    app.use(express.static(frontendDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  return app;
}

function start() {
  return new Promise((resolve) => {
    const app = createApp();
    const server = app.listen(PORT, () => {
      console.log(`[backend] listening on http://localhost:${PORT} (${process.env.NODE_ENV})`);
      resolve({ app, server, port: PORT });
    });
  });
}

module.exports = { createApp, start };

if (require.main === module) {
  start();
}
