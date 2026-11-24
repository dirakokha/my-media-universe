import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  Check,
  ChevronDown,
  Clapperboard,
  Film,
  Plus,
  Search,
  Sparkles,
  TrendingUp,
  Tv,
  WifiOff,
  X,
} from 'lucide-react';
import { PageHeader, SectionHeading } from '../components/layout/app-shell';
import { Button } from '../components/ui/button';
import { Select } from '../components/ui/field';
import { Modal } from '../components/ui/modal';
import { Badge, EmptyState, ErrorState, Num, Skeleton } from '../components/ui/bits';
import { PosterCard, PosterImage, StatusBadge } from '../components/media/poster-card';
import { useInfiniteLibrary } from '../hooks/use-library';
import { useToast } from '../hooks/use-toast';
import { useOnline } from '../hooks/use-online';
import { useWriteOrQueue } from '../lib/write';
import { api, ApiError, errorMessage } from '../lib/api';
import { backdropUrl } from '../lib/images';
import { COLLECTION_META, STATUS_META, WATCH_STATUSES } from '../shared/constants';
import type {
  MediaCollection,
  MediaDetail,
  TmdbMovieDetail,
  TmdbSearchResult,
  TmdbSeriesDetail,
  WatchStatus,
} from '../shared/types';

type TmdbDetail = TmdbMovieDetail | TmdbSeriesDetail;
import { AddManualModal } from './manual-add';

/* ─────────────────────────────────────────────────────────────
   Library collection pages (Movies / Series / Anime)
   ───────────────────────────────────────────────────────────── */

