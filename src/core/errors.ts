export class AtsError extends Error {
  readonly code: string;
  readonly hint?: string;
  override readonly cause?: unknown;

  constructor(code: string, message: string, opts: { hint?: string; cause?: unknown } = {}) {
    super(message);
    this.name = 'AtsError';
    this.code = code;
    this.hint = opts.hint;
    this.cause = opts.cause;
  }
}

export class ConfigError extends AtsError {
  constructor(message: string, hint?: string) {
    super('CONFIG_ERROR', message, { hint });
    this.name = 'ConfigError';
  }
}

export class ApiError extends AtsError {
  readonly status: number;
  readonly url: string;
  readonly body?: unknown;

  constructor(
    status: number,
    url: string,
    message: string,
    opts: { body?: unknown; hint?: string; cause?: unknown } = {},
  ) {
    super(`API_${status}`, message, { hint: opts.hint, cause: opts.cause });
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
    this.body = opts.body;
  }
}

export class SyncStateError extends AtsError {
  constructor(message: string, hint?: string) {
    super('SYNC_STATE_ERROR', message, { hint });
    this.name = 'SyncStateError';
  }
}

export function explainError(err: unknown): string {
  if (err instanceof AtsError) {
    return err.hint ? `${err.message}\n  hint: ${err.hint}` : err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
