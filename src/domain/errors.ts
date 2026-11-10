export type ErrorCode = "not_found" | "conflict" | "forbidden" | "unauthorized" | "invalid_request" | "expired" | "config";

const STATUS: Record<ErrorCode, number> = {
  not_found: 404,
  conflict: 409,
  forbidden: 403,
  unauthorized: 401,
  invalid_request: 400,
  expired: 410,
  config: 500,
};

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
  get status() {
    return STATUS[this.code];
  }
}

export const notFound = (what: string) => new AppError("not_found", `${what} not found`);
export const conflict = (msg: string) => new AppError("conflict", msg);
export const forbidden = (msg: string) => new AppError("forbidden", msg);
