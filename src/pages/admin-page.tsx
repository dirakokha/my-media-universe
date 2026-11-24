import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Copy, Check, Plus, Trash2, Ticket } from 'lucide-react';
import { PageHeader } from '../components/layout/app-shell';
import { Button } from '../components/ui/button';
import { Field, Input, Select } from '../components/ui/field';
import { Modal, ConfirmDialog } from '../components/ui/modal';
import { StatTile } from '../components/ui/bits';
import { SectionCard } from '../components/ui/settings-bits';
import { useAuth } from '../hooks/use-auth';
import { useToast } from '../hooks/use-toast';
import { api, errorMessage } from '../lib/api';
import { formatJalaliNumeric, toPersianDigits } from '../shared/jalali';

interface Invitation {
  id: string;
  codeHint: string;
  emailHint: string | null;
  maxUses: number;
  useCount: number;
  note: string | null;
  expiresAt: number | null;
  revokedAt: number | null;
  usedAt: number | null;
  usedByUsername: string | null;
  createdAt: number;
}

export function AdminPage() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const invitationsQuery = useQuery({ queryKey: ['admin', 'invitations'], queryFn: () => api.get<{ invitations: Invitation[] }>('/api/admin/invitations') });
  const overviewQuery = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api.get<{ users: number; mediaItems: number; watchEvents: number; activeInvitations: number }>('/api/admin/overview') });

  const [createOpen, setCreateOpen] = useState(false);
  const [days, setDays] = useState('7');
  const [maxUses, setMaxUses] = useState('1');
  const [emailHint, setEmailHint] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  if (user?.role !== 'admin') {
    return (
      <div className="py-20 text-center">
        <p className="text-[14px] font-semibold text-ink">این بخش فقط برای مدیر است.</p>
      </div>
    );
  }

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ invitation: { code: string; expiresAt: number | null; maxUses: number } }>('/api/admin/invitations', {
        expiresInDays: Number(days),
        maxUses: Number(maxUses),
        emailHint: emailHint.trim() || undefined,
        note: note.trim() || undefined,
      });
      setNewCode(r.invitation.code);
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await api.post(`/api/admin/invitations/${id}/revoke`);
      toast.success('کد دعوت باطل شد.');
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const remove = async (id: string) => {
    try {
      await api.delete(`/api/admin/invitations/${id}`);
      toast.success('کد دعوت حذف شد.');
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const invitations = invitationsQuery.data?.invitations ?? [];

  return (
    <>
      <PageHeader
        title="مدیریت دعوت‌ها"
        subtitle="ثبت‌نام فقط با کد دعوت انجام می‌شود. کدها یک‌بارمصرف (یا چندبار با سقف مشخص)، دارای انقضا و قابل باطل‌کردن‌اند."
        actions={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>ساخت کد دعوت</Button>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="کاربران" value={<span className="tabular">{toPersianDigits(overviewQuery.data?.users ?? 0)}</span>} />
        <StatTile label="عنوان‌ها" value={<span className="tabular">{toPersianDigits(overviewQuery.data?.mediaItems ?? 0)}</span>} />
        <StatTile label="تماشاها" value={<span className="tabular">{toPersianDigits(overviewQuery.data?.watchEvents ?? 0)}</span>} />
        <StatTile label="کدهای فعال" value={<span className="tabular">{toPersianDigits(overviewQuery.data?.activeInvitations ?? 0)}</span>} accent />
      </div>

      <SectionCard title="کدهای دعوت" icon={<Ticket size={15} />}>
        {invitationsQuery.isLoading ? (
          <p className="text-[12px] text-ink-faint">در حال بارگذاری…</p>
        ) : invitations.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-ink-faint">هنوز کد دعوتی ساخته نشده است.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-start text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-[11px] text-ink-faint">
                  <th className="pb-2 text-start font-medium">کد</th>
                  <th className="pb-2 text-start font-medium">وضعیت</th>
                  <th className="pb-2 text-start font-medium">استفاده</th>
                  <th className="pb-2 text-start font-medium">انقضا</th>
                  <th className="pb-2 text-start font-medium">یادداشت</th>
                  <th className="pb-2 text-start font-medium">ساخته‌شده</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => {
                  const expired = inv.expiresAt !== null && inv.expiresAt < Date.now();
                  const exhausted = inv.useCount >= inv.maxUses;
                  const active = !inv.revokedAt && !expired && !exhausted;
                  return (
                    <tr key={inv.id} className="border-b border-line/60 last:border-0">
                      <td className="py-3 font-mono text-[11.5px] text-ink-soft ltr" dir="ltr">{inv.codeHint}…</td>
                      <td className="py-3">
                        {inv.revokedAt ? <span className="text-danger">باطل شده</span> : exhausted ? <span className="text-success">استفاده‌شده{inv.usedByUsername ? ` (${inv.usedByUsername})` : ''}</span> : expired ? <span className="text-accent">منقضی</span> : <span className="text-success">فعال</span>}
                      </td>
                      <td className="py-3 text-ink-soft tabular">{toPersianDigits(inv.useCount)} از {toPersianDigits(inv.maxUses)}</td>
                      <td className="py-3 text-ink-soft">{inv.expiresAt ? formatJalaliNumeric(new Date(inv.expiresAt).toISOString().slice(0, 10)) : 'بدون انقضا'}</td>
                      <td className="max-w-[200px] truncate py-3 text-ink-faint">{inv.note ?? inv.emailHint ?? '—'}</td>
                      <td className="py-3 text-ink-faint">{formatJalaliNumeric(new Date(inv.createdAt).toISOString().slice(0, 10))}</td>
                      <td className="py-3 text-end">
                        <div className="flex justify-end gap-1">
                          {active && <Button variant="ghost" size="sm" icon={<Ban size={13} />} onClick={() => setRevokeId(inv.id)}>باطل</Button>}
                          {!active && <Button variant="ghost" size="sm" className="text-danger" icon={<Trash2 size={13} />} onClick={() => setDeleteId(inv.id)} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <Modal open={createOpen} onClose={() => { setCreateOpen(false); setNewCode(null); }} title="ساخت کد دعوت" size="sm">
        {newCode ? (
          <div className="space-y-3">
            <p className="text-[12.5px] leading-6 text-ink-soft">کد زیر فقط همین یک بار نمایش داده می‌شود. آن را کپی کرده و از راهی امن به فرد موردنظر بدهید:</p>
            <CopyCode code={newCode} />
            <Button variant="primary" className="w-full" onClick={() => { setCreateOpen(false); setNewCode(null); }}>متوجه شدم</Button>
          </div>
        ) : (
          <form onSubmit={create} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="اعتبار (روز)">
                <Select value={days} onChange={(e) => setDays(e.target.value)}>
                  {[1, 3, 7, 14, 30, 90].map((d) => <option key={d} value={String(d)}>{toPersianDigits(d)} روز</option>)}
                </Select>
              </Field>
              <Field label="حداکثر استفاده">
                <Select value={maxUses} onChange={(e) => setMaxUses(e.target.value)}>
                  {[1, 2, 3, 5, 10].map((n) => <option key={n} value={String(n)}>{toPersianDigits(n)} نفر</option>)}
                </Select>
              </Field>
            </div>
            <Field label="ایمیل فرد دعوت‌شده" optional hint="فقط برای یادآوری شماست؛ الزامی نیست.">
              <Input type="email" value={emailHint} onChange={(e) => setEmailHint(e.target.value)} dir="ltr" className="ltr text-start" />
            </Field>
            <Field label="یادداشت" optional>
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>انصراف</Button>
              <Button type="submit" variant="primary" loading={busy}>ساخت کد</Button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog open={revokeId !== null} onClose={() => setRevokeId(null)} onConfirm={() => (revokeId ? revoke(revokeId) : undefined)} title="باطل کردن کد دعوت" message="این کد دیگر قابل استفاده نیست. اگر قبلاً استفاده شده باشد قابل باطل‌کردن نیست." confirmLabel="باطل کن" />
      <ConfirmDialog open={deleteId !== null} onClose={() => setDeleteId(null)} onConfirm={() => (deleteId ? remove(deleteId) : undefined)} danger title="حذف کد دعوت" message="رکورد این کد از فهرست حذف می‌شود." confirmLabel="حذف" />
    </>
  );
}

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/[0.07] p-3">
      <code className="flex-1 break-all text-center text-[15px] font-bold tracking-[0.1em] text-accent ltr" dir="ltr">{code}</code>
      <button
        type="button"
        onClick={async () => {
          try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
        }}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink-soft hover:text-ink"
        aria-label="کپی"
      >
        {copied ? <Check size={15} className="text-success" /> : <Copy size={15} />}
      </button>
    </div>
  );
}

