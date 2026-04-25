import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export type Source = 'body' | 'query' | 'params';

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
    req.validated = {
      ...req.validated,
      [source]: result.data,
    };
    next();
  };
}

export type Validated<S extends ZodTypeAny> = z.infer<S>;
export type ValidatedRequest<TBody = unknown, TParams = unknown, TQuery = unknown> = Request & {
  validated: {
    body?: TBody;
    params?: TParams;
    query?: TQuery;
  };
};
export { ZodError };
