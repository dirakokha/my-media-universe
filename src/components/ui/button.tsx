import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-ink hover:brightness-110 active:brightness-95 shadow-[0_1px_0_rgb(255_255_255/0.15)_inset]',
  secondary:
    'bg-raised border border-line text-ink hover:bg-overlay hover:border-line-strong active:bg-overlay',
  ghost: 'text-ink-soft hover:text-ink hover:bg-overlay active:bg-overlay',
  danger:
    'bg-danger/10 border border-danger/30 text-danger hover:bg-danger/20 active:bg-danger/25',
  subtle: 'bg-accent/10 text-accent hover:bg-accent/20 active:bg-accent/25',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-1.5 rounded-lg px-3 text-[12px] font-medium',
  md: 'h-10 gap-2 rounded-[10px] px-4 text-[13px] font-medium',
  lg: 'h-12 gap-2.5 rounded-xl px-6 text-[14px] font-semibold',
  icon: 'h-9 w-9 justify-center rounded-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, icon, className = '', children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={[
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-all duration-150',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className,
      ].join(' ')}
      {...rest}
    >
      {loading ? <Loader2 size={size === 'sm' ? 14 : 16} className="animate-spin" /> : icon}
      {children}
    </button>
  );
});
