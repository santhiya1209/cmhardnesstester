import path from 'node:path';
import express, { type Express } from 'express';
import cors from 'cors';
import { env, isProd } from './lib/env';
import apiRouter from './routes';

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  if (!isProd) {
    app.use(cors());
  }

  app.use('/api', apiRouter);

  if (isProd) {
    const frontendDist = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
    app.use(express.static(frontendDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  return app;
}

export interface StartResult {
  app: Express;
  server: import('node:http').Server;
  port: number;
}

export function start(): Promise<StartResult> {
  return new Promise((resolve) => {
    const app = createApp();
    const server = app.listen(env.PORT, () => {
      console.log(`[backend] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
      resolve({ app, server, port: env.PORT });
    });
  });
}

if (require.main === module) {
  start();
}
