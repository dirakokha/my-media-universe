import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

const baseField =
  'w-full rounded-[10px] border border-line bg-surface px-3.5 text-[14px] text-ink placeholder:text-ink-faint transition-colors focus:border-line-strong focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-50';

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
  optional?: boolean;
}

export function Field({ label, hint, error, children, htmlFor, optional }: FieldProps) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-soft">
          {label}
          {optional && <span className="text-[11px] font-normal text-ink-faint">(اختیاری)</span>}
        </label>
      )}
      {children}
      {error ? (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[11.5px] leading-5 text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { error?: boolean }>(
  function Input({ className = '', error, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={[baseField, 'h-11', error ? 'border-danger/60' : '', className].join(' ')}
        {...rest}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: boolean }>(
  function Textarea({ className = '', error, rows = 4, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={[baseField, 'resize-y py-2.5 leading-7', error ? 'border-danger/60' : '', className].join(' ')}
        {...rest}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { error?: boolean }>(
  function Select({ className = '', error, children, ...rest }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={[baseField, 'h-11 appearance-none pe-9', error ? 'border-danger/60' : '', className].join(' ')}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown
          size={15}
          className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-ink-faint"
        />
      </div>
    );
  },
);

export function Checkbox({
  label,
  description,
  ...rest
}: { label: string; description?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
      <input
        id={id}
        type="checkbox"
        className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-line-strong bg-surface accent-[rgb(var(--c-accent))]"
        {...rest}
      />
      <span className="space-y-0.5">
        <span className="block text-[13px] text-ink">{label}</span>
        {description && <span className="block text-[11.5px] leading-5 text-ink-faint">{description}</span>}
      </span>
    </label>
  );
}
