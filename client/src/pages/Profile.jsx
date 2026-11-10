import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Lock, Eye, EyeOff, Loader2, ChevronRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import api, { unwrap, apiError } from '@/lib/api';
import { ROLES, ROLE_LABELS } from '@/lib/constants';
import { formatCurrency, formatNumber, formatDate, formatDateTime, initials } from '@/lib/format';
import { PageSpinner, Field, Input, Button } from '@/components/ui';
import CollapsibleList from '@/components/CollapsibleList';

// The profile in the same plain style as the wallet, Settle and Requests pages (Nino, 11 Nov 2026: "this
// page is bad — it follows the old style, too much shape, bad arrangement"): sections straight on the
// background, figures instead of tiles, finished orders in one open-and-close list, no cards.

// ── Change-password form ──────────────────────────────────────────────────────
function ChangePasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);

  const change = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      toast.success('Password updated');
      setCurrent(''); setNext(''); setConfirm('');
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const mismatch = next && confirm && next !== confirm;
  const valid = current.length > 0 && next.length >= 6 && next === confirm;

  return (
    <div className="space-y-4">
      <Field label="Current password" required>
        <div className="relative">
          <Input type={showCurrent ? 'text' : 'password'} value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
          <button type="button" onClick={() => setShowCurrent((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-muted">
            {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </Field>
      <Field label="New password" required hint="Minimum 6 characters">
        <div className="relative">
          <Input type={showNext ? 'text' : 'password'} value={next} onChange={(e) => setNext(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
          <button type="button" onClick={() => setShowNext((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-muted">
            {showNext ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </Field>
      <Field label="Confirm new password" required error={mismatch ? 'Passwords do not match' : undefined}>
        <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
      </Field>
      <div className="flex justify-end">
        <Button className="rounded-full px-5" disabled={!valid || change.isPending} onClick={() => change.mutate()}>
          {change.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
          Update password
        </Button>
      </div>
    </div>
  );
}

// ── A figure: a small label and one value, no box ─────────────────────────────
function Figure({ label, value, tone }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`mt-0.5 truncate text-lg font-semibold tabular-nums ${tone || 'text-foreground'}`}>{value}</p>
    </div>
  );
}

// ── A line of contact detail: label on the left, value on the right ───────────
function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <span className="shrink-0 text-xs text-muted">{label}</span>
      <span className="min-w-0 truncate text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

function SectionTitle({ children, action }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 px-1">
      <h2 className="text-base font-semibold text-foreground">{children}</h2>
      {action}
    </div>
  );
}

export default function Profile() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isRep = user?.role === ROLES.SALES_REP;

  const { data: stats, isLoading: statsLoading, isError: statsError } = useQuery({
    queryKey: ['dashboard', 'me', 'stats'],
    queryFn: async () => unwrap(await api.get('/dashboard/me/stats')).data,
    enabled: isRep,
  });

  const { data: commission } = useQuery({
    queryKey: ['commissions', 'me'],
    queryFn: async () => unwrap(await api.get('/commissions/me')).data,
    enabled: isRep,
  });

  const { data: settlements } = useQuery({
    queryKey: ['settlements', 'profile', 'closed'],
    queryFn: async () => unwrap(await api.get('/settlements', { params: { status: 'SETTLED', limit: 5 } })).data,
    enabled: isRep,
  });

  const repInfo = user?.salesRep;
  const sub = [ROLE_LABELS[user?.role] || user?.role, repInfo?.code, repInfo?.region].filter(Boolean).join(' · ');

  return (
    <div className="mx-auto max-w-3xl space-y-9">

      {/* ── Who this is: the initials, the name, one quiet line, then the contact details ── */}
      <section className="px-1">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-lg font-bold text-brand-600 ring-1 ring-inset ring-brand-500/30">
            {initials(user?.name)}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight text-foreground">{user?.name}</h1>
            <p className="mt-0.5 truncate text-sm text-muted">
              {sub}
              {user?.isActive === false && <span className="ml-2 text-rose-300">· Inactive</span>}
            </p>
          </div>
        </div>
        <div className="mt-5 divide-y divide-white/[0.07] border-t border-white/[0.07]">
          <InfoRow label="Email" value={user?.email} />
          <InfoRow label="Phone" value={user?.phone || repInfo?.phone} />
          <InfoRow label="Member since" value={user?.createdAt ? formatDate(user.createdAt) : null} />
        </div>
      </section>

      {/* ── Activity (reps) ── */}
      {isRep && (
        <section>
          <SectionTitle>Activity</SectionTitle>
          <div className="px-1">
            {statsLoading ? <PageSpinner /> : statsError ? (
              <p className="text-sm text-muted">The activity figures are not available right now.</p>
            ) : (
              <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                <Figure label="Active requests" value={formatNumber(stats.activeRequests)} />
                <Figure label="Completed requests" value={formatNumber(stats.completedRequests)} />
                <Figure label="Boxes settled" value={formatNumber(stats.boxesSettled)} />
                <Figure label="Boxes returned" value={formatNumber(stats.boxesReturned)} />
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Wallet (reps): three figures, and a way to the full page ── */}
      {isRep && (
        <section>
          <SectionTitle
            action={(
              <button type="button" onClick={() => navigate('/commissions')} className="flex items-center gap-0.5 text-[13px] font-semibold text-brand-600 transition hover:text-brand-500">
                Open wallet <ChevronRight className="h-4 w-4" />
              </button>
            )}
          >
            My wallet
          </SectionTitle>
          <div className="px-1">
            {!commission ? <PageSpinner /> : (
              <>
                <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                  <Figure label="Total earned" value={formatCurrency(commission.earned)} />
                  <Figure label="Paid out" value={formatCurrency(commission.paid)} />
                  <Figure label="To withdraw" value={formatCurrency(commission.available)} tone="text-emerald-300" />
                </div>
                <p className="mt-4 text-[11px] leading-snug text-faint">
                  {commission.rates?.perBrand?.length
                    ? commission.rates.perBrand.map((r) => `${r.brand} ${formatCurrency(r.perBox)}/box`).join(' · ')
                    : `${formatCurrency(commission.rule.perBox)} per box`}
                  {' · '}Minimum withdrawal {formatCurrency(commission.minWithdrawal)}
                </p>
              </>
            )}
          </div>
        </section>
      )}

      {/* ── Closed orders (reps): one open-and-close list ── */}
      {isRep && settlements && settlements.length > 0 && (
        <CollapsibleList title="Closed orders" count={settlements.length}>
          {settlements.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{s.settlementNumber}</p>
                <p className="mt-0.5 text-xs text-muted">{formatDateTime(s.settledAt || s.updatedAt)}</p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-emerald-300">{formatCurrency(s.settledValue)}</span>
            </div>
          ))}
        </CollapsibleList>
      )}

      {/* ── Change password (everyone) ── */}
      <section>
        <SectionTitle>Change password</SectionTitle>
        <div className="px-1"><ChangePasswordForm /></div>
      </section>

    </div>
  );
}
