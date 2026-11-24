import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Award, BarChart3, CalendarRange, Film, Star, TrendingDown, TrendingUp, Tv } from 'lucide-react';
import { PageHeader, SectionHeading } from '../components/layout/app-shell';
import { Button } from '../components/ui/button';
import { EmptyState, ErrorState, Num, Skeleton, StatTile } from '../components/ui/bits';
import { JalaliDatePicker } from '../components/ui/date-picker';
import { useStats } from '../hooks/use-library';
import { errorMessage } from '../lib/api';
import { formatJalaliMonth, toPersianDigits } from '../shared/jalali';
import { STATUS_META } from '../shared/constants';
import type { StatsPayload } from '../shared/types';

type RangeKey = 'all' | 'year' | 'month' | 'custom';

export function StatsPage() {
  const [range, setRange] = useState<RangeKey>('all');
  const [customFrom, setCustomFrom] = useState<string | null>(null);
  const [customTo, setCustomTo] = useState<string | null>(null);
  const ready = range !== 'custom' || Boolean(customFrom && customTo);
  const query = useStats(range, customFrom ?? undefined, customTo ?? undefined);

  return (
    <>
      <PageHeader
        title="آمار"
        subtitle="تصویری از عادت تماشای شما؛ فقط بر اساس داده‌هایی که واقعاً ثبت کرده‌اید."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="segmented">
              <RangeButton value="all" current={range} label="همه" onChange={setRange} />
              <RangeButton value="year" current={range} label="امسال" onChange={setRange} />
              <RangeButton value="month" current={range} label="این ماه" onChange={setRange} />
              <RangeButton value="custom" current={range} label="بازه‌ی دلخواه" onChange={setRange} />
            </div>
          </div>
        }
      />

      {range === 'custom' && (
        <div className="mb-5 grid gap-3 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2">
          <JalaliDatePicker value={customFrom} onChange={setCustomFrom} idPrefix="stats-from" label="از تاریخ" />
          <JalaliDatePicker value={customTo} onChange={setCustomTo} idPrefix="stats-to" label="تا تاریخ" />
        </div>
      )}

      {!ready ? (
        <EmptyState compact icon={<CalendarRange size={24} />} title="بازه‌ی زمانی را انتخاب کنید" />
      ) : query.isLoading ? (
        <StatsSkeleton />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : query.data ? (
        <StatsView data={query.data} />
      ) : null}
    </>
  );
}

function RangeButton({ value, current, label, onChange }: { value: RangeKey; current: RangeKey; label: string; onChange: (v: RangeKey) => void }) {
  return (
    <button type="button" data-active={current === value} onClick={() => onChange(value)}>
      {label}
    </button>
  );
}

function StatsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
      <Skeleton className="h-64" />
    </div>
  );
}

