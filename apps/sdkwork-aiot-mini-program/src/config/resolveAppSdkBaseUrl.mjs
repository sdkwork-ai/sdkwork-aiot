/**
 * AIoT mini program application API base url resolver.
 *
 * Mini programs have no browser location context, so the host normally injects
 * an explicit base url via `configureAiotAppSdkBaseUrl`. When none is injected
 * the shared `SDKWORK_API_BASE_URL` is resolved through `@sdkwork/sdk-common`,
 * which picks the API host matching the current page environment + brand (or the
 * first configured candidate). Any `/app/v3/api` suffix is stripped to a bare
 * origin, matching the canonical base-url semantics used across SDKWork apps.
 *
 * This module is bundled by esbuild at build time so the `@sdkwork/sdk-common`
 * dependency is inlined into the mini program runtime.
 */
import { resolveBaseUrl, splitBaseUrls } from '@sdkwork/sdk-common';

const APP_API_PREFIX = '/app/v3/api';
const API_BASE_URL_ENV_KEY = 'SDKWORK_API_BASE_URL';

function normalizeApiBaseUrl(apiBaseUrl) {
  const trimmed = typeof apiBaseUrl === 'string' ? apiBaseUrl.trim() : '';
  if (!trimmed) {
    return trimmed;
  }
  let base = trimmed.replace(/\/+$/u, '');
  if (base === APP_API_PREFIX) {
    return '';
  }
  if (base.endsWith(APP_API_PREFIX)) {
    base = base.slice(0, -APP_API_PREFIX.length);
  }
  return base.replace(/\/+$/u, '');
}

export function resolveAiotAppSdkBaseUrl(apiBaseUrl) {
  const [configured = ''] = splitBaseUrls(
    apiBaseUrl ?? resolveBaseUrl({ envKey: API_BASE_URL_ENV_KEY }).url,
  );
  return normalizeApiBaseUrl(configured);
}
