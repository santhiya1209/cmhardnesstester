import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from './errors';

type AsyncRequestHandler = (
  ...args: Parameters<RequestHandler>
) => Promise<unknown> | unknown;

export function asyncHandler(handler: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: error.code,
      message: error.message,
      details: error.details,
    });
    return;
  }

  console.error('[backend] unhandled error:', error);
  res.status(500).json({
    error: 'InternalServerError',
    message: 'An unexpected error occurred.',
  });
};
