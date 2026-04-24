import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

type Source = 'body' | 'query' | 'params';

export function validate<S extends ZodTypeAny>(schema: S, source: Source = 'body'): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      res.status(400).json({
        error: 'ValidationError',
        details: result.error.flatten(),
      });
      return;
    }
    (req as Request & { validated?: Record<Source, unknown> }).validated = {
      ...(req as Request & { validated?: Record<Source, unknown> }).validated,
      [source]: result.data,
    } as Record<Source, unknown>;
    next();
  };
}

export type Validated<S extends ZodTypeAny> = z.infer<S>;
export { ZodError };
