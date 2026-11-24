import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';

/** Free-form tag input: Enter or comma commits a tag; chips can be removed. */
export function TagInput({
  value,
  onChange,
  placeholder = 'برچسب را بنویسید و Enter بزنید',
  max = 20,
  id,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  max?: number;
  id?: string;
}) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const tag = draft.trim().replace(/[,،]+$/, '').trim();
    if (!tag) return;
    if (value.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      setDraft('');
      return;
    }
    if (value.length >= max) return;
    onChange([...value, tag]);
    setDraft('');
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === '،') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="min-h-11 rounded-[10px] border border-line bg-surface px-2 py-1.5 focus-within:border-line-strong focus-within:ring-2 focus-within:ring-accent/25">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-md bg-raised px-2 py-0.5 text-[11.5px] text-ink"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((t) => t !== tag))}
              aria-label={`حذف ${tag}`}
              className="text-ink-faint hover:text-danger"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={commit}
          placeholder={value.length === 0 ? placeholder : undefined}
          className="min-w-[120px] flex-1 bg-transparent py-1 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
        />
      </div>
    </div>
  );
}

/** Quotes editor: a list of short quotes with add/remove. */
export interface QuoteDraft {
  id: string;
  text: string;
}

export function QuotesEditor({
  value,
  onChange,
  spoiler,
}: {
  value: QuoteDraft[];
  onChange: (next: QuoteDraft[]) => void;
  spoiler?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onChange([...value, { id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, text }]);
    setDraft('');
  };
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="space-y-1.5">
          {value.map((q) => (
            <li key={q.id} className="group flex items-start gap-2 rounded-lg border border-line bg-raised/40 px-3 py-2">
              <span className="flex-1 text-[12.5px] leading-6 text-ink-soft">«{q.text}»</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x.id !== q.id))}
                aria-label="حذف نقل‌قول"
                className="mt-0.5 text-ink-faint opacity-70 hover:text-danger group-hover:opacity-100"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="نقل‌قول مورد علاقه‌تان…"
          maxLength={1000}
          className="h-10 flex-1 rounded-[10px] border border-line bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="h-10 rounded-[10px] border border-line bg-raised px-3 text-[12px] font-medium text-ink disabled:opacity-40"
        >
          افزودن
        </button>
      </div>
      {spoiler && <p className="text-[10.5px] text-ink-faint">نقل‌قول‌ها با یادداشت پنهان می‌شوند.</p>}
    </div>
  );
}