export function CollectionPage({ kind }: { kind: MediaCollection }) {
  const meta = COLLECTION_META[kind];
  const [status, setStatus] = useState<WatchStatus | ''>('');
  const [sort, setSort] = useState<'recent' | 'rating' | 'title' | 'year'>('recent');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [favorites, setFavorites] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q.trim()), 280);
    return () => window.clearTimeout(t);
  }, [q]);

  const query = useInfiniteLibrary({ kind, status: status || undefined, sort, q: qDebounced || undefined, favorite: favorites || undefined });

  return (
    <>
      <PageHeader
        title={meta.label}
        subtitle={
          query.data ? (
            <span><Num>{query.data.pages[0]?.total ?? 0}</Num> عنوان در کتابخانه شما</span>
          ) : undefined
        }
        actions={
          <>
            <Button variant="secondary" icon={<Plus size={15} />} onClick={() => navigate(`/search?kind=${kind === 'anime' ? 'tv&anime=1' : kind === 'movie' ? 'movie' : 'tv'}`)}>
              افزودن از TMDB
            </Button>
            <Button variant="ghost" icon={<Clapperboard size={15} />} onClick={() => navigate('/search?manual=1')}>
              افزودن دستی
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جستجو در کتابخانه…"
            className="h-10 w-full rounded-[10px] border border-line bg-surface ps-9 pe-9 text-[13px] text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="پاک کردن" className="absolute end-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="segmented flex-wrap">
          <button type="button" data-active={status === ''} onClick={() => setStatus('')}>همه</button>
          {WATCH_STATUSES.map((s) => (
            <button key={s} type="button" data-active={status === s} onClick={() => setStatus(status === s ? '' : s)}>
              {STATUS_META[s].short}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant={favorites ? 'subtle' : 'secondary'} size="sm" onClick={() => setFavorites((v) => !v)} aria-pressed={favorites}>
            علاقه‌مندی‌ها
          </Button>
          <div className="w-[140px]">
            <Select aria-label="مرتب‌سازی" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="recent">تازه‌ترین</option>
              <option value="rating">بالاترین امتیاز</option>
              <option value="title">عنوان</option>
              <option value="year">سال انتشار</option>
            </Select>
          </div>
        </div>
      </div>

      <InfiniteGrid query={query} emptyState={<CollectionEmpty kind={kind} onAdd={() => navigate(`/search?kind=${kind === 'anime' ? 'tv&anime=1' : kind === 'movie' ? 'movie' : 'tv'}`)} />} />
    </>
  );
}

export function InfiniteGrid({
  query,
  emptyState,
}: {
  query: ReturnType<typeof useInfiniteLibrary>;
  emptyState: ReactNode;
}) {
  const online = useOnline();
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total ?? 0;
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchNext = query.fetchNextPage;
  const hasNext = query.hasNextPage;
  const isFetching = query.isFetchingNextPage;
  useEffect(() => {
    if (!hasNext || !sentinelRef.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetching) fetchNext();
      },
      { rootMargin: '600px' },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasNext, isFetching, fetchNext]);

  if (query.isLoading) return <GridSkeleton count={12} />;
  if (query.isError && items.length === 0) {
    return <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  }
  if (!online && items.length === 0) {
    return <EmptyState icon={<WifiOff size={24} />} title="آفلاین هستید" message="محتوای این بخش هنوز روی دستگاه ذخیره نشده است." />;
  }
  if (items.length === 0 && !query.isFetching) return emptyState;

  return (
    <>
      <div className="poster-grid">
        {items.map((item) => (
          <PosterCard
            key={item.id}
            to={`/item/${item.id}`}
            title={item.title}
            originalTitle={item.originalTitle}
            posterPath={item.posterPath}
            customPosterData={item.customPosterData}
            year={item.year}
            rating={item.ratingFinal}
            status={item.status}
          />
        ))}
      </div>
      <div ref={sentinelRef} className="h-10" />
      {isFetching && (
        <div className="flex justify-center py-4"><Skeleton className="h-9 w-32 rounded-lg" /></div>
      )}
      {items.length > 0 && items.length < total && !hasNext && (
        <p className="py-4 text-center text-[12px] text-ink-faint">
          <Num>{items.length}</Num> از <Num>{total}</Num> عنوان نمایش داده شد
        </p>
      )}
    </>
  );
}

export function GridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="poster-grid">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="aspect-[2/3] w-full rounded-xl" />
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function CollectionEmpty({ kind, onAdd }: { kind: MediaCollection; onAdd: () => void }) {
  const meta = COLLECTION_META[kind];
  const Icon = kind === 'movie' ? Film : kind === 'anime' ? Sparkles : Tv;
  return (
    <EmptyState
      icon={<Icon size={24} />}
      title={`هنوز ${meta.label}‌ای اضافه نکرده‌اید`}
      message="از میان میلیون‌ها عنوان TMDB جستجو کنید یا اثری را دستی اضافه کنید."
      action={
        <div className="flex gap-2">
          <Button variant="primary" icon={<Search size={14} />} onClick={onAdd}>جستجو و افزودن</Button>
          <Link to="/search?manual=1"><Button variant="secondary" icon={<Plus size={14} />}>افزودن دستی</Button></Link>
        </div>
      }
    />
  );
}

/* ─────────────────────────────────────────────────────────────
   Search & discover
   ───────────────────────────────────────────────────────────── */

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const initialKind = params.get('kind');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [type, setType] = useState<'all' | 'movie' | 'tv'>(
    initialKind === 'movie' ? 'movie' : initialKind === 'tv' ? 'tv' : 'all',
  );
  const [genre, setGenre] = useState(params.get('genre') ?? '');
  const [year, setYear] = useState(params.get('year') ?? '');
  const [anime, setAnime] = useState(params.get('anime') === '1');
  const [preview, setPreview] = useState<TmdbSearchResult | null>(null);
  const [manualOpen, setManualOpen] = useState(params.get('manual') === '1');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = q.trim();
  const searching = trimmed.length >= 2;

  const searchQuery = useInfiniteQuery({
    queryKey: ['tmdb', 'search', trimmed, type],
    initialPageParam: 1,
    enabled: searching,
    queryFn: ({ pageParam }) =>
      api.get<{ results: TmdbSearchResult[]; page: number; totalPages: number; totalResults: number }>(
        `/api/tmdb/search?q=${encodeURIComponent(trimmed)}&type=${type}&page=${pageParam}`,
      ),
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    staleTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

  const browseQuery = useInfiniteQuery({
    queryKey: ['tmdb', 'discover', type, genre, year, anime],
    initialPageParam: 1,
    enabled: !searching,
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams({ type: type === 'tv' ? 'tv' : 'movie', page: String(pageParam) });
      if (type === 'all') sp.set('type', 'movie');
      if (genre) sp.set('genre', genre);
      if (year) sp.set('year', year);
      if (anime) sp.set('anime', '1');
      return api.get<{ results: TmdbSearchResult[]; page: number; totalPages: number; totalResults: number }>(`/api/tmdb/discover?${sp.toString()}`);
    },
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    staleTime: 10 * 60 * 1000,
  });

  const trendingQuery = useQuery({
    queryKey: ['tmdb', 'trending', 'week'],
    queryFn: () => api.get<{ results: TmdbSearchResult[] }>('/api/tmdb/trending?type=movie&window=week'),
    staleTime: 30 * 60 * 1000,
    enabled: !searching && !genre && !year && !anime,
  });

  const genresQuery = useQuery({
    queryKey: ['tmdb', 'genres'],
    queryFn: () => api.get<{ movie: { id: number; name: string }[]; tv: { id: number; name: string }[] }>('/api/tmdb/genres'),
    staleTime: 24 * 60 * 60 * 1000,
  });

  const results = useMemo(
    () => (searching ? searchQuery.data?.pages.flatMap((p) => p.results) ?? [] : browseQuery.data?.pages.flatMap((p) => p.results) ?? []),
    [searching, searchQuery.data, browseQuery.data],
  );
  const activeQuery = searching ? searchQuery : browseQuery;
  const unconfigured = activeQuery.error instanceof ApiError && activeQuery.error.status === 503;

  const genreOptions = type === 'tv' ? genresQuery.data?.tv : genresQuery.data?.movie;

  return (
    <>
      <PageHeader
        title="جستجو و افزودن"
        subtitle="در میان فیلم‌ها و سریال‌های TMDB بگردید و با یک کلیک به کتابخانه اضافه کنید."
        actions={
          <Button variant="secondary" icon={<Plus size={15} />} onClick={() => setManualOpen(true)}>
            افزودن دستی
          </Button>
        }
      />

      <form
        onSubmit={(e) => e.preventDefault()}
        className="space-y-3 rounded-2xl border border-line bg-surface p-3 sm:p-4"
        role="search"
      >
        <div className="relative">
          <Search size={17} className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="نام فیلم یا سریال را به فارسی یا انگلیسی بنویسید…"
            className="h-12 w-full rounded-xl border border-line bg-canvas ps-11 pe-11 text-[14px] text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none focus:ring-2 focus:ring-accent/25"
            aria-label="جستجو"
          />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="پاک کردن" className="absolute end-4 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink">
              <X size={16} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="segmented">
            <button type="button" data-active={type === 'all'} onClick={() => setType('all')}>همه</button>
            <button type="button" data-active={type === 'movie'} onClick={() => setType('movie')}>فیلم</button>
            <button type="button" data-active={type === 'tv'} onClick={() => setType('tv')}>سریال</button>
          </div>
          <Button variant={anime ? 'subtle' : 'secondary'} size="sm" onClick={() => setAnime((v) => !v)} aria-pressed={anime} icon={<Sparkles size={13} />}>
            فقط انیمه
          </Button>
          <div className="w-[160px]">
            <Select aria-label="ژانر" value={genre} onChange={(e) => setGenre(e.target.value)}>
              <option value="">همه‌ی ژانرها</option>
              {(genreOptions ?? []).map((g) => (
                <option key={g.id} value={String(g.id)}>{g.name}</option>
              ))}
            </Select>
          </div>
          <input
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
            placeholder="سال"
            inputMode="numeric"
            aria-label="سال انتشار"
            className="h-10 w-24 rounded-[10px] border border-line bg-canvas px-3 text-[13px] text-ink ltr focus:border-line-strong focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
          {(genre || year || anime || q) && (
            <button type="button" onClick={() => { setGenre(''); setYear(''); setAnime(false); setQ(''); }} className="text-[12px] text-ink-faint hover:text-ink">
              پاک کردن فیلترها
            </button>
          )}
        </div>
      </form>

      <div className="mt-6">
        {unconfigured && (
          <div className="rounded-xl border border-accent/30 bg-accent/[0.07] px-4 py-4 text-[12.5px] leading-7 text-ink-soft">
            <p className="font-semibold text-ink">اتصال به TMDB هنوز تنظیم نشده است.</p>
            <p>برای جستجو و دریافت اطلاعات، مدیر باید کلید TMDB را در تنظیمات محیطی Worker قرار دهد. تا آن زمان می‌توانید آثار را به‌صورت دستی اضافه کنید.</p>
            <Button variant="primary" size="sm" className="mt-3" icon={<Plus size={13} />} onClick={() => setManualOpen(true)}>افزودن دستی</Button>
          </div>
        )}

        {!searching && !genre && !year && !anime && trendingQuery.data?.results?.length ? (
          <>
            <SectionHeading title="پرطرفدارترین‌های این هفته" icon={<TrendingUp size={16} />} />
            <Rail results={trendingQuery.data.results.slice(0, 12)} onOpen={setPreview} />
            <SectionHeading title="پیشنهادها" icon={<Sparkles size={16} />} />
          </>
        ) : null}

        {searching && trimmed.length > 0 && (
          <p className="mb-3 text-[12px] text-ink-faint">
            {searchQuery.data ? (
              <><Num>{searchQuery.data.pages[0]?.totalResults ?? 0}</Num> نتیجه برای «{trimmed}»</>
            ) : 'در حال جستجو…'}
          </p>
        )}

        {activeQuery.isLoading && results.length === 0 && <GridSkeleton count={10} />}
        {activeQuery.isError && results.length === 0 && !unconfigured && (
          <ErrorState message={errorMessage(activeQuery.error)} onRetry={() => activeQuery.refetch()} />
        )}

        {results.length > 0 && (
          <>
            <div className="poster-grid">
              {results.map((r) => (
                <TmdbResultCard key={`${r.mediaType}-${r.id}`} result={r} onOpen={setPreview} />
              ))}
            </div>
            <div className="flex justify-center py-6">
              {activeQuery.hasNextPage ? (
                <Button variant="secondary" loading={activeQuery.isFetchingNextPage} onClick={() => activeQuery.fetchNextPage()} icon={<ChevronDown size={15} />}>
                  نتایج بیشتر
                </Button>
              ) : (
                <span className="text-[12px] text-ink-faint">به انتهای فهرست رسیدید</span>
              )}
            </div>
          </>
        )}

        {!activeQuery.isLoading && results.length === 0 && searching && searchQuery.data && (
          <EmptyState icon={<Search size={24} />} title="چیزی پیدا نشد" message="املای عبارت را بررسی کنید یا به انگلیسی جستجو کنید. همچنین می‌توانید اثر را دستی اضافه کنید." action={<Button variant="primary" onClick={() => setManualOpen(true)}>افزودن دستی</Button>} />
        )}
      </div>

      {preview && <TmdbPreviewModal result={preview} onClose={() => setPreview(null)} />}
      <AddManualModal open={manualOpen} onClose={() => { setManualOpen(false); if (params.get('manual')) setParams({}, { replace: true }); }} />
    </>
  );
}

function Rail({ results, onOpen }: { results: TmdbSearchResult[]; onOpen: (r: TmdbSearchResult) => void }) {
  return (
    <div className="rail -mx-4 mb-8 sm:-mx-6 lg:-mx-8">
      {results.map((r) => (
        <button key={`${r.mediaType}-${r.id}`} type="button" onClick={() => onOpen(r)} className="rail-item group">
          <div className="poster-frame aspect-[2/3] overflow-hidden rounded-xl">
            <PosterImage src={r.posterPath ? `https://image.tmdb.org/t/p/w342${r.posterPath}` : null} alt={r.title} />
            {r.inLibrary && (
              <span className="absolute bottom-1.5 start-1.5 rounded-md bg-success/90 px-1.5 py-0.5 text-[10px] font-semibold text-[#06281a]">در کتابخانه</span>
            )}
          </div>
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-5 text-ink">{r.title}</p>
          <p className="text-[10.5px] text-ink-faint"><Num>{r.year ?? '—'}</Num> · {r.mediaType === 'movie' ? 'فیلم' : 'سریال'}{r.isAnime ? ' · انیمه' : ''}</p>
        </button>
      ))}
    </div>
  );
}

function TmdbResultCard({ result, onOpen }: { result: TmdbSearchResult; onOpen: (r: TmdbSearchResult) => void }) {
  return (
    <button type="button" onClick={() => onOpen(result)} className="poster-card group block min-w-0 text-start">
      <div className="poster-frame">
        <PosterImage src={result.posterPath ? `https://image.tmdb.org/t/p/w342${result.posterPath}` : null} alt={result.title} />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-1 p-1.5">
          <div className="flex flex-wrap gap-1">
            {result.isAnime && <Badge color="#ff7d9c">انیمه</Badge>}
            {result.libraryStatus && <StatusBadge status={result.libraryStatus} />}
          </div>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/90 backdrop-blur transition-colors group-hover:bg-accent group-hover:text-accent-ink">
            {result.inLibrary ? <Check size={14} /> : <Plus size={14} />}
          </span>
        </div>
        {result.year && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pb-1.5 pt-5">
            <span className="text-[10px] font-medium text-white/75 tabular"><Num>{result.year}</Num></span>
          </div>
        )}
      </div>
      <h3 className="mt-2 line-clamp-2 text-[12.5px] font-medium leading-5 text-ink">{result.title}</h3>
      <p className="mt-0.5 line-clamp-1 text-[10.5px] text-ink-faint ltr" dir="ltr">{result.originalTitle !== result.title ? result.originalTitle : result.mediaType === 'movie' ? 'فیلم' : 'سریال'}</p>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────
   TMDB preview + add
   ───────────────────────────────────────────────────────────── */

function TmdbPreviewModal({ result, onClose }: { result: TmdbSearchResult; onClose: () => void }) {
  const kind = result.mediaType === 'movie' ? 'movie' : 'tv';
  const detailQuery = useQuery({
    queryKey: ['tmdb', 'detail', kind, result.id],
    queryFn: async (): Promise<TmdbDetail> => (kind === 'movie' ? api.get<TmdbMovieDetail>(`/api/tmdb/movie/${result.id}`) : api.get<TmdbSeriesDetail>(`/api/tmdb/tv/${result.id}`)),
    staleTime: 30 * 60 * 1000,
  });
  const [status, setStatus] = useState<WatchStatus>('plan');
  const [isAnime, setIsAnime] = useState(result.isAnime);
  const [busy, setBusy] = useState(false);
  const write = useWriteOrQueue();
  const navigate = useNavigate();
  const toast = useToast();
  const detail = detailQuery.data;

  const add = async () => {
    setBusy(true);
    const r = await write<MediaDetail>('POST', '/api/library', { tmdb: { kind, tmdbId: result.id }, status, isAnime }, { label: 'به کتابخانه اضافه شد.' });
    setBusy(false);
    if (r.result) {
      toast.success(`«${r.result.title}» به کتابخانه اضافه شد.`);
      navigate(`/item/${r.result.id}`);
    } else if (r.queued) {
      onClose();
    }
  };

  const backdrop = detail ? backdropUrl(detail.backdropPath, 'w780') : null;

  return (
    <Modal open onClose={onClose} size="lg" title={detail?.title ?? result.title} description={detail?.originalTitle && detail.originalTitle !== detail.title ? detail.originalTitle : undefined}>
      {backdrop && (
        <div className="relative -mx-5 -mt-4 mb-4 h-44 overflow-hidden sm:-mx-5">
          <img src={backdrop} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/30 to-transparent" />
        </div>
      )}

      {detailQuery.isLoading && (
        <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-2/3" /></div>
      )}
      {detailQuery.isError && <ErrorState message={errorMessage(detailQuery.error)} onRetry={() => detailQuery.refetch()} />}

      {detail && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-soft">
            {detail.year && <span><Num>{detail.year}</Num></span>}
            {detail.runtimeMinutes && <span>· {detail.runtimeMinutes} دقیقه</span>}
            {detail.country && <span>· {detail.country}</span>}
            {kind === 'tv' && (detail as TmdbSeriesDetail).numberOfSeasons > 0 && <span>· <Num>{(detail as TmdbSeriesDetail).numberOfSeasons}</Num> فصل</span>}
          </div>
          {detail.genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {detail.genres.map((g) => <Badge key={g.name}>{g.name}</Badge>)}
            </div>
          )}
          {detail.overview && <p className="text-[13px] leading-7 text-ink-soft">{detail.overview}</p>}
          {detail.cast.length > 0 && (
            <p className="text-[12px] leading-6 text-ink-faint">
              بازیگران: {detail.cast.slice(0, 5).map((c) => c.name).join('، ')}
            </p>
          )}

          {detail.inLibrary && detail.libraryId ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-success/30 bg-success/10 px-4 py-3">
              <span className="flex items-center gap-2 text-[13px] font-medium text-ink"><Check size={16} className="text-success" /> این اثر در کتابخانه شماست</span>
              <Button variant="secondary" size="sm" onClick={() => navigate(`/item/${detail.libraryId}`)}>باز کردن</Button>
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-line bg-raised/40 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="mb-1.5 text-[11.5px] text-ink-faint">وضعیت اولیه</p>
                  <div className="segmented flex-wrap">
                    {(['plan', 'watching', 'completed'] as WatchStatus[]).map((s) => (
                      <button key={s} type="button" data-active={status === s} onClick={() => setStatus(s)}>{STATUS_META[s].short}</button>
                    ))}
                  </div>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-soft">
                  <input type="checkbox" checked={isAnime} onChange={(e) => setIsAnime(e.target.checked)} className="h-4 w-4 rounded border-line-strong accent-[rgb(var(--c-accent))]" />
                  انیمه است
                </label>
              </div>
              <Button variant="primary" className="w-full" loading={busy} onClick={add} icon={<Plus size={15} />}>
                افزودن به کتابخانه
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

