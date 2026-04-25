import type { Request, Response } from 'express';
import { getDatabaseFilePath } from '../lib/db';
import { env } from '../lib/env';

export function getHealth(_req: Request, res: Response) {
  res.json({
    ok: true,
    env: env.NODE_ENV,
    db: {
      location: env.DB_LOCATION,
      filename: env.DB_FILENAME,
      path: getDatabaseFilePath(),
    },
  });
}
