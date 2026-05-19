export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    isOperational = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource", id?: string) {
    const message = id
      ? `${resource} with ID '${id}' not found`
      : `${resource} not found`;
    super(message, 404, "NOT_FOUND");
  }
}

export class ValidationError extends AppError {
  public readonly errors: Record<string, string[]>;

  constructor(
    message = "Validation failed",
    errors: Record<string, string[]> = {}
  ) {
    super(message, 400, "VALIDATION_ERROR");
    this.errors = errors;
  }
}

export class ConflictError extends AppError {
  constructor(message = "Resource already exists") {
    super(message, 409, "CONFLICT");
  }
}

/**
 * Thrown when an optimistic-locking version check fails (batch 1H).
 *
 * The expected version supplied by the caller no longer matches what's in
 * the database — another process has committed a write since the caller
 * last read. The HTTP layer surfaces this as 409 with a structured body
 * so the client can decide whether to refetch + retry or surface to the
 * user.
 */
export class OptimisticLockError extends AppError {
  public readonly entityType: string;
  public readonly entityId: string;
  public readonly expectedVersion: number;

  constructor(entityType: string, entityId: string, expectedVersion: number) {
    super(
      `${entityType}:${entityId} was modified by another process (expected version ${expectedVersion}). Refetch and retry.`,
      409,
      "OPTIMISTIC_LOCK_CONFLICT"
    );
    this.entityType = entityType;
    this.entityId = entityId;
    this.expectedVersion = expectedVersion;
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super(message, 403, "FORBIDDEN");
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, 401, "UNAUTHORIZED");
  }
}
