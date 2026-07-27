export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "NOT_IMPLEMENTED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, httpStatus: number, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

/**
 * The `details` payload of a VALIDATION_ERROR. `apps/ios` decodes this shape to tell the user which
 * field failed (see APIError.swift and docs/api.md) — renaming a field here is a client break, so
 * keep `toAppError` building it through this type rather than an inline object literal.
 */
export interface ValidationIssue {
  /** Dotted path to the offending field, e.g. `items.0.lineTotal`. */
  path: string;
  message: string;
}

export interface ValidationDetails {
  issues: ValidationIssue[];
}

export interface ApiSuccessEnvelope<T> {
  data: T;
}

export interface ApiErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export function dataEnvelope<T>(data: T): ApiSuccessEnvelope<T> {
  return { data };
}

export function errorEnvelope(error: AppError): ApiErrorEnvelope {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined && { details: error.details }),
    },
  };
}

export function notImplemented(message = "Not implemented yet."): AppError {
  return new AppError("NOT_IMPLEMENTED", message, 501);
}
