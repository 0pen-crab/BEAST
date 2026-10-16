import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

const AUTO_DISMISS_MS = 6_000;

type ToastKind = 'error' | 'success' | 'warning';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Stable id — showing again with the same id updates that toast in place. */
  id?: string;
  kind?: ToastKind;
  /** Custom title; defaults to the generic i18n title for the kind. */
  title?: string;
  /** One detail line per entry when given an array. */
  message: string | string[];
  /** Persistent toasts never auto-dismiss — remove them via toast.dismiss(id). */
  persistent?: boolean;
  /** Optional action button (e.g. a retry affordance). */
  action?: ToastAction;
}

interface ToastItem {
  id: string;
  kind: ToastKind;
  title?: string;
  messages: string[];
  persistent: boolean;
  action?: ToastAction;
}

type ToastEvent =
  | { type: 'show'; item: ToastItem }
  | { type: 'dismiss'; id: string };

type Listener = (event: ToastEvent) => void;

const listeners = new Set<Listener>();
let nextId = 0;

function show(options: ToastOptions): string {
  const item: ToastItem = {
    id: options.id ?? `toast-${nextId++}`,
    kind: options.kind ?? 'error',
    title: options.title,
    messages: Array.isArray(options.message) ? options.message : [options.message],
    persistent: options.persistent ?? false,
    action: options.action,
  };
  listeners.forEach((listener) => listener({ type: 'show', item }));
  return item.id;
}

function dismiss(id: string) {
  listeners.forEach((listener) => listener({ type: 'dismiss', id }));
}

/**
 * Global toast API — safe to call from anywhere, including outside React
 * (e.g. QueryClient onError callbacks). No-op if no provider is mounted.
 */
export const toast = {
  error: (message: string) => show({ kind: 'error', message }),
  success: (message: string) => show({ kind: 'success', message }),
  warning: (message: string) => show({ kind: 'warning', message }),
  show,
  dismiss,
};

const KIND_CLASS: Record<ToastKind, string> = {
  error: 'beast-notification beast-notification-error',
  warning: 'beast-notification beast-notification-warning',
  success: 'beast-notification',
};

const KIND_TITLE_KEY: Record<ToastKind, string> = {
  error: 'toast.errorTitle',
  warning: 'toast.warningTitle',
  success: 'toast.successTitle',
};

const ToastContext = createContext<typeof toast | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;

  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const remove = (id: string) => {
      const timer = timers.get(id);
      if (timer) clearTimeout(timer);
      timers.delete(id);
      toastsRef.current = toastsRef.current.filter((v) => v.id !== id);
      setToasts(toastsRef.current);
    };

    const onEvent = (event: ToastEvent) => {
      if (event.type === 'dismiss') {
        remove(event.id);
        return;
      }
      const { item } = event;
      const visible = toastsRef.current;
      if (visible.some((v) => v.id === item.id)) {
        // Update-or-create: the same id replaces the toast in place.
        toastsRef.current = visible.map((v) => (v.id === item.id ? item : v));
      } else {
        // Dedupe: skip if an identical message is already on screen (refetch storms)
        const duplicate = visible.some(
          (v) =>
            v.kind === item.kind &&
            v.title === item.title &&
            v.messages.join('\n') === item.messages.join('\n'),
        );
        if (duplicate) return;
        toastsRef.current = [...visible, item];
      }
      setToasts(toastsRef.current);

      const timer = timers.get(item.id);
      if (timer) clearTimeout(timer);
      timers.delete(item.id);
      if (!item.persistent) {
        timers.set(item.id, setTimeout(() => remove(item.id), AUTO_DISMISS_MS));
      }
    };

    listeners.add(onEvent);
    return () => {
      listeners.delete(onEvent);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {toasts.length > 0 && (
        <div className="beast-notification-stack">
          {toasts.map((item) => (
            <div key={item.id} className={KIND_CLASS[item.kind]} role="alert">
              <div className="beast-notification-content">
                <div className="beast-notification-title">
                  {item.title ?? t(KIND_TITLE_KEY[item.kind])}
                </div>
                {item.messages.map((message, i) => (
                  <div key={i} className="beast-notification-detail">
                    {message}
                  </div>
                ))}
                {item.action && (
                  <div className="beast-notification-actions">
                    <button
                      type="button"
                      className="beast-btn beast-btn-outline beast-btn-sm"
                      onClick={item.action.onClick}
                    >
                      {item.action.label}
                    </button>
                  </div>
                )}
              </div>
              {!item.persistent && (
                <button
                  type="button"
                  className="beast-btn-icon"
                  aria-label={t('common.dismiss')}
                  onClick={() => dismiss(item.id)}
                >
                  &times;
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
