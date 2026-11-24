import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, FolderPlus, GripVertical, ListVideo, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react';
import { PageHeader, SectionHeading } from '../components/layout/app-shell';
import { Button } from '../components/ui/button';
import { Field, Input, Select, Textarea } from '../components/ui/field';
import { Modal, ConfirmDialog } from '../components/ui/modal';
import { Dropdown, MenuItem, MenuSeparator } from '../components/ui/dropdown';
import { Badge, EmptyState, ErrorState, Num, Skeleton } from '../components/ui/bits';
import { PosterCard } from '../components/media/poster-card';
import { useList, useLists } from '../hooks/use-library';
import { useToast } from '../hooks/use-toast';
import { useWriteOrQueue } from '../lib/write';
import { api, errorMessage } from '../lib/api';
import { LIST_SORT_OPTIONS } from '../shared/constants';
import type { ListSortMode, MediaItem } from '../shared/types';

/* ─────────────────────────────────────────────────────────────
   Lists overview
   ───────────────────────────────────────────────────────────── */

export function ListsPage() {
  const { data, isLoading, isError, error, refetch } = useLists();
  const [createOpen, setCreateOpen] = useState(false);

  if (isLoading) {
    return (
      <>
        <PageHeader title="فهرست‌های من" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
        </div>
      </>
    );
  }
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />;

  const lists = data?.lists ?? [];

  return (
    <>
      <PageHeader
        title="فهرست‌های من"
        subtitle="آثار را در فهرست‌های دلخواه جمع کنید؛ هر اثر می‌تواند هم‌زمان در چند فهرست باشد."
        actions={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>فهرست جدید</Button>}
      />

      <Link to="/lists/watchlist" className="mb-5 flex items-center justify-between rounded-2xl border border-accent/25 bg-accent/[0.07] px-5 py-4 transition-colors hover:bg-accent/[0.12]">
        <div>
          <p className="text-[14px] font-semibold text-ink">فهرست تماشا</p>
          <p className="text-[12px] text-ink-faint">چیزهایی که قصد تماشای آن‌ها را دارید</p>
        </div>
        <Badge color="#8b93a7">خودکار</Badge>
      </Link>

      {lists.length === 0 ? (
        <EmptyState
          icon={<FolderPlus size={24} />}
          title="هنوز فهرستی نساخته‌اید"
          message="مثلاً «فیلم‌های آخر هفته»، «سریال‌هایی که باید ادامه دهم» یا «هدیه‌ی دوست‌دار سینما». فهرست تماشا همیشه در دسترس است."
          action={<Button variant="primary" onClick={() => setCreateOpen(true)}>ساخت فهرست</Button>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((list) => (
            <Link key={list.id} to={`/lists/${list.id}`} className="group rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-line-strong hover:bg-raised/60">
              <div className="mb-6 flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-raised text-ink-soft"><ListVideo size={18} /></span>
                <Badge><Num>{list.itemCount}</Num> عنوان</Badge>
              </div>
              <h3 className="text-[15px] font-semibold text-ink">{list.name}</h3>
              <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-[12px] leading-5 text-ink-faint">{list.description ?? 'بدون توضیح'}</p>
            </Link>
          ))}
        </div>
      )}

      <ListFormModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
   List detail
   ───────────────────────────────────────────────────────────── */

export function ListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const write = useWriteOrQueue();
  const { data, isLoading, isError, error, refetch } = useList(id);
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [reorder, setReorder] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);

  const list = data?.list;
  const items = useMemo(() => data?.items ?? [], [data]);
  const isWatchlist = Boolean(list?.isWatchlist);

  useEffect(() => {
    if (!reorder) setOrder(items.map((i) => i.id));
  }, [items, reorder]);

  const move = (index: number, dir: -1 | 1) => {
    setOrder((current) => {
      const next = current.slice();
      const target = index + dir;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const saveOrder = async () => {
    if (!list) return;
    const r = await write('POST', `/api/collections/lists/${list.id}/reorder`, { orderedIds: order }, { label: 'چیدمان ذخیره شد.' });
    if (!r.error) {
      setReorder(false);
      if (list.sortMode !== 'manual') {
        await api.patch(`/api/collections/lists/${list.id}`, { sortMode: 'manual' });
        await queryClient.invalidateQueries({ queryKey: ['list', id] });
        await queryClient.invalidateQueries({ queryKey: ['lists'] });
      }
    }
  };

  const removeItem = async (itemId: string) => {
    if (!list) return;
    const r = await write('DELETE', `/api/collections/lists/${list.id}/items/${itemId}`, undefined, { label: 'از فهرست حذف شد.', invalidate: [['list', id], ['lists'], ['library']] });
    if (!r.error) setRemoving(null);
  };

  const deleteList = async () => {
    if (!list) return;
    const r = await write('DELETE', `/api/collections/lists/${list.id}`, undefined, { label: 'فهرست حذف شد.' });
    if (!r.error) {
      toast.success('فهرست حذف شد. آثار داخل آن در کتابخانه باقی می‌مانند.');
      await queryClient.invalidateQueries({ queryKey: ['lists'] });
      navigate('/lists', { replace: true });
    }
  };

  const setSortMode = async (mode: ListSortMode) => {
    if (!list) return;
    const r = await write('PATCH', `/api/collections/lists/${list.id}`, { sortMode: mode }, { silent: true, invalidate: [['list', id], ['lists']] });
    if (!r.error && mode !== 'manual') setReorder(false);
  };

  if (isLoading) {
    return (
      <>
        <PageHeader title="فهرست" back="/lists" />
        <div className="poster-grid"><Skeleton className="aspect-[2/3]" /><Skeleton className="aspect-[2/3]" /><Skeleton className="aspect-[2/3]" /></div>
      </>
    );
  }
  if (isError || !list) return <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />;

  const displayItems = reorder
    ? order.map((itemId) => items.find((i) => i.id === itemId)).filter((x): x is MediaItem => Boolean(x))
    : items;

  return (
    <>
      <PageHeader
        back="/lists"
        title={list.name}
        subtitle={list.description ?? undefined}
        actions={
          <>
            <Button variant="secondary" icon={<Plus size={15} />} onClick={() => setAddOpen(true)}>افزودن اثر</Button>
            {!isWatchlist && (
              <Dropdown
                align="end"
                width={200}
                trigger={<Button variant="secondary" size="icon" aria-label="گزینه‌ها" icon={<MoreHorizontal size={16} />} />}
              >
                {(close) => (
                  <>
                    <MenuItem icon={<Pencil size={14} />} onClick={() => { close(); setEditOpen(true); }}>ویرایش فهرست</MenuItem>
                    <MenuItem icon={<GripVertical size={14} />} onClick={() => { close(); setOrder(items.map((i) => i.id)); setReorder(true); }}>تغییر چیدمان</MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={<Trash2 size={14} />} danger onClick={() => { close(); setRemoveOpen(true); }}>حذف فهرست</MenuItem>
                  </>
                )}
              </Dropdown>
            )}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Badge><Num>{items.length}</Num> عنوان</Badge>
        {isWatchlist && <Badge color="#8b93a7">فهرست خودکار — چیزهایی که قصد تماشا دارید</Badge>}
        <div className="ms-auto flex items-center gap-2">
          {reorder ? (
            <>
              <span className="text-[12px] text-ink-faint">با فلش‌ها جابه‌جا کنید</span>
              <Button variant="ghost" size="sm" onClick={() => setReorder(false)}>انصراف</Button>
              <Button variant="primary" size="sm" onClick={saveOrder}>ذخیره‌ی چیدمان</Button>
            </>
          ) : (
            <>
              <label className="text-[11.5px] text-ink-faint" htmlFor="list-sort">مرتب‌سازی</label>
              <div className="w-[150px]">
                <Select id="list-sort" value={list.sortMode} onChange={(e) => void setSortMode(e.target.value as ListSortMode)}>
                  {LIST_SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </div>
              {!isWatchlist && list.sortMode === 'manual' && (
                <Button variant="secondary" size="sm" icon={<GripVertical size={13} />} onClick={() => { setOrder(items.map((i) => i.id)); setReorder(true); }}>
                  چیدمان
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<FolderPlus size={24} />}
          title="این فهرست خالی است"
          message={isWatchlist ? 'هر اثری که وضعیت آن «قصد تماشا» باشد، خودکار اینجا نمایش داده می‌شود.' : 'از کتابخانه آثار را به این فهرست اضافه کنید.'}
          action={!isWatchlist ? <Button variant="primary" onClick={() => setAddOpen(true)}>افزودن اثر</Button> : undefined}
        />
      ) : (
        <div className="poster-grid">
          {displayItems.map((item, index) => (
            <div key={item.id} className="relative">
              <PosterCard
                to={reorder ? undefined : `/item/${item.id}`}
                title={item.title}
                originalTitle={item.originalTitle}
                posterPath={item.posterPath}
                customPosterData={item.customPosterData}
                year={item.year}
                rating={item.ratingFinal}
                status={item.status}
              />
              {reorder ? (
                <div className="absolute inset-x-0 bottom-[4.5rem] flex justify-center gap-1">
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="بالا" className="flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white disabled:opacity-30"><ArrowUp size={14} /></button>
                  <button type="button" onClick={() => move(index, 1)} disabled={index === displayItems.length - 1} aria-label="پایین" className="flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white disabled:opacity-30"><ArrowDown size={14} /></button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setRemoving(item.id)}
                  aria-label={`حذف ${item.title} از فهرست`}
                  className="absolute end-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white/80 opacity-0 backdrop-blur transition-opacity hover:text-white group-hover:opacity-100 [.poster-card:hover_&]:opacity-100"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <ListFormModal open={editOpen} onClose={() => setEditOpen(false)} list={list} />
      <AddToListModal open={addOpen} onClose={() => setAddOpen(false)} listId={list.id} />
      <ConfirmDialog
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        onConfirm={deleteList}
        danger
        title="حذف فهرست"
        message="فهرست حذف می‌شود اما آثار داخل آن از کتابخانه‌ی شما پاک نمی‌شوند و در فهرست‌های دیگر باقی می‌مانند."
        confirmLabel="حذف فهرست"
      />
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => (removing ? removeItem(removing) : undefined)}
        title="حذف از این فهرست"
        message="این اثر از فهرست خارج می‌شود ولی در کتابخانه باقی می‌ماند."
        confirmLabel="حذف از فهرست"
      />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
   Modals
   ───────────────────────────────────────────────────────────── */

function ListFormModal({ open, onClose, list }: { open: boolean; onClose: () => void; list?: { id: string; name: string; description: string | null; sortMode: ListSortMode } }) {
  const [name, setName] = useState(list?.name ?? '');
  const [description, setDescription] = useState(list?.description ?? '');
  const [sortMode, setSortMode] = useState<ListSortMode>(list?.sortMode ?? 'manual');
  const [busy, setBusy] = useState(false);
  const write = useWriteOrQueue();
  const toast = useToast();

  useEffect(() => {
    if (open) {
      setName(list?.name ?? '');
      setDescription(list?.description ?? '');
      setSortMode(list?.sortMode ?? 'manual');
    }
  }, [open, list]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const body = { name: name.trim(), description: description.trim() || null, sortMode };
    const r = list
      ? await write('PATCH', `/api/collections/lists/${list.id}`, body, { label: 'فهرست ذخیره شد.', invalidate: [['lists'], ['list', list.id]] })
      : await write<{ list: { id: string } }>('POST', '/api/collections/lists', body, { label: 'فهرست ساخته شد.', invalidate: [['lists']] });
    setBusy(false);
    if (!r.error) {
      toast.success(list ? 'فهرست ذخیره شد.' : 'فهرست ساخته شد.');
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={list ? 'ویرایش فهرست' : 'فهرست جدید'} size="sm">
      <form onSubmit={submit} className="space-y-4">
        <Field label="نام فهرست">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </Field>
        <Field label="توضیح" optional>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={500} />
        </Field>
        <Field label="مرتب‌سازی پیش‌فرض">
          <Select value={sortMode} onChange={(e) => setSortMode(e.target.value as ListSortMode)}>
            {LIST_SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>انصراف</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>{list ? 'ذخیره' : 'ساخت فهرست'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function AddToListModal({ open, onClose, listId }: { open: boolean; onClose: () => void; listId: string }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const write = useWriteOrQueue();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: listData } = useList(listId);
  const present = useMemo(() => new Set((listData?.items ?? []).map((i) => i.id)), [listData]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const results = useQuery({
    queryKey: ['library', 'picker', debounced],
    queryFn: () => api.get<{ items: MediaItem[] }>(`/api/library?limit=40&sort=title${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`),
    staleTime: 30_000,
  });

  const add = async () => {
    setBusy(true);
    let ok = 0;
    for (const itemId of selected) {
      const r = await write('POST', `/api/collections/lists/${listId}/items`, { mediaItemId: itemId }, { silent: true });
      if (!r.error) ok += 1;
    }
    await queryClient.invalidateQueries({ queryKey: ['list', listId] });
    await queryClient.invalidateQueries({ queryKey: ['lists'] });
    await queryClient.invalidateQueries({ queryKey: ['library', 'detail'] });
    setBusy(false);
    toast.success(`${ok} اثر به فهرست اضافه شد.`);
    onClose();
  };

  const items = (results.data?.items ?? []).filter((i) => !present.has(i.id));

  return (
    <Modal open={open} onClose={onClose} title="افزودن اثر به فهرست" size="lg">
      <div className="space-y-3">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="جستجو در کتابخانه…"
          className="h-11 w-full rounded-[10px] border border-line bg-canvas px-3.5 text-[14px] text-ink"
        />
        {selected.size > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Array.from(selected).map((id) => {
              const item = items.find((i) => i.id === id);
              if (!item) return null;
              return (
                <button key={id} type="button" onClick={() => setSelected((s) => { const n = new Set(s); n.delete(id); return n; })} className="flex items-center gap-1 rounded-md bg-accent/15 px-2 py-1 text-[11.5px] text-ink">
                  {item.title} <X size={11} />
                </button>
              );
            })}
          </div>
        )}
        <div className="max-h-[50vh] space-y-1 overflow-y-auto rounded-xl border border-line p-2">
          {results.isLoading && <Skeleton className="h-10 w-full" />}
          {items.length === 0 && !results.isLoading && <p className="py-6 text-center text-[12px] text-ink-faint">اثر دیگری پیدا نشد.</p>}
          {items.map((item) => {
            const checked = selected.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelected((s) => { const n = new Set(s); if (checked) n.delete(item.id); else n.add(item.id); return n; })}
                aria-pressed={checked}
                className={['flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start transition-colors hover:bg-raised', checked ? 'bg-accent/10' : ''].join(' ')}
              >
                <span className={['flex h-5 w-5 shrink-0 items-center justify-center rounded border', checked ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong'].join(' ')}>
                  {checked && <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6.5 5 9l5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </span>
                {item.posterPath ? (
                  <img src={`https://image.tmdb.org/t/p/w92${item.posterPath}`} alt="" className="h-10 w-7 rounded object-cover" />
                ) : (
                  <span className="h-10 w-7 rounded bg-raised" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink">{item.title}</span>
                  <span className="block text-[10.5px] text-ink-faint">{item.kind === 'movie' ? 'فیلم' : 'سریال'} · <Num>{item.year ?? '—'}</Num></span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>انصراف</Button>
          <Button variant="primary" loading={busy} disabled={selected.size === 0} onClick={add} icon={<Plus size={14} />}>
            افزودن {selected.size > 0 ? <Num>{selected.size}</Num> : ''} اثر
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export { SectionHeading };
