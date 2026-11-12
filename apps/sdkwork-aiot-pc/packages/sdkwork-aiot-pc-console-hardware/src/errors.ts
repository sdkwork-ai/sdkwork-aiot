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

export function describeConsoleHardwareError(error: unknown): ConsoleHardwareError {
  const status = readStatus(error);
  const detail = error instanceof Error ? error.message.trim() : '';
  if (status === 401) {
    return { detail, key: 'unauthorized', status };
  }
  if (status === 403) {
    return { detail, key: 'forbidden', status };
  }
  if (status === 404) {
    return { detail, key: 'notFound', status };
  }
  if (status === 400 || status === 409 || status === 422) {
    return { detail, key: status === 409 ? 'conflict' : 'validation', status };
  }
  if (status !== undefined && status >= 500) {
    return { detail, key: 'unavailable', status };
  }
  return { detail, key: 'conflict', ...(status === undefined ? {} : { status }) };
}