function StatsView({ data }: { data: StatsPayload }) {
  const { overview, statusBreakdown } = data;
  const hasAny = overview.totalItems > 0;

  return (
    <div className="space-y-8">
      <p className="text-[12px] text-ink-faint">بازه: <span className="text-ink-soft">{data.range.label}</span></p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="عنوان‌های کتابخانه" value={<Num>{overview.totalItems}</Num>} hint={<>فیلم <Num>{overview.moviesWatched}</Num> · سریال <Num>{overview.seriesWatched}</Num> · انیمه <Num>{overview.animeWatched}</Num></>} accent />
        <StatTile label="زمان تماشا" value={formatWatchTime(overview.totalWatchTimeMinutes)} hint="فقط بر اساس مدت‌های مشخص" />
        <StatTile label="میانگین امتیازها" value={overview.averageRating === null ? '—' : <Num>{overview.averageRating.toFixed(1)}</Num>} hint={`${toPersianDigits(overview.ratedEpisodes)} قسمت امتیازدهی‌شده`} />
        <StatTile label="سریال‌های کامل‌شده" value={<Num>{overview.completedSeries}</Num>} hint={`${toPersianDigits(overview.totalWatchEvents)} تماشا ثبت‌شده`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="وضعیت آثار" icon={<BarChart3 size={15} />}>
          {statusBreakdown.every((s) => s.count === 0) ? <Nothing /> : (
            <Bars rows={statusBreakdown.map((s) => ({ label: STATUS_META[s.status].label, count: s.count, color: STATUS_META[s.status].color }))} />
          )}
        </ChartCard>
        <ChartCard title="توزیع امتیازها" icon={<Star size={15} />}>
          {data.ratingDistribution.every((r) => r.count === 0) ? <Nothing /> : (
            <Bars rows={data.ratingDistribution.map((r) => ({ label: r.bucket, count: r.count }))} />
          )}
        </ChartCard>
      </div>

      <ChartCard title="ژانرها" icon={<Film size={15} />}>
        {data.genreDistribution.length === 0 ? <Nothing /> : <Bars rows={data.genreDistribution.slice(0, 12).map((g) => ({ label: g.name, count: g.count }))} />}
      </ChartCard>

      <ChartCard title="فعالیت ماهانه" icon={<TrendingUp size={15} />} subtitle="تعداد تماشا در هر ماه شمسی">
        {data.monthlyActivity.length === 0 ? <Nothing /> : (
          <div className="flex h-44 items-end gap-1 overflow-x-auto pb-1">
            {data.monthlyActivity.map((m) => {
              const max = Math.max(...data.monthlyActivity.map((x) => x.count), 1);
              return (
                <div key={m.key} className="group flex min-w-[28px] flex-1 flex-col items-center justify-end gap-1" title={`${formatJalaliMonth(m.key)}: ${toPersianDigits(m.count)} تماشا · ${formatWatchTime(m.minutes)}`}>
                  <span className="text-[10px] text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 tabular">{m.count ? toPersianDigits(m.count) : ''}</span>
                  <div className="w-full rounded-t bg-accent/70 transition-colors group-hover:bg-accent" style={{ height: `${Math.max(3, (m.count / max) * 130)}px` }} />
                  <span className="text-[9.5px] text-ink-faint">{formatJalaliMonth(m.key)}</span>
                </div>
              );
            })}
          </div>
        )}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <RatedList title="بالاترین امتیازها" icon={<TrendingUp size={15} />} rows={data.highestRated} kind="high" />
        <RatedList title="پایین‌ترین امتیازها" icon={<TrendingDown size={15} />} rows={data.lowestRated} kind="low" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PeopleTable title="کارگردان‌ها" rows={data.directorStats} />
        <PeopleTable title="بازیگران" rows={data.actorStats} />
      </div>

      {!hasAny && (
        <EmptyState
          icon={<BarChart3 size={24} />}
          title="آماری برای نمایش نیست"
          message="وقتی آثار را اضافه و تماشاهای خود را ثبت کنید، این صفحه پر می‌شود."
          action={<Link to="/search"><Button variant="primary">افزودن نخستین اثر</Button></Link>}
        />
      )}
    </div>
  );
}

function Nothing() {
  return <p className="py-8 text-center text-[12px] text-ink-faint">داده‌ای برای این بخش ثبت نشده است.</p>;
}

export function formatWatchTime(minutes: number | null | undefined): ReactNode {
  if (!minutes || minutes <= 0) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return <><Num>{rest}</Num> دقیقه</>;
  if (rest === 0) return <><Num>{hours}</Num> ساعت</>;
  return <><Num>{hours}</Num> ساعت و <Num>{rest}</Num> دقیقه</>;
}

function ChartCard({ title, icon, subtitle, children }: { title: string; icon: React.ReactNode; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink">{icon}{title}</h2>
        {subtitle && <span className="text-[11px] text-ink-faint">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

function Bars({ rows }: { rows: { label: string; count: number; color?: string }[] }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.label} className="grid grid-cols-[minmax(80px,140px)_minmax(0,1fr)_40px] items-center gap-3 text-[12px]">
          <span className="truncate text-ink-soft">{row.label}</span>
          <div className="h-2 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(row.count / max) * 100}%`, background: row.color ?? 'rgb(var(--c-accent))', opacity: 0.85 }} />
          </div>
          <span className="text-end text-ink-faint tabular"><Num>{row.count}</Num></span>
        </li>
      ))}
    </ul>
  );
}

function RatedList({ title, icon, rows, kind }: { title: string; icon: React.ReactNode; rows: StatsPayload['highestRated']; kind: 'high' | 'low' }) {
  if (rows.length === 0) return <ChartCard title={title} icon={icon}><Nothing /></ChartCard>;
  return (
    <ChartCard title={title} icon={icon}>
      <ol className="space-y-2">
        {rows.map((row, index) => (
          <li key={row.id}>
            <Link to={`/item/${row.id}`} className="flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-raised">
              <span className={['flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold tabular', index === 0 ? 'bg-accent text-accent-ink' : 'bg-raised text-ink-faint'].join(' ')}>{toPersianDigits(index + 1)}</span>
              {row.posterPath ? (
                <img src={`https://image.tmdb.org/t/p/w92${row.posterPath}`} alt="" loading="lazy" className="h-11 w-8 rounded object-cover" />
              ) : (
                <span className="flex h-11 w-8 items-center justify-center rounded bg-raised text-ink-faint">{row.kind === 'movie' ? <Film size={13} /> : <Tv size={13} />}</span>
              )}
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{row.title}</span>
              <span className={['text-[12.5px] font-semibold tabular', kind === 'high' ? 'text-accent' : 'text-ink-soft'].join(' ')}><Num>{row.rating.toFixed(1)}</Num></span>
            </Link>
          </li>
        ))}
      </ol>
    </ChartCard>
  );
}

function PeopleTable({ title, rows }: { title: string; rows: StatsPayload['directorStats'] }) {
  if (rows.length === 0) return <ChartCard title={title} icon={<Award size={15} />}><Nothing /></ChartCard>;
  return (
    <ChartCard title={title} icon={<Award size={15} />} subtitle="فقط آثار با اطلاعات کامل">
      <ul className="space-y-1.5">
        {rows.slice(0, 8).map((row) => (
          <li key={row.name} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-raised">
            <span className="truncate text-ink">{row.name}</span>
            <span className="flex shrink-0 items-center gap-2 text-ink-faint">
              <Num>{row.count}</Num> اثر
              {row.average !== null && <span className="text-accent tabular"><Num>{row.average.toFixed(1)}</Num></span>}
            </span>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

export { SectionHeading };
