import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface DropdownProps {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  width?: number;
}

/** A small accessible menu. Renders in a portal so it is never clipped by scroll containers. */
export function Dropdown({ trigger, children, align = 'start', width = 200 }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const position = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const left =
        align === 'end' ? Math.max(8, rect.right - width) : Math.min(window.innerWidth - width - 8, rect.left);
      setCoords({ top: rect.bottom + 6, left });
    };
    position();
    const onScroll = () => setOpen(false);
    const onClick = (event: MouseEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open, align, width]);

  return (
    <div ref={anchorRef} className="relative inline-block">
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="menu"
            style={{ top: coords.top, left: coords.left, width }}
            className="fixed z-[75] max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-raised p-1.5 shadow-pop animate-scale-in"
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  onClick,
  danger = false,
  disabled = false,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={[
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[12.5px] transition-colors',
        danger
          ? 'text-danger hover:bg-danger/10'
          : disabled
            ? 'text-ink-faint'
            : 'text-ink hover:bg-overlay',
        disabled ? 'cursor-not-allowed' : '',
      ].join(' ')}
    >
      {icon && <span className="shrink-0 opacity-80">{icon}</span>}
      <span className="flex-1">{children}</span>
    </button>
  );
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-2.5 pb-1 pt-2 text-[10.5px] font-medium tracking-wide text-ink-faint">{children}</p>;
}
