import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Clock, Film, Plus, Sparkles, Star } from 'lucide-react';
import { PageHeader, SectionHeading } from '../components/layout/app-shell';
import { Button } from '../components/ui/button';
import { EmptyState, Num, Skeleton, StatTile } from '../components/ui/bits';
import { PosterCard } from '../components/media/poster-card';
import { useAuth } from '../hooks/use-auth';
import { useLibrary, useStats } from '../hooks/use-library';
import { useOnline } from '../hooks/use-online';
import { api } from '../lib/api';
import { formatJalaliLong } from '../shared/jalali';
import type { MediaItem } from '../shared/types';

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const online = useOnline();
  const [showAllRecent, setShowAllRecent] = useState(false);

  const stats = useStats('all');
  const recentlyAdded = useLibrary({ sort: 'recent', limit: 24 });
  const watching = useLibrary({ status: 'watching', sort: 'recent', limit: 20 });
  const topRated = useLibrary({ sort: 'rating', limit: 12 });
  const planCount = useQuery({
    queryKey: ['library', 'count', 'plan'],
    queryFn: () => api.get<{ total: number }>('/api/library?status=plan&limit=1'),
    staleTime: 60_000,
  });

  const recent = useMemo(() => recentlyAdded.data?.items ?? [], [recentlyAdded.data]);
  const watchingItems = useMemo(() => watching.data?.items ?? [], [watching.data]);
  const rated = useMemo(() => (topRated.data?.items ?? []).filter((i) => i.ratingFinal !== null), [topRated.data]);

  const greeting = greetingForHour();
  const firstName = user?.username ?? '';

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span>{greeting}{firstName ? `، ${firstName}` : ''}</span>
          </span>
        }
        subtitle={formatJalaliLong(new Date().toISOString().slice(0, 10), true)}
        actions={
          <>
            <Button variant="secondary" icon={<Plus size={15} />} onClick={() => navigate('/search')}>افزودن اثر</Button>
            <Button variant="primary" icon={<Sparkles size={15} />} onClick={() => navigate('/search')}>جستجو در TMDB</Button>
          </>
        }
      />

      {!online && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent/[0.07] px-4 py-3 text-[12.5px] text-ink-soft">
          <span>شما آفلاین هستید. محتوای بارگذاری‌شده در دسترس است و تغییرات بعد از اتصال ارسال می‌شوند.</span>
          <Link to="/settings?tab=sync" className="shrink-0 text-accent hover:underline">وضعیت همگام‌سازی</Link>
        </div>
      )}

      {/* Stat tiles */}
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="عنوان‌های من" value={<Num>{stats.data?.overview.totalItems ?? 0}</Num>} accent />
        <StatTile label="در حال تماشا" value={<Num>{watching.data?.total ?? 0}</Num>} hint={planCount.data ? <><Num>{planCount.data.total}</Num> در فهرست تماشا</> : undefined} />
        <StatTile label="میانگین امتیاز" value={stats.data?.overview.averageRating == null ? '—' : <Num>{stats.data.overview.averageRating.toFixed(1)}</Num>} />
        <StatTile
          label="زمان تماشا"
          value={<WatchTime minutes={stats.data?.overview.totalWatchTimeMinutes ?? 0} />}
          hint="فقط مدت‌های مشخص"
        />
      </div>

      {recent.length === 0 && recentlyAdded.isSuccess ? (
        <EmptyState
          icon={<Film size={24} />}
          title="کتابخانه‌ی شما هنوز خالی است"
          message="با جستجو در میلیون‌ها فیلم و سریال شروع کنید، یا اثری را دستی اضافه کنید. همه‌چیز امتیاز، یادداشت و تاریخچه دارد."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" size="lg" icon={<Sparkles size={16} />} onClick={() => navigate('/search')}>جستجو و افزودن</Button>
              <Button variant="secondary" size="lg" icon={<Plus size={16} />} onClick={() => navigate('/search?manual=1')}>افزودن دستی</Button>
            </div>
          }
        />
      ) : (
        <div className="space-y-8">
          {watchingItems.length > 0 && (
            <section>
              <SectionHeading title="ادامه‌ی تماشا" icon={<PlayIcon />} action={<Link to="/series?status=watching" className="text-[12px] text-accent hover:underline">همه</Link>} />
              <Rail items={watchingItems} />
            </section>
          )}

          <section>
            <SectionHeading title="تازه‌ترین‌ها" icon={<Clock size={16} />} action={<Link to="/movies" className="text-[12px] text-accent hover:underline">کتابخانه</Link>} />
            <div className={showAllRecent ? 'poster-grid' : 'poster-grid'}>
              {(showAllRecent ? recent : recent.slice(0, 12)).map((item) => (
                <PosterCard key={item.id} to={`/item/${item.id}`} title={item.title} originalTitle={item.originalTitle} posterPath={item.posterPath} customPosterData={item.customPosterData} year={item.year} rating={item.ratingFinal} status={item.status} />
              ))}
              {recentlyAdded.isLoading && <GridSkeletonInline />}
            </div>
            {recent.length > 12 && !showAllRecent && (
              <div className="mt-4 flex justify-center">
                <Button variant="secondary" onClick={() => setShowAllRecent(true)}>نمایش همه‌ی تازه‌ها</Button>
              </div>
            )}
          </section>

          {rated.length > 0 && (
            <section>
              <SectionHeading title="برترین‌های من" icon={<Star size={16} />} action={<Link to="/stats" className="text-[12px] text-accent hover:underline">آمار کامل</Link>} />
              <Rail items={rated} />
            </section>
          )}
        </div>
      )}
    </>
  );
}

function PlayIcon() {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/15">
      <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" className="text-accent"><path d="M2 1.5v7l6-3.5-6-3.5z" /></svg>
    </span>
  );
}

function WatchTime({ minutes }: { minutes: number }) {
  if (!minutes) return <>—</>;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return (
    <span className="text-[16px] sm:text-[18px]">
      <Num>{h}</Num> ساعت{m ? <> و <Num>{m}</Num> دقیقه</> : null}
    </span>
  );
}

function Rail({ items }: { items: MediaItem[] }) {
  return (
    <div className="rail -mx-4 sm:-mx-6 lg:-mx-8">
      {items.map((item) => (
        <div key={item.id} className="rail-item min-w-0">
          <PosterCard to={`/item/${item.id}`} title={item.title} originalTitle={item.originalTitle} posterPath={item.posterPath} customPosterData={item.customPosterData} year={item.year} rating={item.ratingFinal} status={item.status} size="sm" />
        </div>
      ))}
    </div>
  );
}

function GridSkeletonInline() {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="aspect-[2/3] w-full rounded-xl" />
          <Skeleton className="h-3.5 w-3/4" />
        </div>
      ))}
    </>
  );
}

function greetingForHour(): string {
  const h = new Date().getHours();
  if (h < 12) return 'صبح بخیر';
  if (h < 17) return 'ظهر بخیر';
  return 'شب بخیر';
}

