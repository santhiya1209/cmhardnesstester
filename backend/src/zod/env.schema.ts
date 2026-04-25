import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_NAME: z.string().min(1).default('HardnessTester'),
  PORT: z.coerce.number().int().positive().default(4000),
  DB_LOCATION: z.string().min(1).default('./data'),
  DB_FILENAME: z.string().min(1).default('hardness-tester.db'),
});

export type Env = z.infer<typeof EnvSchema>;
