import { EnvSchema, type Env } from '../zod/env.schema';

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('[backend] invalid environment:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid backend environment configuration');
}

export const env: Env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
