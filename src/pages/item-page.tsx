import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  Eye,
  EyeOff,
  Film,
  Globe,
  Heart,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Star,
  Trash2,
  Tv,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Field, Textarea } from '../components/ui/field';
import { Modal, ConfirmDialog } from '../components/ui/modal';
import { Dropdown, MenuItem, MenuSeparator } from '../components/ui/dropdown';
import { Badge, EmptyState, Num, OfflineState, Skeleton } from '../components/ui/bits';
import { CriteriaEditor, RatingSlider, Stars } from '../components/ui/rating';
import { PosterImage, StatusBadge } from '../components/media/poster-card';
import { JalaliDatePicker } from '../components/ui/date-picker';
import { QuotesEditor, TagInput, type QuoteDraft } from '../components/ui/tag-input';
import { useCategories, useLists, useMediaDetail } from '../hooks/use-library';
import { useToast } from '../hooks/use-toast';
import { useOnline } from '../hooks/use-online';
import { useDetailCache, useWriteOrQueue } from '../lib/write';
import { api, ApiError, errorMessage } from '../lib/api';
import { backdropUrl, itemPoster, profileUrl } from '../lib/images';
import { formatJalaliLong, formatJalaliNumeric, toPersianDigits } from '../shared/jalali';
import { formatMinutes, snapRating } from '../shared/ratings';
import { STATUS_META, WATCH_STATUSES } from '../shared/constants';
import type { Episode, MediaDetail, WatchStatus } from '../shared/types';
import type { QueuedWrite } from '../lib/write';

/* ─────────────────────────────────────────────────────────────
   Page
   ───────────────────────────────────────────────────────────── */

export function ItemPage() {
  const { id } = useParams<{ id: string }>();
  const { data: item, isLoading, isError, error, refetch } = useMediaDetail(id);
  const online = useOnline();

  if (isLoading) return <ItemSkeleton />;
  if (isError || !item) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <EmptyState
        icon={<AlertTriangle size={24} />}
        title={notFound ? 'این اثر در کتابخانه شما نیست' : 'بارگذاری انجام نشد'}
        message={notFound ? undefined : errorMessage(error)}
        action={
          notFound ? (
            <Link to="/"><Button variant="primary">بازگشت به خانه</Button></Link>
          ) : (
            <Button variant="primary" onClick={() => refetch()}>تلاش دوباره</Button>
          )
        }
      />
    );
  }
  if (!online && !item) return <OfflineState />;

  return <ItemView item={item} />;
}

