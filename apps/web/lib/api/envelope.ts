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
