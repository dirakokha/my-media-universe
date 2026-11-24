import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Film, ImagePlus, Sparkles, Tv, X } from 'lucide-react';
import { Modal } from '../components/ui/modal';
import { Button } from '../components/ui/button';
import { Field, Select, Textarea } from '../components/ui/field';
import { useToast } from '../hooks/use-toast';
import { useWriteOrQueue } from '../lib/write';
import { errorMessage } from '../lib/api';
import { STATUS_META, WATCH_STATUSES } from '../shared/constants';
import type { MediaDetail, WatchStatus } from '../shared/types';

const MAX_POSTER_BYTES = 350_000;

/** Down-scales a picked image so a manual poster fits in the 400 KB column budget. */
async function readPosterAsDataUrl(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('خواندن تصویر ممکن نشد.'));
    reader.readAsDataURL(file);
  });
  if (dataUrl.length <= MAX_POSTER_BYTES) return dataUrl;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('این فایل تصویر معتبر نیست.'));
    el.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, Math.sqrt(MAX_POSTER_BYTES / dataUrl.length) * 0.95);
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('پردازش تصویر ممکن نشد.');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

export function AddManualModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [originalTitle, setOriginalTitle] = useState('');
  const [kind, setKind] = useState<'movie' | 'series'>('movie');
  const [isAnime, setIsAnime] = useState(false);
  const [year, setYear] = useState('');
  const [runtime, setRuntime] = useState('');
  const [genres, setGenres] = useState('');
  const [overview, setOverview] = useState('');
  const [poster, setPoster] = useState<string | null>(null);
  const [status, setStatus] = useState<WatchStatus>('plan');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const write = useWriteOrQueue();
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    if (open) {
      setError(null);
    }
  }, [open]);

  const onFile = async (file?: File) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setError('فرمت تصویر باید JPG، PNG یا WebP باشد.');
      return;
    }
    try {
      setPoster(await readPosterAsDataUrl(file));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError('عنوان را وارد کنید.');
      return;
    }
    const y = year ? Number(year) : null;
    if (y !== null && (y < 1800 || y > 2200)) {
      setError('سال انتشار باید بین ۱۸۰۰ و ۲۲۰۰ باشد.');
      return;
    }
    const rt = runtime ? Number(runtime) : null;
    if (rt !== null && (rt < 1 || rt > 1000)) {
      setError('مدت باید بین ۱ و ۱۰۰۰ دقیقه باشد.');
      return;
    }
    setBusy(true);
    const r = await write<MediaDetail>(
      'POST',
      '/api/library',
      {
        manual: {
          title: title.trim(),
          originalTitle: originalTitle.trim() || undefined,
          kind,
          isAnime,
          releaseYear: y ?? undefined,
          runtimeMinutes: rt ?? undefined,
          genres: genres.split(/[،,]/).map((g) => g.trim()).filter(Boolean).slice(0, 12),
          overview: overview.trim() || undefined,
          posterData: poster ?? undefined,
        },
        status,
      },
      { label: 'اثر دستی ذخیره شد.' },
    );
    setBusy(false);
    if (r.result) {
      toast.success('به کتابخانه اضافه شد.');
      navigate(`/item/${r.result.id}`);
    } else if (r.error) {
      setError(r.error);
    } else if (r.queued) {
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title="افزودن دستی اثر" description="برای اثری که در TMDB نیست یا اطلاعات آن ناقص است. همه‌ی فیلدها به‌جز عنوان اختیاری‌اند.">
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-[12px] text-danger">{error}</div>
        )}

        <div className="grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)]">
          <div className="mx-auto w-[130px] sm:mx-0 sm:w-full">
            <p className="mb-1.5 text-[12.5px] font-medium text-ink-soft">پوستر</p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="poster-frame group relative block aspect-[2/3] w-full overflow-hidden rounded-xl border border-dashed border-line-strong bg-raised"
            >
              {poster ? (
                <img src={poster} alt="پوستر انتخاب‌شده" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full flex-col items-center justify-center gap-1.5 text-ink-faint">
                  <ImagePlus size={22} strokeWidth={1.5} />
                  <span className="text-[11px]">انتخاب تصویر</span>
                </span>
              )}
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
            {poster && (
              <button type="button" onClick={() => setPoster(null)} className="mt-1 flex items-center gap-1 text-[11px] text-ink-faint hover:text-danger">
                <X size={11} /> حذف تصویر
              </button>
            )}
          </div>

          <div className="space-y-3">
            <Field label="عنوان">
              <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="h-11 w-full rounded-[10px] border border-line bg-canvas px-3.5 text-[14px] text-ink" />
            </Field>
            <Field label="عنوان اصلی" optional>
              <input value={originalTitle} onChange={(e) => setOriginalTitle(e.target.value)} dir="auto" maxLength={200} className="h-11 w-full rounded-[10px] border border-line bg-canvas px-3.5 text-[14px] text-ink" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="نوع">
                <div className="segmented h-11 items-center">
                  <button type="button" data-active={kind === 'movie'} onClick={() => setKind('movie')}><Film size={13} className="me-1 inline" />فیلم</button>
                  <button type="button" data-active={kind === 'series'} onClick={() => setKind('series')}><Tv size={13} className="me-1 inline" />سریال</button>
                </div>
              </Field>
              <Field label="سال انتشار" optional>
                <input value={year} onChange={(e) => setYear(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} inputMode="numeric" dir="ltr" className="h-11 w-full rounded-[10px] border border-line bg-canvas px-3.5 text-[14px] text-ink" />
              </Field>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-soft">
              <input type="checkbox" checked={isAnime} onChange={(e) => setIsAnime(e.target.checked)} className="h-4 w-4 rounded border-line-strong accent-[rgb(var(--c-accent))]" />
              <Sparkles size={13} /> این اثر انیمه است
            </label>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ژانرها" optional hint="با ویرگول جدا کنید؛ مثلاً: درام، علمی‌تخیلی">
            <input value={genres} onChange={(e) => setGenres(e.target.value)} className="h-11 w-full rounded-[10px] border border-line bg-canvas px-3.5 text-[14px] text-ink" />
          </Field>
          <Field label="مدت (دقیقه)" optional hint="برای سریال: مدت هر قسمت.">
            <input value={runtime} onChange={(e) => setRuntime(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} inputMode="numeric" dir="ltr" className="h-11 w-full rounded-[10px] border border-line bg-canvas px-3.5 text-[14px] text-ink" />
          </Field>
        </div>
        <Field label="توضیح" optional>
          <Textarea value={overview} onChange={(e) => setOverview(e.target.value)} rows={3} maxLength={5000} />
        </Field>
        <Field label="وضعیت اولیه">
          <Select value={status} onChange={(e) => setStatus(e.target.value as WatchStatus)}>
            {WATCH_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_META[s].label}</option>
            ))}
          </Select>
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>انصراف</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!title.trim()}>افزودن به کتابخانه</Button>
        </div>
      </form>
    </Modal>
  );
}
