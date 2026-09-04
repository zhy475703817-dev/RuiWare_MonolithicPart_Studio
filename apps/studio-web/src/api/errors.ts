export type ApiErrorPayload = {
  code: string;
  message: string;
  action?: string | null;
  fields: { path?: string; message: string; type?: string }[];
  traceId?: string;
  retryable?: boolean;
  context?: Record<string, unknown>;
};

export type ErrorNotice = {
  code: string;
  message: string;
  action?: string | null;
  fields: { path?: string; message: string; type?: string }[];
  traceId?: string;
  retryable?: boolean;
  context?: Record<string, unknown>;
};

export class ApiError extends Error {
  readonly code: string;
  readonly action?: string | null;
  readonly fields: { path?: string; message: string; type?: string }[];
  readonly traceId?: string;
  readonly retryable: boolean;
  readonly context: Record<string, unknown>;
  readonly status: number;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.name = "ApiError";
    this.status = status;
    this.code = payload.code;
    this.action = payload.action;
    this.fields = payload.fields || [];
    this.traceId = payload.traceId;
    this.retryable = payload.retryable ?? false;
    this.context = payload.context || {};
  }
}

export function toErrorNotice(error: unknown): ErrorNotice {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      message: error.message,
      action: error.action,
      fields: error.fields,
      traceId: error.traceId,
      retryable: error.retryable,
      context: error.context,
    };
  }
  if (error instanceof Error) {
    return { code: "CLIENT_ERROR", message: error.message, fields: [] };
  }
  return { code: "CLIENT_ERROR", message: String(error), fields: [] };
}
