import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Loader2, ClipboardList, CheckCircle2, Boxes, Undo2, MapPin, HandCoins, ChevronRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import api, { unwrap, apiError, tokenStore } from '@/lib/api';
import { ROLES, ROLE_LABELS } from '@/lib/constants';
import { RED } from '@/lib/brand';
import { formatCurrency, formatNumber, formatDate, formatDateTime } from '@/lib/format';
import { PageSpinner, Button } from '@/components/ui';
import { repRegions, shortRegion } from '@/lib/repRegions';
import CollapsibleList from '@/components/CollapsibleList';
import WalletCard from '@/components/WalletCard';
import VerifiedBadge from '@/components/VerifiedBadge';
import { Ring } from '@/components/RepCharts';

// The profile, built from the same few shapes as the rest of the rep app (Nino, 11 Nov 2026: "it should have
// shapes, but nice — the wallet should look like the one in the wallet, and the rep should see how he is
// doing"): a profile card, the real wallet card, a "how you are doing" card, small soft activity cards, the
// closed orders in one list that opens and closes, and the password form in a soft card.

// ── Change-password form: three short fields and one word ─────────────────────
function PasswordField({ label, value, onChange, autoComplete, show, onToggle, error }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-white/50">{label}</span>
      <div className="relative">
        <input
          type={onToggle && show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          className="input h-10 text-[14px] [&]:pr-10"
        />
        {onToggle && (
          <button type="button" onClick={onToggle} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-muted">
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
      {error && <span className="mt-1 block text-[11px] text-rose-300">{error}</span>}
    </label>
  );
}

function ChangePasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);

  const change = useMutation({
    mutationFn: async () => {
      // The server checks the confirmation too, and answers with fresh tokens: every OTHER device is signed
      // out by a password change, this one stays in.
      const res = unwrap(await api.post('/auth/change-password', { currentPassword: current, newPassword: next, confirmPassword: confirm }));
      if (res?.data?.tokens) tokenStore.set(res.data.tokens.accessToken, res.data.tokens.refreshToken);
      return res;
    },
    onSuccess: () => {
      toast.success('Password updated');
      setCurrent(''); setNext(''); setConfirm('');
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const mismatch = next && confirm && next !== confirm;
  const valid = current.length > 0 && next.length >= 8 && next === confirm;

  return (
    <div className="space-y-3">
      <PasswordField label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" show={showCurrent} onToggle={() => setShowCurrent((v) => !v)} />
      <PasswordField label="New password · 8 or more characters" value={next} onChange={setNext} autoComplete="new-password" show={showNext} onToggle={() => setShowNext((v) => !v)} />
      <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={mismatch ? 'These do not match' : undefined} />
      <Button className="mt-1 h-10 w-full justify-center rounded-full text-[13px] font-semibold" disabled={!valid || change.isPending} onClick={() => change.mutate()}>
        {change.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        Update
      </Button>
    </div>
  );
}

// ── The profile card: same dark red-lit card as the wallet, with who this is and how to reach them ──
function ProfileCard({ user, sub, cities = [] }) {
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
        {/* The blue verified mark after the name (Nino, 11 Nov 2026) — for an active account only. */}
        <div className="flex items-center gap-[5px]">
          <h1 className="min-w-0 truncate text-2xl font-bold leading-tight tracking-tight text-white">{user?.name}</h1>
          {user?.isActive !== false && <VerifiedBadge className="mt-px h-[17px] w-[17px] shrink-0" />}
        </div>
        {(sub || user?.isActive === false) && (
          <p className="mt-1 text-[13px] leading-snug text-white/60">
            {sub}
            {user?.isActive === false && <span className={sub ? 'ml-2 text-rose-300' : 'text-rose-300'}>{sub ? '· ' : ''}Inactive</span>}
          </p>
        )}
        {/* Where the rep works: a small pin and the cities as plain words, the main one first (Nino, 11 Nov
            2026: "a rep can serve more cities, so make it nicer" — then "no shapes around the cities"). */}
        {cities.length > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-[13px] leading-snug text-white/80">
            <MapPin className="mt-[2px] h-3.5 w-3.5 shrink-0 text-white/40" aria-hidden="true" />
            <span>{cities.join(' · ')}</span>
          </p>
        )}
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

// ── How the rep is doing: the settlement record as a ring, this month, the best month, and the six months ──
function DoingCard({ insights }) {
  const s = insights?.settlement;
  const months = insights?.months || [];
  const thisMonth = months[months.length - 1];
  const best = insights?.best;
  const hasRate = s && s.onTimeRate != null;
  if (!hasRate && !(thisMonth && thisMonth.earned > 0) && !best) return null;
  const top = Math.max(1, ...months.map((m) => m.earned));
  return (
    <section className="premium-card p-5">
      <div className="flex items-center gap-5">
        {hasRate && (
          <div style={{ filter: 'drop-shadow(0 0 9px rgba(238,49,36,0.4))' }}>
            <Ring size={88} stroke={7} total={100} segments={[{ value: s.onTimeRate, color: s.onTimeRate >= 80 ? '#34d399' : RED }]}>
              <span className="text-lg font-bold leading-none tabular-nums text-white">{Math.round(s.onTimeRate)}%</span>
              <span className="mt-1 text-[9px] text-white/50">on time</span>
            </Ring>
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-[11px] font-medium tracking-wide text-white/55">How you are doing</p>
          {thisMonth && (
            <div>
              <p className="text-[11px] text-white/45">Earned this month</p>
              <p className="text-[22px] font-bold leading-tight tabular-nums text-white">{formatCurrency(thisMonth.earned)}</p>
            </div>
          )}
          {best && best.earned > 0 && (
            <div>
              <p className="text-[11px] text-white/45">Best month · {best.label}</p>
              <p className="text-sm font-semibold tabular-nums text-emerald-300">{formatCurrency(best.earned)}</p>
            </div>
          )}
        </div>
      </div>

      {/* The six months at a glance: the best one in red, the rest quiet. */}
      {months.length > 1 && (
        <div className="mt-5 flex items-end justify-between gap-2 border-t border-white/10 pt-4">
          {months.map((m) => {
            const isBest = best && m.label === best.label && m.earned === best.earned;
            return (
              <div key={m.key || m.label} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex h-10 w-full items-end justify-center">
                  <div
                    className={`w-full max-w-[26px] rounded-md ${isBest ? 'bg-brand-500' : 'bg-white/[0.14]'}`}
                    style={{ height: `${Math.max(6, (m.earned / top) * 100)}%`, boxShadow: isBest ? '0 0 12px rgba(238,49,36,.45)' : undefined }}
                  />
                </div>
                <span className="text-[9px] text-white/40">{m.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── A premium card for one activity figure ────────────────────────────────────
function ActivityCard({ icon: Icon, label, value }) {
  return (
    <div className="premium-card premium-card--sm p-4">
      <span
        className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500/15 text-brand-500 ring-1 ring-inset ring-brand-500/30"
        style={{ boxShadow: '0 0 14px rgba(238,49,36,.3)' }}
      >
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-3 text-[26px] font-bold leading-none tabular-nums text-white">{value}</p>
      <p className="mt-1.5 text-[11px] text-white/50">{label}</p>
    </div>
  );
}

function SectionTitle({ children }) {
  return <h2 className="mb-3 px-1 text-base font-semibold text-foreground">{children}</h2>;
}

// ── The owner's own profile (Nino, 11 Nov 2026: "this is the admin — the boss. On a computer it should not
// look like the phone; he should see the business the way a rep sees his wallet and how he is doing").
// Every figure comes from the same two answers the dashboard already uses (/dashboard/command and
// /dashboard/analysis, shared cache) — nothing is worked out here.

// The business card: the red-lit card, like the rep's wallet — the money in the accounts, then the month.
function BusinessCard({ cmd }) {
  const m = cmd.month || {};
  const inv = cmd.inventory || {};
  const stats = [
    ['Sales this month', formatCurrency(m.revenue)],
    ['Gross profit', formatCurrency(m.grossProfit)],
    ['Boxes sold', formatNumber(m.boxes)],
  ];
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
      <p className="text-[11px] font-medium tracking-wide text-white/55">Money in the accounts</p>
      <p className="mt-1 text-[30px] font-bold leading-tight tabular-nums text-white">{formatCurrency(cmd.totalFunds)}</p>
      <p className="mt-1 text-[12px] text-white/50">
        Stock {formatCurrency(inv.costValue)} at cost · {formatNumber(inv.repBoxes)} boxes with reps
      </p>
      <div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/10 pt-4">
        {stats.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <p className="text-[11px] leading-snug text-white/45">{label}</p>
            <p className="mt-0.5 text-[14px] font-semibold leading-snug tabular-nums text-white">{value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// How the business is doing: the gross margin as the ring, this month so far, last month, the best month,
// and six months of sales as bars — the same shape as the rep's "How you are doing".
function BusinessDoingCard({ a }) {
  const trend = (a?.trend || []).slice(-6);
  const margin = a?.health?.grossMargin;
  if (!a || (!trend.length && margin == null)) return null;
  const best = trend.reduce((b, t) => (t.revenue > (b?.revenue || 0) ? t : b), null);
  const top = Math.max(1, ...trend.map((t) => t.revenue));
  return (
    <section className="premium-card p-5">
      <div className="flex items-center gap-5">
        {margin != null && (
          <div style={{ filter: 'drop-shadow(0 0 9px rgba(238,49,36,0.4))' }}>
            <Ring size={88} stroke={7} total={100} segments={[{ value: Math.max(0, Math.min(100, margin)), color: RED }]}>
              <span className="text-lg font-bold leading-none tabular-nums text-white">{Math.round(margin)}%</span>
              <span className="mt-1 text-[9px] text-white/50">margin</span>
            </Ring>
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-[11px] font-medium tracking-wide text-white/55">How the business is doing</p>
          <div>
            <p className="text-[11px] text-white/45">Sales · {a.month?.label} so far</p>
            <p className="text-[22px] font-bold leading-tight tabular-nums text-white">{formatCurrency(a.month?.revenue)}</p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <div>
              <p className="text-[11px] text-white/45">{a.lastMonth?.label}</p>
              <p className="text-sm font-semibold tabular-nums text-white/85">{formatCurrency(a.lastMonth?.revenue)}</p>
            </div>
            {best && best.revenue > 0 && (
              <div>
                <p className="text-[11px] text-white/45">Best month · {best.period}</p>
                <p className="text-sm font-semibold tabular-nums text-emerald-300">{formatCurrency(best.revenue)}</p>
              </div>
            )}
          </div>
        </div>
      </div>
      {trend.length > 1 && (
        <div className="mt-5 flex items-end justify-between gap-2 border-t border-white/10 pt-4">
          {trend.map((t) => {
            const isBest = best && t.period === best.period;
            return (
              <div key={t.period} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex h-10 w-full items-end justify-center">
                  <div
                    className={`w-full max-w-[26px] rounded-md ${isBest ? 'bg-brand-500' : 'bg-white/[0.14]'}`}
                    style={{ height: `${Math.max(6, (t.revenue / top) * 100)}%`, boxShadow: isBest ? '0 0 12px rgba(238,49,36,.45)' : undefined }}
                  />
                </div>
                <span className="text-[9px] text-white/40">{t.period}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// One thing waiting for the owner: the activity card, but it opens the page where it is done.
function WaitingCard({ icon: Icon, label, value, onClick }) {
  const waiting = value > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="premium-card premium-card--sm p-4 text-left transition hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-inset ${waiting ? 'bg-brand-500/15 text-brand-500 ring-brand-500/30' : 'bg-white/[0.06] text-white/40 ring-white/10'}`}
        style={waiting ? { boxShadow: '0 0 14px rgba(238,49,36,.3)' } : undefined}
      >
        <Icon className="h-4 w-4" />
      </span>
      <p className={`mt-3 text-[26px] font-bold leading-none tabular-nums ${waiting ? 'text-white' : 'text-white/45'}`}>{formatNumber(value)}</p>
      <p className="mt-1.5 text-[11px] text-white/50">{label}</p>
    </button>
  );
}

// The reps this month, best first; a row opens the rep.
function RepsThisMonth({ reps, onOpen }) {
  if (!reps?.length) return null;
  const list = [...reps].sort((x, y) => (y.salesMonth || 0) - (x.salesMonth || 0));
  const overdue = reps.reduce((s, r) => s + (r.overdueOrders || 0), 0);
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-base font-semibold text-foreground">Your reps this month</h2>
        {overdue > 0 && <span className="text-[12px] text-rose-300">{formatNumber(overdue)} overdue</span>}
      </div>
      <div className="glass-list divide-y divide-white/[0.06]">
        {list.map((r, i) => (
          <button
            key={r.salesRepId}
            type="button"
            onClick={() => onOpen(r.salesRepId)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03]"
          >
            <span className="w-5 shrink-0 text-[12px] tabular-nums text-white/35">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{r.name}</p>
              <p className="mt-0.5 truncate text-xs text-muted">
                {r.code} · {formatNumber(r.boxesHeld)} {r.boxesHeld === 1 ? 'box' : 'boxes'} · {formatNumber(r.activeOrders)} open
                {r.overdueOrders > 0 && <span className="text-rose-300"> · {formatNumber(r.overdueOrders)} overdue</span>}
              </p>
            </div>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-white">{formatCurrency(r.salesMonth)}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-white/25" aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}

function AdminProfile({ user, sub }) {
  const navigate = useNavigate();
  const { data: cmd, isError: cmdError } = useQuery({
    queryKey: ['dashboard', 'command'],
    queryFn: async () => unwrap(await api.get('/dashboard/command')).data,
  });
  const { data: analysis } = useQuery({
    queryKey: ['dashboard', 'analysis'],
    queryFn: async () => unwrap(await api.get('/dashboard/analysis')).data,
    retry: 1,
  });
  const at = cmd?.attention || {};

  // A phone: one column — the card, the business, the password last. A computer: the person and the
  // password on the left, the business on the right. (The password form is placed twice and only one of
  // the two is ever shown, so each layout keeps its natural order.)
  const password = (
    <CollapsibleList title="Change password" variant="premium">
      <ChangePasswordForm />
    </CollapsibleList>
  );
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:items-start">
      <div className="space-y-6">
        <ProfileCard user={user} sub={sub} />
        <div className="hidden lg:block">{password}</div>
      </div>

      <div className="min-w-0 space-y-8">
        {!cmd ? (
          cmdError ? <p className="px-1 text-sm text-muted">The business figures are not available right now.</p> : <PageSpinner />
        ) : (
          <>
            <div className="grid gap-4 xl:grid-cols-2">
              <BusinessCard cmd={cmd} />
              <BusinessDoingCard a={analysis} />
            </div>

            <section>
              <SectionTitle>Waiting for you</SectionTitle>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <WaitingCard icon={ClipboardList} label="Stock requests" value={at.stockRequests || 0} onClick={() => navigate('/stock-requests')} />
                <WaitingCard icon={CheckCircle2} label="Settlements" value={at.settlements || 0} onClick={() => navigate('/settlements')} />
                <WaitingCard icon={Undo2} label="Returns" value={at.returns || 0} onClick={() => navigate('/returns')} />
                <WaitingCard icon={HandCoins} label="Withdrawals" value={at.commissionRequests?.count || 0} onClick={() => navigate('/commissions')} />
              </div>
            </section>

            <RepsThisMonth reps={cmd.reps} onOpen={(id) => navigate(`/reps/${id}`)} />
          </>
        )}
      </div>

      <div className="lg:hidden">{password}</div>
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
  // The cities now stand on their own line as chips under the number (Nino, 11 Nov 2026), so the line
  // under the name is just the rep number — or the role, for anybody else.
  const cities = isRep ? repRegions(repInfo).map(shortRegion).filter(Boolean) : [];
  const sub = isRep ? (repInfo?.code || '') : (ROLE_LABELS[user?.role] || user?.role);

  // The wallet card, fed exactly as on the wallet page (same rule for "can withdraw", same progress).
  const canWithdraw = c ? (c.eligible ?? (c.available >= c.minWithdrawal)) : false;
  const pct = c && c.minWithdrawal > 0 ? Math.max(0, Math.min(100, (Math.max(0, c.available) / c.minWithdrawal) * 100)) : 0;

  if (user?.role === ROLES.ADMIN) return <AdminProfile user={user} sub={sub} />;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <ProfileCard user={user} sub={sub} cities={cities} />

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

      {/* Short: just a heading until it is opened, then three small fields in the premium card. */}
      <CollapsibleList title="Change password" variant="premium">
        <ChangePasswordForm />
      </CollapsibleList>
    </div>
  );
}
