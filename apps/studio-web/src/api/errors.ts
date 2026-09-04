export type ApiErrorPayload = {
  code: string;
  message: string;
  action?: string | null;
  fields: { path?: string; message: string; type?: string }[];
  traceId?: string;
};

export type ErrorNotice = {
  code: string;
  message: string;
  action?: string | null;
  fields: { path?: string; message: string; type?: string }[];
  traceId?: string;
};

export class ApiError extends Error {
  readonly code: string;
  readonly action?: string | null;
  readonly fields: { path?: string; message: string; type?: string }[];
  readonly traceId?: string;
  readonly status: number;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.name = "ApiError";
    this.status = status;
    this.code = payload.code;
    this.action = payload.action;
    this.fields = payload.fields || [];
    this.traceId = payload.traceId;
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
    };
  }
  if (error instanceof Error) {
    return { code: "CLIENT_ERROR", message: error.message, fields: [] };
  }
  return { code: "CLIENT_ERROR", message: String(error), fields: [] };
}
