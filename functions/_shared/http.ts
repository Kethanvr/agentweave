export class AppError extends Error {
  constructor(
    message: string,
    public readonly code = "INTERNAL",
    public readonly status = 400,
  ) {
    super(message);
  }
}

export type FunctionRequest = {
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  get?: (name: string) => string | undefined;
};

export type FunctionResponse = {
  status: (status: number) => FunctionResponse;
  json: (body: unknown) => void;
};

export function getHeader(req: FunctionRequest, name: string): string | undefined {
  const direct = req.get?.(name);
  if (direct) return direct;
  const value = req.headers?.[name.toLowerCase()] ?? req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

export function assertHasuraWebhook(req: FunctionRequest): void {
  const expected = process.env.NHOST_WEBHOOK_SECRET;
  if (!expected) throw new AppError("NHOST_WEBHOOK_SECRET is not configured", "CONFIGURATION", 500);
  if (getHeader(req, "x-nhost-webhook-secret") !== expected) {
    throw new AppError("Invalid webhook signature", "FORBIDDEN", 401);
  }
}

export function sendError(res: FunctionResponse, error: unknown): void {
  const appError = error instanceof AppError
    ? error
    : new AppError(error instanceof Error ? error.message : "Unexpected error", "INTERNAL", 500);

  res.status(appError.status).json({
    message: appError.message,
    extensions: { code: appError.code },
  });
}
