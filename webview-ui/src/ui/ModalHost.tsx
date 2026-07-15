import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { createPortal } from 'react-dom';
import {
  emptyModalStack,
  getModalLayer,
  getTopModal,
  pushModal,
  removeModal,
  type ModalEntry,
  type ModalStack
} from './modalStackModel';

interface ModalHostContextValue {
  stack: ModalStack;
  register(entry: ModalEntry): void;
  unregister(id: string): void;
}

const ModalHostContext = createContext<ModalHostContextValue | null>(null);

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export function ModalHostProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<ModalStack>(emptyModalStack);
  const register = useCallback((entry: ModalEntry) => {
    setStack(current => pushModal(current, entry));
  }, []);
  const unregister = useCallback((id: string) => {
    setStack(current => removeModal(current, id));
  }, []);

  useEffect(() => {
    if (!stack.length) {
      return;
    }
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.dataset.modalOpen = 'true';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      delete document.documentElement.dataset.modalOpen;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [stack.length > 0]);

  const value = useMemo(() => ({ stack, register, unregister }), [stack, register, unregister]);
  return <ModalHostContext.Provider value={value}>{children}</ModalHostContext.Provider>;
}

export interface ModalSurfaceProps {
  id: string;
  labelId: string;
  onRequestClose: () => void;
  dismissible?: boolean;
  maxWidth?: string;
  className?: string;
  overlayClassName?: string;
  children: React.ReactNode;
}

export function ModalSurface({
  id,
  labelId,
  onRequestClose,
  dismissible = true,
  maxWidth = '760px',
  className = '',
  overlayClassName = '',
  children
}: ModalSurfaceProps) {
  const host = useContext(ModalHostContext);
  if (!host) {
    throw new Error('ModalSurface must be rendered inside ModalHostProvider.');
  }

  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onRequestClose);
  closeRef.current = onRequestClose;

  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    host.register({ id, dismissible });
    return () => {
      host.unregister(id);
      requestAnimationFrame(() => restoreFocusRef.current?.focus());
    };
  }, [id, host.register, host.unregister]);

  useEffect(() => {
    host.register({ id, dismissible });
  }, [dismissible, host.register, id]);

  const layer = Math.max(0, getModalLayer(host.stack, id));
  const isTop = getTopModal(host.stack)?.id === id;

  useEffect(() => {
    if (!overlayRef.current) {
      return;
    }
    overlayRef.current.inert = !isTop;
  }, [isTop]);

  useEffect(() => {
    if (!isTop || !panelRef.current) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const preferred = panelRef.current?.querySelector<HTMLElement>('[data-autofocus]');
      const first = panelRef.current?.querySelector<HTMLElement>(focusableSelector);
      (preferred ?? first ?? panelRef.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isTop]);

  useEffect(() => {
    if (!isTop) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) {
        return;
      }
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(focusableSelector))
        .filter(element => !element.hasAttribute('disabled') && element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        panelRef.current.focus();
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
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [dismissible, isTop]);

  return createPortal(
    <div
      ref={overlayRef}
      className={`modal-viewport ${overlayClassName}`}
      aria-hidden={!isTop}
      style={{ ['--modal-layer' as string]: 100 + layer * 20 }}
      onMouseDown={event => {
        if (event.target === event.currentTarget && isTop && dismissible) {
          closeRef.current();
        }
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal={isTop}
        aria-labelledby={labelId}
        tabIndex={-1}
        className={`modal-frame liquid-panel ${className}`}
        style={{ ['--modal-max-width' as string]: maxWidth }}
        onMouseDown={event => event.stopPropagation()}
      >
        {children}
      </section>
    </div>,
    document.body
  );
}
