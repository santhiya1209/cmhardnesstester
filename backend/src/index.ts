import path from 'node:path';
import express, { type Express } from 'express';
import cors from 'cors';
import { env, isProd } from './lib/env';
import { errorHandler } from './lib/http';
import { mutateDatabase } from './lib/db';
import apiRouter from './routes';

async function clearMeasurementsOnStartup(): Promise<void> {
  await mutateDatabase((database) => ({
    database: { ...database, measurements: [] },
    result: undefined,
  }));
}

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

  app.use(errorHandler);

  return app;
}

export interface StartResult {
  app: Express;
  server: import('node:http').Server;
  port: number;
}

export function start(): Promise<StartResult> {
  return new Promise((resolve, reject) => {
    clearMeasurementsOnStartup()
      .then(() => {
        const app = createApp();
        const server = app.listen(env.PORT, () => {
          console.log(`[backend] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
          resolve({ app, server, port: env.PORT });
        });
      })
      .catch(reject);
  });
}

if (require.main === module) {
  start();
}
