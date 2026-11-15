import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

import type { ConsoleHardwareDevice, ConsoleHardwareProduct } from './hardware.ts';
import type { HardwareConsoleCopy } from './copy.ts';

/**
 * Shared chrome for the two Smart Hardware console pages.
 *
 * The device registry and the firmware catalog are separate routes and separate
 * pages: each page owns its own data loading, and the only thing they share is the
 * page frame (title, action slot, cross-page navigation, error/notice/loading
 * presentation). Keeping the frame here means a host renders one page per URL and
 * never mounts the other page's data.
 */

export type ConsoleHardwareScreen = 'devices' | 'firmware';

export type HardwarePageErrorState = {
  detail: string;
  key: keyof HardwareConsoleCopy['errors'];
};

export const HEALTH_TONE: Record<ConsoleHardwareDevice['health'], string> = {
  critical:
    'border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300',
  healthy:
    'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
  offline:
    'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400',
  warning:
    'border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
};

export function Panel({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
      {title ? (
        <header className="border-b border-zinc-100 dark:border-zinc-800/70 px-5 py-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function StatTile({ label, tone, value }: { label: string; tone?: string; value: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone ?? 'text-zinc-900 dark:text-zinc-100'}`}>{value}</p>
    </div>
  );
}

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = '', children, ...rest } = props;
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 px-3.5 py-2 text-sm font-semibold text-white dark:text-zinc-900 transition hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = '', children, ...rest } = props;
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3.5 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 transition hover:border-zinc-300 dark:hover:border-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface HardwarePageShellProps {
  children: ReactNode;
  className?: string;
  copy: HardwareConsoleCopy;
  description: string;
  error: HardwarePageErrorState | null;
  loading: boolean;
  notice: string | null;
  /** Cross-page navigation; when absent the shell renders no page switcher. */
  onNavigate?: (screen: ConsoleHardwareScreen) => void;
  onRefresh: () => void;
  /** Primary action slot (device registration); omitted on read-only pages. */
  onRegister?: () => void;
  screen: ConsoleHardwareScreen;
  title: string;
}