function ItemSkeleton() {
  return (
    <div className="space-y-6">
      <div className="relative -mx-4 sm:-mx-6 lg:-mx-8">
        <Skeleton className="h-[300px] w-full rounded-none" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-32 w-full" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Mutations
   ───────────────────────────────────────────────────────────── */

function useItemActions(item: MediaDetail) {
  const write = useWriteOrQueue();
  const cache = useDetailCache(item.id);
  const toast = useToast();
  const queryClient = useQueryClient();

  const setStatus = (status: WatchStatus) => {
    const snap = cache.snapshot();
    cache.patch((d) => ({ ...d, status }));
    void write<{ rating: unknown }>('PATCH', `/api/library/${item.id}`, { status }, { label: 'تغییر وضعیت ذخیره شد.' }).then(
      (r) => {
        if (r.error) cache.restore(snap);
      },
    );
  };

  const toggleFavorite = () => {
    const snap = cache.snapshot();
    cache.patch((d) => ({ ...d, favorite: !d.favorite }));
    void write('PATCH', `/api/library/${item.id}`, { favorite: !item.favorite }, { silent: true }).then((r) => {
      if (r.error) cache.restore(snap);
    });
  };

  const setRating = async (method: 'direct' | 'criteria', direct: number | null, criteria: Record<string, number>) => {
    const snap = cache.snapshot();
    const final = method === 'direct' ? direct : Object.values(criteria).length ? snapRating(Object.values(criteria).reduce((a, b) => a + b, 0) / Object.values(criteria).length) : null;
    cache.patch((d) => ({ ...d, ratingMethod: method, ratingDirect: direct, criteria, ratingFinal: final }));
    const r = await write<{ rating: { final: number | null; method: string; criteria: Record<string, number> } }>(
      'POST',
      `/api/library/${item.id}/rating`,
      { method, direct, criteria },
      { label: 'امتیاز ذخیره شد.' },
    );
    if (r.error) cache.restore(snap);
    else if (r.result) {
      cache.patch((d) => ({ ...d, ratingFinal: r.result!.rating.final, ratingMethod: r.result!.rating.method as 'direct' | 'criteria', criteria: r.result!.rating.criteria }));
    }
    return r;
  };

  const clearRating = async () => {
    const snap = cache.snapshot();
    cache.patch((d) => ({ ...d, ratingMethod: 'direct', ratingDirect: null, criteria: {}, ratingFinal: null }));
    const r = await write('DELETE', `/api/library/${item.id}/rating`, undefined, { label: 'امتیاز پاک شد.' });
    if (r.error) cache.restore(snap);
  };

  const setFinalRating = async (rating: number | null) => {
    const snap = cache.snapshot();
    cache.patch((d) => ({ ...d, finalSeriesRating: rating }));
    const r = await write('POST', `/api/library/${item.id}/final-rating`, { rating }, { label: 'امتیاز نهایی ذخیره شد.' });
    if (r.error) cache.restore(snap);
  };

  const saveJournal = async (patch: {
    notes?: string | null;
    quotes?: QuoteDraft[];
    isSpoiler?: boolean;
    tags?: string[];
    watchDate?: string | null;
  }) => {
    const snap = cache.snapshot();
    cache.patch((d) => ({ ...d, ...patch, quotes: patch.quotes ?? d.quotes }));
    const r = await write<MediaDetail>('PATCH', `/api/library/${item.id}`, patch, { label: 'یادداشت ذخیره شد.' });
    if (r.error) cache.restore(snap);
    else if (r.result) queryClient.setQueryData(['library', 'detail', item.id], r.result);
    return r;
  };

  const addViewing = async (body: { watchedAt: string; rating?: { method: 'direct' | 'criteria'; direct: number | null; criteria: Record<string, number> }; notes?: string; isSpoiler?: boolean }) => {
    const r = await write<MediaDetail>('POST', `/api/library/${item.id}/watch`, body, { label: 'تماشا ثبت شد.' });
    if (r.result) queryClient.setQueryData(['library', 'detail', item.id], r.result);
    return r;
  };

  const deleteViewing = async (eventId: string) => {
    const r = await write<MediaDetail>('DELETE', `/api/library/${item.id}/watch/${eventId}`, undefined, { label: 'حذف ثبت شد.' });
    if (r.result) queryClient.setQueryData(['library', 'detail', item.id], r.result);
  };

  const episodeWatch = async (episode: Episode, body: { watchedAt: string; rating?: { method: 'direct' | 'criteria'; direct: number | null; criteria: Record<string, number> }; notes?: string }): Promise<QueuedWrite<MediaDetail>> => {
    const r = await write<MediaDetail>('POST', `/api/library/${item.id}/episodes/${episode.id}/watch`, body, { label: 'تماشای قسمت ثبت شد.' });
    if (r.result) queryClient.setQueryData(['library', 'detail', item.id], r.result);
    return r;
  };

  const patchEpisode = async (episode: Episode, patch: Partial<Pick<Episode, 'watched' | 'notes' | 'quotes' | 'isSpoiler' | 'tags' | 'watchDate'>>) => {
    const snap = cache.snapshot();
    cache.patch((d) => ({
      ...d,
      seasons: d.seasons.map((s) => ({
        ...s,
        episodes: (s.episodes ?? []).map((e) => (e.id === episode.id ? { ...e, ...patch } : e)),
      })),
    }));
    const r = await write<MediaDetail>('PATCH', `/api/library/${item.id}/episodes/${episode.id}`, patch, { label: 'قسمت ذخیره شد.' });
    if (r.error) cache.restore(snap);
    else if (r.result) queryClient.setQueryData(['library', 'detail', item.id], r.result);
  };

  const setEpisodeRating = async (episode: Episode, method: 'direct' | 'criteria', direct: number | null, criteria: Record<string, number>) => {
    const snap = cache.snapshot();
    const final = method === 'direct' ? direct : Object.values(criteria).length ? snapRating(Object.values(criteria).reduce((a, b) => a + b, 0) / Object.values(criteria).length) : null;
    cache.patch((d) => ({
      ...d,
      seasons: d.seasons.map((s) => ({
        ...s,
        episodes: (s.episodes ?? []).map((e) =>
          e.id === episode.id ? { ...e, ratingMethod: method, ratingDirect: direct, criteria, ratingFinal: final, watched: final !== null ? true : e.watched } : e,
        ),
      })),
    }));
    const r = await write('POST', `/api/library/${item.id}/episodes/${episode.id}/rating`, { method, direct, criteria }, { label: 'امتیاز قسمت ذخیره شد.' });
    if (r.error) cache.restore(snap);
  };

  const toggleCategory = async (categoryId: string, present: boolean) => {
    const r = present
      ? await write('DELETE', `/api/collections/categories/${categoryId}/items/${item.id}`, undefined, { silent: true, invalidate: [['library'], ['categories']] })
      : await write('POST', `/api/collections/categories/${categoryId}/items`, { mediaItemId: item.id }, { silent: true, invalidate: [['library'], ['categories']] });
    if (!r.error && !r.queued) {
      cache.patch((d) => ({
        ...d,
        categories: present
          ? d.categories.filter((c) => c.id !== categoryId)
          : [...d.categories, { id: categoryId, name: '', color: null }],
      }));
      await cache.invalidate();
    }
  };

  const toggleList = async (listId: string, present: boolean) => {
    const r = present
      ? await write('DELETE', `/api/collections/lists/${listId}/items/${item.id}`, undefined, { silent: true, invalidate: [['library'], ['lists'], ['list', listId]] })
      : await write('POST', `/api/collections/lists/${listId}/items`, { mediaItemId: item.id }, { silent: true, invalidate: [['library'], ['lists'], ['list', listId]] });
    if (!r.error && !r.queued) {
      cache.patch((d) => ({
        ...d,
        lists: present ? d.lists.filter((l) => l.id !== listId) : [...d.lists, { id: listId, name: '' }],
      }));
      await cache.invalidate();
    }
  };

  const refreshStructure = async () => {
    const r = await write<MediaDetail>('POST', `/api/library/${item.id}/refresh`, undefined, { label: 'در حال به‌روزرسانی…' });
    if (r.result) {
      queryClient.setQueryData(['library', 'detail', item.id], r.result);
      toast.success('ساختار فصل‌ها و قسمت‌ها به‌روزرسانی شد.');
    }
  };

  const remove = async () => {
    const r = await write('DELETE', `/api/library/${item.id}`, undefined, { label: 'حذف ذخیره شد.' });
    if (!r.error) {
      toast.success('این اثر از کتابخانه حذف شد.');
      queryClient.removeQueries({ queryKey: ['library'] });
    }
    return r;
  };

  const attachToNew = async (kind: 'category' | 'list', id: string) => {
    await (kind === 'category' ? toggleCategory(id, false) : toggleList(id, false));
  };

  return {
    setStatus, toggleFavorite, setRating, clearRating, setFinalRating, saveJournal,
    addViewing, deleteViewing, episodeWatch, patchEpisode, setEpisodeRating,
    toggleCategory, toggleList, attachToNew, refreshStructure, remove,
  };
}

/* ─────────────────────────────────────────────────────────────
   View
   ───────────────────────────────────────────────────────────── */

function ItemView({ item }: { item: MediaDetail }) {
  const actions = useItemActions(item);
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [viewingOpen, setViewingOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const backdrop = backdropUrl(item.backdropPath, 'w1280');

  const confirmDelete = async () => {
    const r = await actions.remove();
    if (!r.error) navigate('/', { replace: true });
  };

  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-line">
        {backdrop && (
          <>
            <img src={backdrop} alt="" aria-hidden className="hero-backdrop absolute inset-0 h-full w-full object-cover" />
            <div className="hero-backdrop-fade absolute inset-0" />
          </>
        )}
        <div className="relative mx-auto flex max-w-[1560px] flex-col gap-6 px-4 pb-8 pt-6 sm:px-6 lg:flex-row lg:items-end lg:gap-8 lg:px-8 lg:pb-10 lg:pt-24">
          <div className="w-[150px] shrink-0 sm:w-[180px] lg:w-[210px]">
            <div className="poster-frame aspect-[2/3] overflow-hidden rounded-xl shadow-pop">
              <PosterImage src={itemPoster(item, 'w500')} alt={item.title} eager />
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge color={item.kind === 'movie' ? '#5aa9ff' : '#b98cff'}>{item.kind === 'movie' ? 'فیلم' : 'سریال'}</Badge>
              {item.isAnime && <Badge color="#ff7d9c">انیمه</Badge>}
              <StatusBadge status={item.status} />
              {item.source === 'manual' && <Badge>افزوده‌شده به‌صورت دستی</Badge>}
            </div>
            <h1 className="text-[24px] font-bold leading-9 text-ink sm:text-[30px] lg:text-[34px] lg:leading-[1.3]">{item.title}</h1>
            {item.originalTitle && item.originalTitle !== item.title && (
              <p className="mt-1 text-right text-[12.5px] text-ink-soft ltr" dir="ltr">{item.originalTitle}</p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-soft">
              {item.year && <span className="flex items-center gap-1"><Calendar size={13} /> <Num>{item.year}</Num></span>}
              {item.runtimeMinutes && <span className="flex items-center gap-1"><Clock size={13} /> {formatMinutes(item.runtimeMinutes)}</span>}
              {item.country && <span className="flex items-center gap-1"><Globe size={13} /> {item.country}</span>}
              {item.kind === 'series' && item.seasons.length > 0 && (
                <span className="flex items-center gap-1"><Tv size={13} /> <Num>{item.seasons.length}</Num> فصل</span>
              )}
            </div>

            {item.genres.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {item.genres.map((g) => (
                  <Link key={g.name} to={`/search?genre=${encodeURIComponent(g.name)}`} className="rounded-md border border-line/80 bg-canvas/60 px-2 py-0.5 text-[11px] text-ink-soft hover:text-ink">
                    {g.name}
                  </Link>
                ))}
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <div className="segmented">
                {WATCH_STATUSES.map((s) => (
                  <button key={s} type="button" data-active={item.status === s} onClick={() => actions.setStatus(s)}>
                    {STATUS_META[s].short}
                  </button>
                ))}
              </div>
              <Button
                variant={item.favorite ? 'subtle' : 'secondary'}
                size="icon"
                onClick={actions.toggleFavorite}
                aria-label={item.favorite ? 'حذف از علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی‌ها'}
                aria-pressed={item.favorite}
                icon={<Heart size={16} fill={item.favorite ? 'currentColor' : 'none'} />}
              />
              {item.status !== 'completed' && (
                <Button variant="secondary" icon={<Check size={16} />} onClick={() => actions.setStatus('completed')}>
                  تماشا شد
                </Button>
              )}
              <Dropdown
                align="end"
                width={220}
                trigger={
                  <Button variant="secondary" size="icon" aria-label="گزینه‌های بیشتر" icon={<MoreHorizontal size={16} />} />
                }
              >
                {(close) => (
                  <>
                    <MenuItem icon={<RotateCcw size={14} />} onClick={() => { close(); setViewingOpen(true); }}>
                      ثبت تماشای دوباره
                    </MenuItem>
                    {item.source === 'tmdb' && item.kind === 'series' && (
                      <MenuItem icon={<RefreshCw size={14} />} onClick={() => { close(); void actions.refreshStructure(); }}>
                        به‌روزرسانی فصل‌ها از TMDB
                      </MenuItem>
                    )}
                    <MenuItem icon={<Pencil size={14} />} onClick={() => { close(); setEditOpen(true); }}>
                      ویرایش اطلاعات
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={<Trash2 size={14} />} danger onClick={() => { close(); setDeleteOpen(true); }}>
                      حذف از کتابخانه
                    </MenuItem>
                  </>
                )}
              </Dropdown>
            </div>
          </div>
        </div>
      </section>

      {/* Body */}
      <div className="mx-auto grid max-w-[1560px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-8 lg:py-8">
        <div className="min-w-0 space-y-8">
          <OverviewSection item={item} />
          {item.kind === 'series' && <SeasonsSection item={item} actions={actions} />}
          <JournalSection item={item} actions={actions} />
          <HistorySection item={item} actions={actions} onAdd={() => setViewingOpen(true)} />
        </div>

        <aside className="space-y-4">
          <RatingCard item={item} actions={actions} />
          <DetailsCard item={item} />
          <MembershipCard item={item} actions={actions} />
          <p className="text-[10px] leading-5 text-ink-faint">
            اطلاعات این عنوان از TMDB تأمین می‌شود. این محصول از API TMDB استفاده می‌کند اما وابسته به آن یا تأییدشده توسط آن نیست.
          </p>
        </aside>
      </div>

      <AddViewingModal open={viewingOpen} onClose={() => setViewingOpen(false)} item={item} onSubmit={async (body) => {
        const r = await actions.addViewing(body);
        return !r.error;
      }} />
      <EditItemModal open={editOpen} onClose={() => setEditOpen(false)} item={item} />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
        danger
        title="حذف از کتابخانه"
        message={
          <span>
            «{item.title}» به‌همراه یادداشت‌ها، امتیازها و تاریخچه‌ی تماشای آن از کتابخانه حذف می‌شود. این کار قابل بازگشت نیست.
            {item.source === 'tmdb' && ' در صورت تمایل می‌توانید بعداً دوباره آن را از TMDB اضافه کنید، اما داده‌های شخصی قبلی بازنمی‌گردند.'}
          </span>
        }
        confirmLabel="حذف کن"
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Sections
   ───────────────────────────────────────────────────────────── */

function OverviewSection({ item }: { item: MediaDetail }) {
  const [expanded, setExpanded] = useState(false);
  const overview = item.overview || item.overviewEn;
  if (!overview) return null;
  const long = overview.length > 420;
  const shown = expanded || !long ? overview : overview.slice(0, 420) + '…';
  return (
    <section>
      <h2 className="mb-2 text-[15px] font-semibold text-ink">خلاصه</h2>
      <p className={`text-[13.5px] leading-8 text-ink-soft ${item.overview ? '' : 'ltr text-left'}`} dir={item.overview ? 'rtl' : 'ltr'}>
        {shown}
      </p>
      {long && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-[12px] font-medium text-accent hover:underline">
          {expanded ? 'نمایش کمتر' : 'نمایش بیشتر'}
        </button>
      )}
    </section>
  );
}

function SeasonsSection({ item, actions }: { item: MediaDetail; actions: ReturnType<typeof useItemActions> }) {
  const [openSeason, setOpenSeason] = useState<number | null>(item.seasons.find((s) => s.seasonNumber === 1)?.seasonNumber ?? item.seasons[0]?.seasonNumber ?? null);
  const [episode, setEpisode] = useState<Episode | null>(null);

  if (item.seasons.length === 0) {
    return (
      <section>
        <h2 className="mb-2 text-[15px] font-semibold text-ink">فصل‌ها و قسمت‌ها</h2>
        <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-ink-faint">
          {item.source === 'tmdb'
            ? 'ساختار فصل‌ها هنوز از TMDB دریافت نشده است.'
            : 'برای این اثر، فصل و قسمتی ثبت نشده است.'}
          {item.source === 'tmdb' && (
            <div className="mt-3">
              <Button variant="secondary" size="sm" icon={<RefreshCw size={13} />} onClick={() => void actions.refreshStructure()}>
                دریافت از TMDB
              </Button>
            </div>
          )}
        </div>
      </section>
    );
  }

  const totalRated = item.ratedEpisodeCount;
  const totalEpisodes = item.totalEpisodeCount;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-ink">فصل‌ها و قسمت‌ها</h2>
        <span className="text-[11.5px] text-ink-faint">
          امتیاز داده‌شده به <Num>{totalRated}</Num> از <Num>{totalEpisodes}</Num> قسمت
          {item.computedScore !== null && (
            <> · میانگین قسمت‌ها: <span className="font-semibold text-accent">{toPersianDigits(item.computedScore.toFixed(1))}</span></>
          )}
        </span>
      </div>

      <div className="space-y-2">
        {item.seasons.map((season) => {
          const open = openSeason === season.seasonNumber;
          const watchedCount = (season.episodes ?? []).filter((e) => e.watched).length;
          return (
            <div key={season.id} className="overflow-hidden rounded-xl border border-line bg-surface">
              <button
                type="button"
                onClick={() => setOpenSeason(open ? null : season.seasonNumber)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-raised/50"
              >
                <ChevronDown size={16} className={`shrink-0 text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-ink">{season.name ?? `فصل ${toPersianDigits(season.seasonNumber)}`}</p>
                  <p className="text-[11px] text-ink-faint">
                    <Num>{season.episodes?.length ?? season.episodeCount}</Num> قسمت · <Num>{watchedCount}</Num> دیده‌شده
                    {season.ratedCount ? <> · امتیاز <Num>{season.ratedCount}</Num> قسمت</> : null}
                  </p>
                </div>
                {season.score !== null && season.score !== undefined ? (
                  <Stars value={season.score} size={11} />
                ) : (
                  <span className="text-[11px] text-ink-faint">بدون امتیاز</span>
                )}
              </button>
              {open && (
                <ul className="divide-y divide-line border-t border-line">
                  {(season.episodes ?? []).map((ep) => (
                    <li key={ep.id}>
                      <button
                        type="button"
                        onClick={() => setEpisode(ep)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors hover:bg-raised/50"
                      >
                        <span
                          className={[
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tabular',
                            ep.watched ? 'bg-success/15 text-success' : 'bg-raised text-ink-faint',
                          ].join(' ')}
                        >
                          {toPersianDigits(ep.episodeNumber)}
                        </span>
                        {ep.stillPath && (
                          <img src={`https://image.tmdb.org/t/p/w92${ep.stillPath}`} alt="" loading="lazy" className="h-9 w-16 shrink-0 rounded object-cover" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] text-ink">{ep.name || `قسمت ${toPersianDigits(ep.episodeNumber)}`}</span>
                          <span className="block text-[10.5px] text-ink-faint">
                            {ep.airDate && <>{formatJalaliNumeric(ep.airDate)} · </>}
                            {ep.runtimeMinutes && <>{formatMinutes(ep.runtimeMinutes)} · </>}
                            {ep.watched ? 'دیده‌شده' : 'دیده‌نشده'}
                          </span>
                        </span>
                        {ep.ratingFinal !== null ? <Stars value={ep.ratingFinal} size={10} /> : <span className="text-[10.5px] text-ink-faint">امتیاز نداده‌ام</span>}
                      </button>
                    </li>
                  ))}
                  {(season.episodes ?? []).length === 0 && (
                    <li className="px-4 py-5 text-center text-[12px] text-ink-faint">قسمتی برای این فصل ثبت نشده است.</li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {episode && (
        <EpisodeModal
          episode={episode}
          item={item}
          onClose={() => setEpisode(null)}
          actions={actions}
        />
      )}
    </section>
  );
}

function JournalSection({ item, actions }: { item: MediaDetail; actions: ReturnType<typeof useItemActions> }) {
  const [notes, setNotes] = useState(item.notes ?? '');
  const [quotes, setQuotes] = useState<QuoteDraft[]>(item.quotes);
  const [tags, setTags] = useState(item.tags);
  const [spoiler, setSpoiler] = useState(item.isSpoiler);
  const [watchDate, setWatchDate] = useState<string | null>(item.watchDate);
  const [saving, setSaving] = useState(false);
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    setNotes(item.notes ?? '');
    setQuotes(item.quotes);
    setTags(item.tags);
    setSpoiler(item.isSpoiler);
    setWatchDate(item.watchDate);
  }, [item.notes, item.quotes, item.tags, item.isSpoiler, item.watchDate]);

  const dirty =
    notes !== (item.notes ?? '') ||
    JSON.stringify(quotes) !== JSON.stringify(item.quotes) ||
    JSON.stringify(tags) !== JSON.stringify(item.tags) ||
    spoiler !== item.isSpoiler ||
    (watchDate ?? null) !== (item.watchDate ?? null);

  const save = async () => {
    setSaving(true);
    await actions.saveJournal({ notes: notes.trim() || null, quotes, tags, isSpoiler: spoiler, watchDate });
    setSaving(false);
  };

  const hidden = spoiler && !reveal;
  const hasContent = Boolean(item.notes || item.quotes.length || item.tags.length);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-ink">دفترچه‌ی تماشا</h2>
        {dirty && (
          <Button variant="primary" size="sm" loading={saving} onClick={save} icon={<Check size={13} />}>
            ذخیره‌ی یادداشت
          </Button>
        )}
      </div>

      {hidden && hasContent && (
        <button
          type="button"
          onClick={() => setReveal(true)}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-raised/40 px-4 py-4 text-[12.5px] text-ink-soft transition-colors hover:bg-raised"
        >
          <Eye size={15} /> این بخش حاوی اسپویل است — برای نمایش کلیک کنید
        </button>
      )}

      {hidden ? (
        // The spoiler text is deliberately NOT rendered until the reader reveals it,
        // so it cannot be copied out of the DOM or read by a screen reader.
        <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <div className="h-9 rounded-lg bg-raised/60" aria-hidden="true" />
          <div className="h-20 rounded-lg bg-raised/40" aria-hidden="true" />
          <div className="h-6 w-2/3 rounded-md bg-raised/50" aria-hidden="true" />
        </div>
      ) : (
      <div className="space-y-5 rounded-xl border border-line bg-surface p-4">
        <Field label="تاریخ تماشا">
          <JalaliDatePicker value={watchDate} onChange={setWatchDate} idPrefix="item-watch" optional />
        </Field>
        <Field label="یادداشت">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="آنچه از این اثر در ذهن شما مانده…" rows={5} />
        </Field>
        <Field label="نقل‌قول‌ها">
          <QuotesEditor value={quotes} onChange={setQuotes} />
        </Field>
        <Field label="برچسب‌ها">
          <TagInput value={tags} onChange={setTags} />
        </Field>
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={spoiler}
            onChange={(e) => setSpoiler(e.target.checked)}
            className="h-4 w-4 cursor-pointer rounded border-line-strong accent-[rgb(var(--c-accent))]"
          />
          <span className="text-[12.5px] text-ink-soft">یادداشت حاوی اسپویل است و باید پنهان بماند</span>
        </label>
      </div>
      )}
    </section>
  );
}

function HistorySection({ item, actions, onAdd }: { item: MediaDetail; actions: ReturnType<typeof useItemActions>; onAdd: () => void }) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const events = item.watchEvents.filter((e) => e.episodeId === null);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-ink">تاریخچه‌ی تماشا</h2>
        <Button variant="secondary" size="sm" icon={<Plus size={13} />} onClick={onAdd}>
          ثبت تماشا
        </Button>
      </div>

      {events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-ink-faint">
          هنوز تماشایی ثبت نشده است. هر بار تماشا را جداگانه ثبت کنید تا تاریخچه‌ی کامل با امتیاز و یادداشت هر بار حفظ شود.
        </div>
      ) : (
        <ol className="space-y-2">
          {events.map((event) => (
            <li key={event.id} className="flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3">
              <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Play size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-[12.5px] font-semibold text-ink">{formatJalaliLong(event.watchedAt)}</span>
                  {event.rating !== null && <Stars value={event.rating} size={11} />}
                </div>
                {event.isSpoiler && !revealed.has(event.id) ? (
                  <button
                    type="button"
                    onClick={() => setRevealed((prev) => new Set(prev).add(event.id))}
                    className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-dashed border-line px-2 py-1 text-[11.5px] text-ink-faint transition-colors hover:bg-raised hover:text-ink-soft"
                  >
                    <EyeOff size={12} /> یادداشت دارای اسپویل — نمایش
                  </button>
                ) : (
                  <>
                    {event.notes && <p className="mt-1 line-clamp-2 text-[12px] leading-6 text-ink-soft">{event.notes}</p>}
                    {event.quotes.length > 0 && (
                      <p className="mt-1 text-[11.5px] italic text-ink-faint">«{event.quotes[0].text}»</p>
                    )}
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => setConfirmId(event.id)}
                aria-label="حذف این ثبت"
                className="rounded-lg p-1.5 text-ink-faint opacity-60 transition-colors hover:bg-danger/10 hover:text-danger hover:opacity-100"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ol>
      )}

      <ConfirmDialog
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={() => (confirmId ? actions.deleteViewing(confirmId) : undefined)}
        danger
        title="حذف این تماشا"
        message="این ثبت از تاریخچه حذف می‌شود. امتیاز کلی اثر تغییر نمی‌کند مگر اینکه دوباره آن را ویرایش کنید."
        confirmLabel="حذف ثبت"
      />
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Sidebar cards
   ───────────────────────────────────────────────────────────── */

function RatingCard({ item, actions }: { item: MediaDetail; actions: ReturnType<typeof useItemActions> }) {
  const [method, setMethod] = useState<'direct' | 'criteria'>(item.ratingMethod);
  const [direct, setDirect] = useState<number>(item.ratingDirect ?? 0);
  const [criteria, setCriteria] = useState<Record<string, number>>(item.criteria);
  const [finalDraft, setFinalDraft] = useState<number>(item.finalSeriesRating ?? 0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMethod(item.ratingMethod);
    setDirect(item.ratingDirect ?? 0);
    setCriteria(item.criteria);
    setFinalDraft(item.finalSeriesRating ?? 0);
  }, [item.ratingMethod, item.ratingDirect, item.criteria, item.finalSeriesRating]);

  const preview = useMemo(
    () => (method === 'direct' ? direct : Object.values(criteria).length ? Object.values(criteria).reduce((a, b) => a + b, 0) / Object.values(criteria).length : null),
    [method, direct, criteria],
  );

  const save = async () => {
    setBusy(true);
    await actions.setRating(method, method === 'direct' ? direct : null, method === 'criteria' ? criteria : {});
    setBusy(false);
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="text-[13.5px] font-semibold text-ink">امتیاز من</h3>
        {item.ratingFinal !== null && (
          <button type="button" onClick={() => void actions.clearRating()} className="text-[11px] text-ink-faint hover:text-danger">
            پاک کردن
          </button>
        )}
      </div>

      <div className="mb-4 flex items-end justify-between rounded-lg bg-raised/60 px-3 py-2.5">
        <div>
          <p className="text-[10.5px] text-ink-faint">امتیاز نهایی شما</p>
          <p className="mt-0.5 text-[28px] font-semibold leading-none text-accent tabular">
            {item.ratingFinal === null ? '—' : toPersianDigits(item.ratingFinal.toFixed(1))}
          </p>
        </div>
        <Stars value={item.ratingFinal} size={13} showValue={false} />
      </div>

      <div className="segmented mb-3">
        <button type="button" data-active={method === 'direct'} onClick={() => setMethod('direct')}>امتیاز مستقیم</button>
        <button type="button" data-active={method === 'criteria'} onClick={() => setMethod('criteria')}>بر اساس معیارها</button>
      </div>

      {method === 'direct' ? (
        <RatingSlider value={direct} onChange={setDirect} />
      ) : (
        <CriteriaEditor value={criteria} onChange={setCriteria} />
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11.5px] text-ink-faint">
          {method === 'criteria' && Object.values(criteria).length > 0
            ? `میانگین ${toPersianDigits(Object.values(criteria).length)} معیار: ${toPersianDigits((preview ?? 0).toFixed(1))}`
            : method === 'criteria'
              ? 'معیارهای دلخواه را امتیاز دهید؛ بقیه در میانگین حساب نمی‌شوند.'
              : ''}
        </span>
        <Button variant="primary" size="sm" loading={busy} onClick={save} icon={<Check size={13} />}>
          ذخیره
        </Button>
      </div>

      {item.kind === 'series' && (
        <>
          <div className="my-4 h-px bg-line" />
          <h4 className="text-[12px] font-semibold text-ink">امتیاز نهایی مستقل سریال</h4>
          <p className="mt-0.5 text-[10.5px] leading-5 text-ink-faint">
            اختیاری. جدا از میانگین قسمت‌ها نمایش داده می‌شود و در آمار همین مقدار به‌عنوان امتیاز سریال حساب می‌شود.
          </p>
          <div className="mt-2">
            <RatingSlider value={finalDraft} onChange={setFinalDraft} />
          </div>
          <div className="mt-1 flex items-center justify-between">
            {item.computedScore !== null ? (
              <span className="text-[10.5px] text-ink-faint">میانگین قسمت‌ها: <span className="text-ink-soft">{toPersianDigits(item.computedScore.toFixed(1))}</span></span>
            ) : <span />}
            <Button variant="secondary" size="sm" onClick={() => void actions.setFinalRating(finalDraft === 0 ? null : finalDraft)}>
              ذخیره‌ی امتیاز نهایی
            </Button>
          </div>
          <p className="mt-2 text-[10.5px] text-ink-faint">
            به <Num>{item.ratedEpisodeCount}</Num> از <Num>{item.totalEpisodeCount}</Num> قسمت امتیاز داده‌اید.
          </p>
        </>
      )}
    </div>
  );
}

function DetailsCard({ item }: { item: MediaDetail }) {
  const rows: Array<[string, ReactNode]> = [];
  if (item.year) rows.push(['سال انتشار', <Num key="y">{item.year}</Num>]);
  if (item.runtimeMinutes) rows.push(['مدت', formatMinutes(item.runtimeMinutes)]);
  if (item.country) rows.push(['کشور', item.country]);
  if (item.language) rows.push(['زبان', item.language.toUpperCase()]);
  if (item.director) rows.push(['کارگردان', item.director]);
  if (item.watchDate) rows.push(['تاریخ تماشا', formatJalaliNumeric(item.watchDate)]);
  if (item.watchCount) rows.push(['دفعات تماشا', <Num key="w">{item.watchCount}</Num>]);

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h3 className="mb-3 text-[13.5px] font-semibold text-ink">مشخصات</h3>
      {rows.length === 0 ? (
        <p className="text-[12px] text-ink-faint">اطلاعاتی ثبت نشده است.</p>
      ) : (
        <dl className="space-y-1.5">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-3 text-[12px]">
              <dt className="text-ink-faint">{label}</dt>
              <dd className="text-end text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {item.cast.length > 0 && (
        <>
          <div className="my-3 h-px bg-line" />
          <h4 className="mb-2 text-[12px] font-semibold text-ink">بازیگران</h4>
          <ul className="space-y-2">
            {item.cast.slice(0, 8).map((person, i) => (
              <li key={`${person.id ?? person.name}-${i}`} className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-raised text-[11px] font-semibold text-ink-soft">
                  {person.profilePath ? (
                    <img src={profileUrl(person.profilePath) ?? ''} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    person.name.slice(0, 1)
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] text-ink">{person.name}</span>
                  {person.character && <span className="block truncate text-[10.5px] text-ink-faint">{person.character}</span>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function MembershipCard({ item, actions }: { item: MediaDetail; actions: ReturnType<typeof useItemActions> }) {
  const { data: categoriesData } = useCategories();
  const { data: listsData } = useLists();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [mode, setMode] = useState<'category' | 'list'>('category');
  const toast = useToast();
  const queryClient = useQueryClient();

  const categories = categoriesData?.categories ?? [];
  const lists = (listsData?.lists ?? []).filter((l) => !l.isWatchlist);

  const create = async () => {
    if (!newName.trim()) return;
    try {
      const path = mode === 'category' ? '/api/collections/categories' : '/api/collections/lists';
      const created = await api.post<{ category?: { id: string }; list?: { id: string } }>(path,
        mode === 'category' ? { name: newName.trim() } : { name: newName.trim() });
      const id = created.category?.id ?? created.list?.id;
      if (id) await actions.attachToNew(mode, id);
      await queryClient.invalidateQueries({ queryKey: [mode === 'category' ? 'categories' : 'lists'] });
      setNewName('');
      setCreateOpen(false);
      toast.success('ساخته شد.');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13.5px] font-semibold text-ink">دسته‌ها</h3>
          <button type="button" onClick={() => { setMode('category'); setCreateOpen(true); }} className="text-[11px] text-accent hover:underline">
            + دسته‌ی جدید
          </button>
        </div>
        {categories.length === 0 ? (
          <p className="text-[11.5px] text-ink-faint">هنوز دسته‌ای نساخته‌اید.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {categories.map((cat) => {
              const present = item.categories.some((c) => c.id === cat.id);
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => void actions.toggleCategory(cat.id, present)}
                  aria-pressed={present}
                  className={[
                    'rounded-md border px-2 py-1 text-[11px] transition-colors',
                    present ? 'border-accent/50 bg-accent/15 text-ink' : 'border-line bg-raised/40 text-ink-soft hover:text-ink',
                  ].join(' ')}
                >
                  {cat.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13.5px] font-semibold text-ink">فهرست‌ها</h3>
          <button type="button" onClick={() => { setMode('list'); setCreateOpen(true); }} className="text-[11px] text-accent hover:underline">
            + فهرست جدید
          </button>
        </div>
        {lists.length === 0 ? (
          <p className="text-[11.5px] text-ink-faint">هنوز فهرستی نساخته‌اید. <Link to="/lists" className="text-accent hover:underline">ساخت فهرست</Link></p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {lists.map((list) => {
              const present = item.lists.some((l) => l.id === list.id);
              return (
                <button
                  key={list.id}
                  type="button"
                  onClick={() => void actions.toggleList(list.id, present)}
                  aria-pressed={present}
                  className={[
                    'rounded-md border px-2 py-1 text-[11px] transition-colors',
                    present ? 'border-accent/50 bg-accent/15 text-ink' : 'border-line bg-raised/40 text-ink-soft hover:text-ink',
                  ].join(' ')}
                >
                  {list.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={mode === 'category' ? 'دسته‌ی جدید' : 'فهرست جدید'} size="sm">
        <Field label="نام">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void create(); }}
            className="h-11 w-full rounded-[10px] border border-line bg-canvas px-3.5 text-[14px] text-ink focus:border-line-strong focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setCreateOpen(false)}>انصراف</Button>
          <Button variant="primary" onClick={create} disabled={!newName.trim()}>ساخت و افزودن</Button>
        </div>
      </Modal>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Modals
   ───────────────────────────────────────────────────────────── */

type RatingBody = { method: 'direct' | 'criteria'; direct: number | null; criteria: Record<string, number> };

function RatingForm({ value, onChange, compact }: { value: RatingBody; onChange: (next: RatingBody) => void; compact?: boolean }) {
  return (
    <div className="space-y-3">
      <div className="segmented">
        <button type="button" data-active={value.method === 'direct'} onClick={() => onChange({ ...value, method: 'direct' })}>امتیاز مستقیم</button>
        <button type="button" data-active={value.method === 'criteria'} onClick={() => onChange({ ...value, method: 'criteria' })}>بر اساس معیارها</button>
      </div>
      {value.method === 'direct' ? (
        <RatingSlider value={value.direct ?? 0} onChange={(v) => onChange({ ...value, direct: v })} />
      ) : (
        <CriteriaEditor value={value.criteria} onChange={(c) => onChange({ ...value, criteria: c })} />
      )}
      {!compact && (
        <p className="text-[10.5px] text-ink-faint">اگر امتیاز ندهید، امتیاز فعلی اثر برای این ثبت استفاده می‌شود.</p>
      )}
    </div>
  );
}

function AddViewingModal({
  open,
  onClose,
  item,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  item: MediaDetail;
  onSubmit: (body: { watchedAt: string; rating?: RatingBody; notes?: string; isSpoiler?: boolean }) => Promise<boolean>;
}) {
  const [date, setDate] = useState<string | null>(item.watchDate);
  const [rateNow, setRateNow] = useState(false);
  const [rating, setRating] = useState<RatingBody>({ method: item.ratingMethod, direct: item.ratingDirect, criteria: item.criteria });
  const [notes, setNotes] = useState('');
  const [spoiler, setSpoiler] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(item.watchDate);
      setRateNow(false);
      setNotes('');
      setSpoiler(false);
      setRating({ method: item.ratingMethod, direct: item.ratingDirect, criteria: item.criteria });
    }
  }, [open, item.watchDate, item.ratingMethod, item.ratingDirect, item.criteria]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!date) return;
    setBusy(true);
    const ok = await onSubmit({
      watchedAt: date,
      rating: rateNow ? rating : undefined,
      notes: notes.trim() || undefined,
      isSpoiler: spoiler,
    });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="ثبت تماشا" description="هر بار تماشا را جداگانه ثبت کنید تا تاریخچه حفظ شود.">
      <form onSubmit={submit} className="space-y-4">
        <JalaliDatePicker value={date} onChange={setDate} idPrefix="viewing" label="تاریخ تماشا" />
        <label className="flex cursor-pointer items-center gap-2.5">
          <input type="checkbox" checked={rateNow} onChange={(e) => setRateNow(e.target.checked)} className="h-4 w-4 rounded border-line-strong accent-[rgb(var(--c-accent))]" />
          <span className="text-[12.5px] text-ink-soft">برای این تماشا امتیاز جدیدی ثبت کن</span>
        </label>
        {rateNow && <RatingForm value={rating} onChange={setRating} />}
        <Field label="یادداشت این تماشا" optional>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="این بار چه حسی داشت؟" />
        </Field>
        <label className="flex cursor-pointer items-center gap-2.5">
          <input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} className="h-4 w-4 rounded border-line-strong accent-[rgb(var(--c-accent))]" />
          <span className="text-[12.5px] text-ink-soft">یادداشت شامل اسپویل است</span>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>انصراف</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!date}>ثبت تماشا</Button>
        </div>
      </form>
    </Modal>
  );
}

function EpisodeModal({
  episode,
  item,
  onClose,
  actions,
}: {
  episode: Episode;
  item: MediaDetail;
  onClose: () => void;
  actions: ReturnType<typeof useItemActions>;
}) {
  const [method, setMethod] = useState<'direct' | 'criteria'>(episode.ratingMethod);
  const [direct, setDirect] = useState(episode.ratingDirect ?? 0);
  const [criteria, setCriteria] = useState(episode.criteria);
  const [watched, setWatched] = useState(episode.watched);
  const [watchDate, setWatchDate] = useState<string | null>(episode.watchDate);
  const [notes, setNotes] = useState(episode.notes ?? '');
  const [quotes, setQuotes] = useState<QuoteDraft[]>(episode.quotes);
  const [spoiler, setSpoiler] = useState(episode.isSpoiler);
  const [tags, setTags] = useState(episode.tags);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const save = async () => {
    setBusy(true);
    await actions.patchEpisode(episode, {
      watched,
      watchDate,
      notes: notes.trim() || null,
      quotes,
      isSpoiler: spoiler,
      tags,
    });
    setBusy(false);
    onClose();
  };

  const saveRating = async () => {
    setBusy(true);
    await actions.setEpisodeRating(episode, method, method === 'direct' ? direct : null, method === 'criteria' ? criteria : {});
    setBusy(false);
    toast.success('امتیاز قسمت ذخیره شد.');
    onClose();
  };

  const recordViewing = async () => {
    const watchedAt = watchDate ?? new Date().toISOString().slice(0, 10);
    setBusy(true);
    const r = await actions.episodeWatch(episode, {
      watchedAt,
      rating: method === 'direct' || Object.values(criteria).length > 0 ? { method, direct: method === 'direct' ? direct : null, criteria: method === 'criteria' ? criteria : {} } : undefined,
      notes: notes.trim() || undefined,
    });
    setBusy(false);
    if (!r.error) onClose();
  };

  return (
    <Modal open onClose={onClose} size="lg" title={`فصل ${toPersianDigits(episode.seasonNumber)} · قسمت ${toPersianDigits(episode.episodeNumber)}`} description={episode.name || item.title}>
      <div className="grid gap-6 md:grid-cols-[180px_minmax(0,1fr)]">
        <div className="space-y-3">
          {episode.stillPath && (
            <img src={`https://image.tmdb.org/t/p/w300${episode.stillPath}`} alt="" className="aspect-video w-full rounded-lg object-cover" />
          )}
          <div className="rounded-lg bg-raised/60 p-3 text-[11.5px] leading-6 text-ink-soft">
            {episode.airDate && <p>پخش: {formatJalaliNumeric(episode.airDate)}</p>}
            {episode.runtimeMinutes && <p>مدت: {formatMinutes(episode.runtimeMinutes)}</p>}
            {episode.overview && <p className="mt-2 line-clamp-6">{episode.overview}</p>}
          </div>
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" checked={watched} onChange={(e) => setWatched(e.target.checked)} className="h-4 w-4 rounded border-line-strong accent-[rgb(var(--c-accent))]" />
            <span className="text-[12.5px] text-ink-soft">این قسمت را دیده‌ام</span>
          </label>
        </div>

        <div className="space-y-4">
          <div className="segmented">
            <button type="button" data-active={method === 'direct'} onClick={() => setMethod('direct')}>امتیاز مستقیم</button>
            <button type="button" data-active={method === 'criteria'} onClick={() => setMethod('criteria')}>بر اساس معیارها</button>
          </div>
          {method === 'direct' ? <RatingSlider value={direct} onChange={setDirect} /> : <CriteriaEditor value={criteria} onChange={setCriteria} />}
          <Button variant="primary" size="sm" loading={busy} onClick={saveRating} icon={<Star size={13} />}>
            ذخیره‌ی امتیاز قسمت
          </Button>

          <div className="h-px bg-line" />

          <JalaliDatePicker value={watchDate} onChange={setWatchDate} idPrefix="episode" label="تاریخ تماشا" optional />
          <Field label="یادداشت">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </Field>
          <Field label="نقل‌قول‌ها">
            <QuotesEditor value={quotes} onChange={setQuotes} />
          </Field>
          <Field label="برچسب‌ها">
            <TagInput value={tags} onChange={setTags} />
          </Field>
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} className="h-4 w-4 rounded border-line-strong accent-[rgb(var(--c-accent))]" />
            <span className="text-[12.5px] text-ink-soft">شامل اسپویل</span>
          </label>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>بستن</Button>
            <Button variant="secondary" loading={busy} onClick={recordViewing} icon={<Play size={14} />}>
              ثبت به‌عنوان یک تماشا
            </Button>
            <Button variant="primary" loading={busy} onClick={save} icon={<Check size={14} />}>
              ذخیره
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function EditItemModal({ open, onClose, item }: { open: boolean; onClose: () => void; item: MediaDetail }) {
  const [isAnime, setIsAnime] = useState(item.isAnime);
  const [title, setTitle] = useState(item.title);
  const [originalTitle, setOriginalTitle] = useState(item.originalTitle ?? '');
  const [year, setYear] = useState(item.year?.toString() ?? '');
  const [runtime, setRuntime] = useState(item.runtimeMinutes?.toString() ?? '');
  const [genres, setGenres] = useState(item.genres.map((g) => g.name).join('، '));
  const [overview, setOverview] = useState(item.overview ?? '');
  const [poster, setPoster] = useState<string | null>(item.customPosterData);
  const [busy, setBusy] = useState(false);
  const write = useWriteOrQueue();
  const queryClient = useQueryClient();
  const toast = useToast();

  const manual = item.source === 'manual';

  const onPoster = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 350_000) {
      toast.error('حجم تصویر باید کمتر از ۳۵۰ کیلوبایت باشد.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPoster(String(reader.result));
    reader.readAsDataURL(file);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body: Record<string, unknown> = { isAnime };
    if (manual) {
      Object.assign(body, {
        title: title.trim(),
        originalTitle: originalTitle.trim() || null,
        overview: overview.trim() || null,
        year: year ? Number(year) : null,
        runtimeMinutes: runtime ? Number(runtime) : null,
        genres: genres.split(/[،,]/).map((g) => g.trim()).filter(Boolean),
        posterData: poster,
      });
    }
    const r = await write<MediaDetail>('PATCH', `/api/library/${item.id}`, body, { label: 'اطلاعات ذخیره شد.' });
    setBusy(false);
    if (r.result) {
      queryClient.setQueryData(['library', 'detail', item.id], r.result);
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="ویرایش اطلاعات" description={manual ? undefined : 'برای آثار TMDB فقط دسته‌بندی انیمه قابل ویرایش است؛ بقیه‌ی اطلاعات از TMDB می‌آید.'}>
      <form onSubmit={submit} className="space-y-4">
        {manual ? (
          <>
            <Field label="عنوان">
              <input value={title} onChange={(e) => setTitle(e.target.value)} required className="h-11 w-full rounded-[10px] border border-line bg-canvas px-3.5 text-[14px] text-ink" />
            </Field>
            <Field label="عنوان اصلی" optional>
              <input value={originalTitle} onChange={(e) => setOriginalTitle(e.target.value)} dir="auto" className="h-11 w-full rounded-[10px] border border-line bg-canvas px-3.5 text-[14px] text-ink" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="سال" optional>
                <input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" dir="ltr" className="h-11 w-full rounded-[10px] border border-line bg-canvas px-3.5 text-[14px] text-ink" />
              </Field>
              <Field label="مدت (دقیقه)" optional>
                <input value={runtime} onChange={(e) => setRuntime(e.target.value)} inputMode="numeric" dir="ltr" className="h-11 w-full rounded-[10px] border border-line bg-canvas px-3.5 text-[14px] text-ink" />
              </Field>
            </div>
            <Field label="ژانرها" hint="با ویرگول جدا کنید.">
              <input value={genres} onChange={(e) => setGenres(e.target.value)} className="h-11 w-full rounded-[10px] border border-line bg-canvas px-3.5 text-[14px] text-ink" />
            </Field>
            <Field label="توضیح" optional>
              <Textarea value={overview} onChange={(e) => setOverview(e.target.value)} rows={4} />
            </Field>
            <Field label="پوستر" hint="تصویر JPG یا PNG، حداکثر ۳۵۰ کیلوبایت.">
              <div className="flex items-center gap-3">
                {poster ? (
                  <img src={poster} alt="" className="h-20 w-14 rounded object-cover" />
                ) : (
                  <div className="flex h-20 w-14 items-center justify-center rounded bg-raised text-ink-faint"><Film size={16} /></div>
                )}
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => onPoster(e.target.files?.[0])} className="text-[12px] text-ink-soft file:me-2 file:rounded-md file:border-0 file:bg-raised file:px-2 file:py-1 file:text-[12px] file:text-ink" />
              </div>
            </Field>
          </>
        ) : null}
        <label className="flex cursor-pointer items-center gap-2.5">
          <input type="checkbox" checked={isAnime} onChange={(e) => setIsAnime(e.target.checked)} className="h-4 w-4 rounded border-line-strong accent-[rgb(var(--c-accent))]" />
          <span className="text-[12.5px] text-ink-soft">این اثر انیمه است</span>
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>انصراف</Button>
          <Button type="submit" variant="primary" loading={busy}>ذخیره</Button>
        </div>
      </form>
    </Modal>
  );
}

