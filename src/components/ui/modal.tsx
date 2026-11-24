import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

function useLockBody(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}

function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, onClose]);
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
};

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: ModalProps) {
  useLockBody(open);
  useEscape(open, onClose);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="بستن"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={[
          'relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-pop animate-scale-in',
          'sm:max-h-[86vh] sm:rounded-2xl',
          SIZES[size],
        ].join(' ')}
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
              {description && <p className="mt-1 text-[12.5px] leading-6 text-ink-soft">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="بستن"
              className="shrink-0 rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-overlay hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-line bg-raised/60 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'تأیید می‌کنم',
  cancelLabel = 'انصراف',
  danger = false,
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  useLockBody(open);
  useEscape(open, onClose);

  if (!open || typeof document === 'undefined') return null;

  const handle = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="بستن"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-black/65 backdrop-blur-[2px]"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-pop animate-scale-in"
      >
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        <div className="mt-2 text-[13px] leading-7 text-ink-soft">{message}</div>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 flex-1 rounded-[10px] border border-line bg-raised px-4 text-[13px] font-medium text-ink transition-colors hover:bg-overlay"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handle}
            disabled={busy || loading}
            className={[
              'h-10 flex-1 rounded-[10px] px-4 text-[13px] font-semibold transition-colors disabled:opacity-50',
              danger ? 'bg-danger text-white hover:brightness-110' : 'bg-accent text-accent-ink hover:brightness-110',
            ].join(' ')}
          >
            {busy || loading ? 'در حال انجام…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