export function HardwarePageShell({
  children,
  className,
  copy,
  description,
  error,
  loading,
  notice,
  onNavigate,
  onRefresh,
  onRegister,
  screen,
  title,
}: HardwarePageShellProps) {
  const errorText = error ? copy.errors[error.key] : '';
  const tabs: ReadonlyArray<readonly [ConsoleHardwareScreen, string]> = [
    ['devices', copy.tabDevices],
    ['firmware', copy.tabFirmware],
  ];

  return (
    <div className={`flex h-full min-h-0 w-full min-w-0 flex-col gap-4 overflow-y-auto ${className ?? ''}`.trim()}>
      <div className="flex w-full min-w-0 flex-col gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{title}</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">{description}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <SecondaryButton onClick={onRefresh} disabled={loading}>
              {copy.refresh}
            </SecondaryButton>
            {onRegister ? <PrimaryButton onClick={onRegister}>{copy.register}</PrimaryButton> : null}
          </div>
        </header>

        {onNavigate ? (
          <nav
            aria-label={copy.title}
            className="flex flex-wrap items-center gap-1 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1 shadow-sm"
          >
            {tabs.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-current={screen === id ? 'page' : undefined}
                onClick={() => {
                  if (screen !== id) {
                    onNavigate(id);
                  }
                }}
                className={
                  screen === id
                    ? 'rounded-xl bg-zinc-900 dark:bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-white dark:text-zinc-900'
                    : 'rounded-xl px-3 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 hover:text-zinc-800 dark:hover:text-zinc-200'
                }
              >
                {label}
              </button>
            ))}
          </nav>
        ) : null}

        {error ? (
          <div role="alert" className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
            <p className="font-semibold">{errorText}</p>
            {error.detail ? <p className="mt-1 text-xs leading-5">{error.detail}</p> : null}
            <SecondaryButton className="mt-3" onClick={onRefresh}>
              {copy.retry}
            </SecondaryButton>
          </div>
        ) : null}

        {notice ? (
          <div role="status" className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            {notice}
          </div>
        ) : null}

        {loading ? (
          <div role="status" className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {copy.loading}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

export interface RegisterDrawerProps {
  busy: boolean;
  copy: HardwareConsoleCopy;
  form: { chipFamily: string; clientId: string; deviceId: string; displayName: string; productId: string };
  formError: string | null;
  onChange: (patch: Partial<RegisterDrawerProps['form']>) => void;
  onClose: () => void;
  onSubmit: () => void;
  open: boolean;
  products: readonly ConsoleHardwareProduct[];
  /** True while the product catalog is being fetched for the select. */
  productsLoading?: boolean;
}

const REGISTER_FIELDS = [
  { key: 'deviceId', maxLength: 128, required: true },
  { key: 'displayName', maxLength: 120, required: true },
  { key: 'clientId', maxLength: 128, required: false },
  { key: 'chipFamily', maxLength: 64, required: false },
] as const;

/** Element ids the drawer wires to its accessible description and error slot. */
const REGISTER_DESCRIPTION_ID = 'sdkwork-hardware-register-description';

/**
 * Device registration drawer.
 *
 * Extracted from the page so the device registry page can own the form state while
 * the firmware page never mounts registration UI at all.
 */
export function RegisterDrawer({
  busy,
  copy,
  form,
  formError,
  onChange,
  onClose,
  onSubmit,
  open,
  products,
  productsLoading = false,
}: RegisterDrawerProps) {
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  // Move focus into the drawer when it opens and give it back to the trigger
  // when it closes, so keyboard and screen-reader users are not stranded.
  useEffect(() => {
    if (!open) {
      return;
    }
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstFieldRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const noProduct = products.length === 0;
  const submitDisabled = busy || noProduct;
  const productSelectDisabled = busy || productsLoading || noProduct;

  const fieldMeta = {
    chipFamily: { hint: undefined, label: copy.chipLabel },
    clientId: { hint: undefined, label: copy.clientIdLabel },
    deviceId: { hint: copy.deviceIdHint, label: copy.deviceIdLabel },
    displayName: { hint: undefined, label: copy.displayNameLabel },
  } as const;

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]',
      ),
    );
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-zinc-950/40 dark:bg-black/60 backdrop-blur-sm"
      onClick={busy ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={copy.registerTitle}
        aria-describedby={REGISTER_DESCRIPTION_ID}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
        className="flex h-full w-full max-w-lg flex-col border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800/70 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{copy.registerTitle}</h2>
            <p id={REGISTER_DESCRIPTION_ID} className="mt-0.5 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {copy.registerDescription}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md px-2 py-1 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {copy.close}
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          {REGISTER_FIELDS.map((field, index) => (
            <label key={field.key} className="flex flex-col gap-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              <span>
                {fieldMeta[field.key].label}
                {field.required ? <span className="ml-1 text-rose-500">*</span> : null}
              </span>
              <input
                ref={index === 0 ? firstFieldRef : undefined}
                value={form[field.key]}
                disabled={busy}
                maxLength={field.maxLength}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => onChange({ [field.key]: event.target.value })}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-normal text-zinc-800 dark:text-zinc-200 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
              />
              {fieldMeta[field.key].hint ? (
                <span className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                  {fieldMeta[field.key].hint}
                </span>
              ) : null}
            </label>
          ))}
          <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            <span>
              {copy.productLabel}
              <span className="ml-1 text-rose-500">*</span>
            </span>
            <select
              value={form.productId}
              disabled={productSelectDisabled}
              onChange={(event) => onChange({ productId: event.target.value })}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-normal text-zinc-800 dark:text-zinc-200 outline-none focus:border-zinc-400 dark:focus:border-zinc-600 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <option value="">{productsLoading ? copy.productsLoading : copy.selectPlaceholder}</option>
              {products.map((product) => (
                <option key={product.productId} value={product.productId}>
                  {product.displayName} · {product.productId}
                </option>
              ))}
            </select>
            <span className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400">{copy.productHint}</span>
          </label>
          {noProduct && !productsLoading ? (
            <p className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {copy.noProducts}
            </p>
          ) : null}
          {formError ? (
            <p role="alert" aria-live="assertive" className="text-xs font-medium text-rose-600 dark:text-rose-400">
              {formError}
            </p>
          ) : null}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-zinc-100 dark:border-zinc-800/70 px-5 py-3">
          <SecondaryButton onClick={onClose} disabled={busy}>
            {copy.cancel}
          </SecondaryButton>
          <PrimaryButton onClick={onSubmit} disabled={submitDisabled}>
            {busy ? copy.saving : copy.confirm}
          </PrimaryButton>
        </footer>
      </div>
    </div>
  );
}
