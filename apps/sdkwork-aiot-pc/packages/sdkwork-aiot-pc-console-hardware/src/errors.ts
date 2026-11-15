/**
 * Failure classification shared by the Smart Hardware console view and service.
 *
 * Kept in its own module so the view never has to import the service module (which
 * resolves the AIoT PC runtime clients) just to render an error message.
 */

export type ConsoleHardwareErrorKey =
  | 'conflict'
  | 'forbidden'
  | 'notFound'
  | 'unauthorized'
  | 'unavailable'
  | 'validation';

export interface ConsoleHardwareError {
  detail: string;
  key: ConsoleHardwareErrorKey;
  status?: number;
}

function readProblem(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const record = value as Record<string, unknown>;
  return record.problem && typeof record.problem === 'object'
    ? (record.problem as Record<string, unknown>)
    : {};
}

function readStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const record = error as Record<string, unknown>;
  const problem = readProblem(error);
  for (const candidate of [problem.status, record.status, record.httpStatus]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function readDetail(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const record = error as Record<string, unknown>;
  const problem = readProblem(error);
  for (const candidate of [problem.detail, problem.title, record.detail]) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return error instanceof Error ? error.message.trim() : '';
}

export function describeConsoleHardwareError(error: unknown): ConsoleHardwareError {
  const status = readStatus(error);
  const detail = readDetail(error);
  if (status === 401) {
    return { detail, key: 'unauthorized', status };
  }
  if (status === 403) {
    return { detail, key: 'forbidden', status };
  }
  if (status === 404) {
    return { detail, key: 'notFound', status };
  }
  if (status === 409) {
    return { detail, key: 'conflict', status };
  }
  if (status === 400 || status === 422) {
    return { detail, key: 'validation', status };
  }
  // Rate limits, upstream 5xx, and transport failures (no HTTP status) are all
  // "try again shortly" from the operator's point of view.
  return { detail, key: 'unavailable', ...(status === undefined ? {} : { status }) };
}
