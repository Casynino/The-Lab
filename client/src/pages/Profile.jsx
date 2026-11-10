import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Lock, Eye, EyeOff, Loader2, ClipboardList, CheckCircle2, Boxes, Undo2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import api, { unwrap, apiError } from '@/lib/api';
import { ROLES, ROLE_LABELS } from '@/lib/constants';
import { RED } from '@/lib/brand';
import { formatCurrency, formatNumber, formatDate, formatDateTime } from '@/lib/format';
import { PageSpinner, Field, Input, Button } from '@/components/ui';
import { repRegions, shortRegion } from '@/lib/repRegions';
import CollapsibleList from '@/components/CollapsibleList';
import WalletCard from '@/components/WalletCard';
import { Ring } from '@/components/RepCharts';

// The profile, built from the same few shapes as the rest of the rep app (Nino, 11 Nov 2026: "it should have
// shapes, but nice — the wallet should look like the one in the wallet, and the rep should see how he is
// doing"): a profile card, the real wallet card, a "how you are doing" card, small soft activity cards, the
// closed orders in one list that opens and closes, and the password form in a soft card.

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

// ── The profile card: same dark red-lit card as the wallet, with who this is and how to reach them ──
function ProfileCard({ user, sub }) {
  const repInfo = user?.salesRep;
  const rows = [
    ['Email', user?.email],
    ['Phone', user?.phone || repInfo?.phone],
    ['Member since', user?.createdAt ? formatDate(user.createdAt) : null],
  ].filter(([, v]) => v);
  return (
    <section
      className="relative isolate overflow-hidden rounded-[22px] p-5 ring-1 ring-inset ring-white/[0.09]"
      style={{
        background: 'linear-gradient(140deg,#2c0e0c 0%,#170a0a 52%,#0e0e10 100%)',
        boxShadow: '0 14px 32px -16px rgba(0,0,0,.9), inset 0 1px 0 rgba(255,255,255,.07)',
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-12 -top-20 -z-10 h-56 w-56 rounded-full"
        style={{ background: 'radial-gradient(closest-side, rgba(238,49,36,.34), transparent)' }}
      />
      {/* Just the name — no initials circle (Nino, 11 Nov 2026: "no need of the MK, the name is ok"). */}
      <div className="min-w-0">
        <h1 className="text-2xl font-bold leading-tight tracking-tight text-white">{user?.name}</h1>
        <p className="mt-1 text-[13px] leading-snug text-white/60">
          {sub}
          {user?.isActive === false && <span className="ml-2 text-rose-300">· Inactive</span>}
        </p>
      </div>
      {rows.length > 0 && (
        <div className="mt-5 space-y-2.5 border-t border-white/10 pt-4">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-4">
              <span className="shrink-0 text-[11px] text-white/45">{label}</span>
              <span className="min-w-0 truncate text-[13px] font-medium text-white/90">{value}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── How the rep is doing: the settlement record as a ring, this month, the best month ──
function DoingCard({ insights }) {
  const s = insights?.settlement;
  const months = insights?.months || [];
  const thisMonth = months[months.length - 1];
  const best = insights?.best;
  const hasRate = s && s.onTimeRate != null;
  if (!hasRate && !(thisMonth && thisMonth.earned > 0) && !best) return null;
  return (
    <section className="active-card flex items-center gap-5">
      {hasRate && (
        <div style={{ filter: 'drop-shadow(0 0 7px rgba(238,49,36,0.35))' }}>
          <Ring size={84} stroke={7} total={100} segments={[{ value: s.onTimeRate, color: s.onTimeRate >= 80 ? '#34d399' : RED }]}>
            <span className="text-base font-bold leading-none tabular-nums text-foreground">{Math.round(s.onTimeRate)}%</span>
            <span className="mt-1 text-[9px] text-muted">on time</span>
          </Ring>
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-3">
        <p className="text-xs font-medium text-muted">How you are doing</p>
        {thisMonth && (
          <div>
            <p className="text-[11px] text-muted">Earned this month</p>
            <p className="text-lg font-semibold tabular-nums text-foreground">{formatCurrency(thisMonth.earned)}</p>
          </div>
        )}
        {best && best.earned > 0 && (
          <div>
            <p className="text-[11px] text-muted">Best month · {best.label}</p>
            <p className="text-sm font-semibold tabular-nums text-emerald-300">{formatCurrency(best.earned)}</p>
          </div>
        )}
      </div>
    </section>
  );
}

// ── A small soft card for one activity figure ─────────────────────────────────
function ActivityCard({ icon: Icon, label, value }) {
  return (
    <div className="active-card active-card--compact">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.07] text-brand-500">
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-2.5 text-[22px] font-bold leading-none tabular-nums text-foreground">{value}</p>
      <p className="mt-1 text-[11px] text-muted">{label}</p>
    </div>
  );
}

function SectionTitle({ children }) {
  return <h2 className="mb-3 px-1 text-base font-semibold text-foreground">{children}</h2>;
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

  const { data: c } = useQuery({
    queryKey: ['commissions', 'me'],
    queryFn: async () => unwrap(await api.get('/commissions/me')).data,
    enabled: isRep,
  });

  const { data: insights } = useQuery({
    queryKey: ['commissions', 'me', 'insights'],
    queryFn: async () => unwrap(await api.get('/commissions/me/insights')).data,
    enabled: isRep,
  });

  const { data: settlements } = useQuery({
    queryKey: ['settlements', 'profile', 'closed'],
    queryFn: async () => unwrap(await api.get('/settlements', { params: { status: 'SETTLED', limit: 5 } })).data,
    enabled: isRep,
  });

  const repInfo = user?.salesRep;
  // A rep's line is their number and their cities (Nino, 11 Nov 2026: "no need of Sales Representative, just the
  // rep number and name and cities"); anybody else keeps their role.
  const cities = repRegions(repInfo).map(shortRegion).join(', ');
  const sub = isRep
    ? [repInfo?.code, cities].filter(Boolean).join(' · ')
    : (ROLE_LABELS[user?.role] || user?.role);

  // The wallet card, fed exactly as on the wallet page (same rule for "can withdraw", same progress).
  const canWithdraw = c ? (c.eligible ?? (c.available >= c.minWithdrawal)) : false;
  const pct = c && c.minWithdrawal > 0 ? Math.max(0, Math.min(100, (Math.max(0, c.available) / c.minWithdrawal) * 100)) : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <ProfileCard user={user} sub={sub} />

      {isRep && (
        <>
          {!c ? <PageSpinner /> : (
            <WalletCard
              balance={formatCurrency(c.available)}
              negative={c.available < 0}
              canWithdraw={canWithdraw}
              pct={pct}
              stats={[
                { label: 'Earned', value: formatCurrency(c.earned) },
                { label: 'Paid out', value: formatCurrency(c.paid) },
                c.penalties > 0
                  ? { label: 'Fines', value: formatCurrency(c.penalties), tone: 'rose' }
                  : { label: 'Pending', value: formatCurrency(c.pendingRequests) },
              ]}
              onWithdraw={() => navigate('/commissions')}
            />
          )}

          <DoingCard insights={insights} />

          <section>
            <SectionTitle>Activity</SectionTitle>
            {statsLoading ? <PageSpinner /> : statsError ? (
              <p className="px-1 text-sm text-muted">The activity figures are not available right now.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <ActivityCard icon={ClipboardList} label="Active requests" value={formatNumber(stats.activeRequests)} />
                <ActivityCard icon={CheckCircle2} label="Completed requests" value={formatNumber(stats.completedRequests)} />
                <ActivityCard icon={Boxes} label="Boxes settled" value={formatNumber(stats.boxesSettled)} />
                <ActivityCard icon={Undo2} label="Boxes returned" value={formatNumber(stats.boxesReturned)} />
              </div>
            )}
          </section>

          {settlements && settlements.length > 0 && (
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
        </>
      )}

      <section>
        <SectionTitle>Change password</SectionTitle>
        <div className="glass-list p-5"><ChangePasswordForm /></div>
      </section>
    </div>
  );
}
