import path from 'node:path';
import express, { type Express } from 'express';
import cors from 'cors';
import { env, isProd } from './lib/env';
import { errorHandler } from './lib/http';
import { initializeSqlite, deleteAllMeasurements } from './lib/sqlite';
import apiRouter from './routes';
import { hardnessMachineSerialService } from './lib/services/hardness-machine-serial.service';

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

export async function start(): Promise<StartResult> {
  await initializeSqlite();
  const cleared = deleteAllMeasurements();
  // eslint-disable-next-line no-console
  console.log(`[startup] measurements cleared on open count=${cleared}`);

  await hardnessMachineSerialService.ready();
  const app = createApp();
  return new Promise<StartResult>((resolve, reject) => {
    const server = app.listen(env.PORT, () => {
      console.log(`[backend] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
      resolve({ app, server, port: env.PORT });
    });
    server.on('error', reject);
  });
}

if (require.main === module) {
  start();
}
