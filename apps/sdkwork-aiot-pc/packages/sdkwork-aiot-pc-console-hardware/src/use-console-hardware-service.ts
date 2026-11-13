import { useEffect, useState } from 'react';

import type { ConsoleHardwareService } from './hardware-service.ts';

/**
 * Resolves the service a console page talks to.
 *
 * A host (for example the Cloud Router user console) injects its own session-bound
 * service; the AIoT application shell omits it and the default AIoT app-surface
 * binding is imported lazily, so an embedding host never pulls the AIoT PC runtime
 * into its bundle.
 */
export function useConsoleHardwareService(
  service?: ConsoleHardwareService,
): ConsoleHardwareService | null {
  const [resolved, setResolved] = useState<ConsoleHardwareService | null>(service ?? null);

  useEffect(() => {
    if (service) {
      setResolved(service);
      return undefined;
    }
    let active = true;
    void import('./hardware-service-default.ts').then((module) => {
      if (active) {
        setResolved(module.getConsoleHardwareService());
      }
    });
    return () => {
      active = false;
    };
  }, [service]);

  return resolved;
}

/** Closes an overlay on Escape, matching the console dialog contract. */
export function useEscapeToClose(active: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, onClose]);
}
