export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(resourceName: string, id: string) {
    super(404, 'NotFound', `${resourceName} with id "${id}" was not found.`, {
      resourceName,
      id,
    });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, 'Conflict', message, details);
  }
}

export class InvalidReferenceError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'InvalidReference', message, details);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, details?: unknown) {
    super(500, 'DatabaseError', message, details);
  }
}
