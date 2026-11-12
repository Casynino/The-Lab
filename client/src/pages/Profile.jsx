import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Eye, EyeOff, Loader2, ClipboardList, CheckCircle2, Boxes, Undo2, MapPin, HandCoins, ChevronRight,
  LayoutDashboard, ShieldCheck, Settings as SettingsIcon, Activity as ActivityIcon, ScrollText, NotebookPen,
} from 'lucide-react';
// The owner's own pages, opened inside his profile (Nino, 11 Nov 2026: "all these pages should be
// inside Nino's profile — he is the one who runs the company").
import UsersPage from '@/pages/Users';
import SettingsPage from '@/pages/Settings';
import ActivityPage from '@/pages/Activity';
import AuditLogsPage from '@/pages/AuditLogs';
import DailyReportsPage from '@/pages/DailyReports';
import ReportsArchive from '@/components/ReportsArchive';

// Reports: the business reports he receives on WhatsApp (kept as sent), then the reps' daily reports.
function ReportsSection() {
  return (
    <div className="space-y-10">
      <ReportsArchive />
      <DailyReportsPage />
    </div>
  );
}
import { useAuth } from '@/context/AuthContext';
import api, { unwrap, apiError, tokenStore } from '@/lib/api';
import { ROLES, ROLE_LABELS } from '@/lib/constants';
import { RED } from '@/lib/brand';
import { formatCurrency, formatNumber, formatDate, formatDateTime } from '@/lib/format';
import { PageSpinner, Button, LoadError } from '@/components/ui';
import { repRegions, shortRegion } from '@/lib/repRegions';
import CollapsibleList from '@/components/CollapsibleList';
import WalletCard from '@/components/WalletCard';
import VerifiedBadge from '@/components/VerifiedBadge';
import { Ring } from '@/components/Ring';

// The profile, built from the same few shapes as the rest of the rep app (Nino, 11 Nov 2026: "it should have
// shapes, but nice — the wallet should look like the one in the wallet, and the rep should see how he is
// doing"): a profile card, the real wallet card, a "how you are doing" card, small soft activity cards, the
// closed orders in one list that opens and closes, and the password form in a soft card.

// ── Change-password form: three short fields and one word ─────────────────────
// `compact`: the label sits inside the field as its placeholder, and the field is slimmer (the owner's card).
function PasswordField({ label, value, onChange, autoComplete, show, onToggle, error, compact = false }) {
  return (
    <label className="block">
      {!compact && <span className="mb-1 block text-[11px] text-white/50">{label}</span>}
      <div className="relative">
        <input
          type={onToggle && show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={compact ? label : undefined}
          aria-label={label}
          className={compact
            ? 'input h-9 border-white/10 bg-black/25 text-[13px] placeholder:text-white/35 [&]:pr-10'
            : 'input h-10 text-[14px] [&]:pr-10'}
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

function ChangePasswordForm({ compact = false }) {
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
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <PasswordField compact={compact} label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" show={showCurrent} onToggle={() => setShowCurrent((v) => !v)} />
      <PasswordField compact={compact} label={compact ? 'New password (8+ characters)' : 'New password · 8 or more characters'} value={next} onChange={setNext} autoComplete="new-password" show={showNext} onToggle={() => setShowNext((v) => !v)} />
      <PasswordField compact={compact} label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={mismatch ? 'These do not match' : undefined} />
      <Button className={`${compact ? 'mt-0.5 h-9' : 'mt-1 h-10'} w-full justify-center rounded-full text-[13px] font-semibold`} disabled={!valid || change.isPending} onClick={() => change.mutate()}>
        {change.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        Update
      </Button>
    </div>
  );
}

// ── The profile card: same dark red-lit card as the wallet, with who this is and how to reach them ──
// `quiet`: the owner's profile wears the rep side's neutral glass (Nino, 11 Nov 2026: "the red here is too
// much … mix the other colours, clean like the rep side"); a rep's own profile keeps its red-lit card.
function ProfileCard({ user, sub, cities = [], quiet = false }) {
  const repInfo = user?.salesRep;
  const rows = [
    ['Email', user?.email],
    ['Phone', user?.phone || repInfo?.phone],
    ['Member since', user?.createdAt ? formatDate(user.createdAt) : null],
  ].filter(([, v]) => v);
  return (
    <section
      className={quiet ? 'stat-glass p-5' : 'relative isolate overflow-hidden rounded-[22px] p-5 ring-1 ring-inset ring-white/[0.09]'}
      style={quiet ? undefined : {
        background: 'linear-gradient(140deg,#2c0e0c 0%,#170a0a 52%,#0e0e10 100%)',
        boxShadow: '0 14px 32px -16px rgba(0,0,0,.9), inset 0 1px 0 rgba(255,255,255,.07)',
      }}
    >
      {!quiet && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 -top-20 -z-10 h-56 w-56 rounded-full"
          style={{ background: 'radial-gradient(closest-side, rgba(238,49,36,.34), transparent)' }}
        />
      )}
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
      className="stat-glass p-5"
    >
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
    <section className="stat-glass p-5">
      <div className="flex items-center gap-5">
        {margin != null && (
          <div>
            <Ring size={88} stroke={7} total={100} segments={[{ value: Math.max(0, Math.min(100, margin)), color: '#34d399' }]}>
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
                    className={`w-full max-w-[26px] rounded-md ${isBest ? 'bg-emerald-400' : 'bg-white/[0.14]'}`}
                    style={{ height: `${Math.max(6, (t.revenue / top) * 100)}%` }}
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
      data-tone={waiting ? 'brand' : undefined}
      className="stat-glass p-4 text-left transition hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
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

// Each brand's month, side by side (the dashboard's own colours: OHIS green, Civlily violet).
const BRAND_DOT = { OHIS: 'bg-emerald-400', CIVLILY: 'bg-violet-400' };
function BrandsThisMonth({ brands }) {
  if (!brands?.length) return null;
  return (
    <section>
      <SectionTitle>Your brands this month</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        {brands.map((b) => (
          <div key={b.brandId} className="stat-glass p-4">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${BRAND_DOT[String(b.name).toUpperCase()] || 'bg-white/50'}`} aria-hidden="true" />
              <p className="text-sm font-semibold text-white">{b.name}</p>
              {b.marginMonth != null && <span className="ml-auto text-[11px] tabular-nums text-white/50">{Math.round(b.marginMonth)}% margin</span>}
            </div>
            <p className="mt-3 text-[22px] font-bold leading-tight tabular-nums text-white">{formatCurrency(b.revenueMonth)}</p>
            <p className="mt-0.5 text-[11px] text-white/45">{formatNumber(b.boxesSoldMonth)} {b.boxesSoldMonth === 1 ? 'box' : 'boxes'} sold</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-white/10 pt-3 text-[12px] text-white/60">
              <span><span className="tabular-nums text-white/85">{formatNumber(b.warehouseBoxes)}</span> in the warehouse</span>
              <span><span className="tabular-nums text-white/85">{formatNumber(b.repBoxes)}</span> with reps</span>
            </div>
            {b.topProduct?.name && <p className="mt-2 truncate text-[11px] text-white/40">Best seller · {b.topProduct.name}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

// Where the money is: every account and its balance (the commission record is not money, so it is left out).
function AccountsCard({ accounts }) {
  const list = (accounts || []).filter((a) => !a.isCommissionRecord);
  if (!list.length) return null;
  return (
    <section>
      <SectionTitle>Accounts</SectionTitle>
      <div className="glass-list divide-y divide-white/[0.06]">
        {list.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <p className="min-w-0 truncate text-sm font-medium text-foreground">{a.name}</p>
            <span className={`shrink-0 text-sm font-semibold tabular-nums ${a.balance < 0 ? 'text-rose-300' : 'text-white'}`}>{formatCurrency(a.balance)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── The Lab: the owner's pages, chosen from his profile ──────────────────────
// Users, Settings, Activity, Audit and the reps' daily reports used to be sidebar pages of their own;
// they are his, so they open here, in the right-hand column, from a list under his card. The address
// keeps the choice (/profile?tab=users), so a link or the back button lands on the same section.
export const LAB_SECTIONS = [
  { key: 'overview', label: 'Overview', hint: 'The business today', icon: LayoutDashboard },
  { key: 'users', label: 'Users', hint: 'Accounts, roles and access', icon: ShieldCheck, Page: UsersPage },
  { key: 'settings', label: 'Settings', hint: 'WhatsApp alerts and the system', icon: SettingsIcon, Page: SettingsPage },
  { key: 'activity', label: 'Activity', hint: 'Everything happening, live', icon: ActivityIcon, Page: ActivityPage },
  { key: 'audit', label: 'Audit log', hint: 'Who did what, and when', icon: ScrollText, Page: AuditLogsPage },
  { key: 'reports', label: 'Reports', hint: "Your business reports and the reps' daily ones", icon: NotebookPen, Page: ReportsSection },
];

// The owner's pages as one premium card (Nino, 11 Nov 2026: "the list should be nice — the selected one
// and all of it should match the design"): the chosen page is lit — a red bar at its edge, a soft red
// wash, its icon glowing — the others light up gently under the pointer.
function LabNav({ tab, onChange }) {
  return (
    <nav aria-label="The Lab" className="stat-glass p-2">
      <p className="px-3 pb-1.5 pt-2 text-[11px] font-medium tracking-wide text-white/50">The Lab</p>
      <ul className="space-y-0.5">
        {LAB_SECTIONS.map((s) => {
          const active = s.key === tab;
          const Icon = s.icon;
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => onChange(s.key)}
                aria-current={active ? 'page' : undefined}
                className={`group relative flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 ${active
                  ? 'bg-white/[0.07]'
                  : 'hover:bg-white/[0.045]'}`}
              >
                {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-brand-500" aria-hidden="true" />}
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset transition ${active ? 'bg-brand-500/20 text-brand-400 ring-brand-500/40' : 'bg-white/[0.05] text-white/55 ring-white/10 group-hover:text-white/80'}`}
                  style={undefined}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${active ? 'font-semibold text-white' : 'font-medium text-white/85'}`}>{s.label}</span>
                  <span className="block truncate text-[11px] text-white/45">{s.hint}</span>
                </span>
                <ChevronRight className={`h-4 w-4 shrink-0 transition ${active ? 'text-brand-400' : 'text-white/20 group-hover:translate-x-0.5 group-hover:text-white/45'}`} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function AdminProfile({ user, sub }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  const tab = LAB_SECTIONS.some((s) => s.key === asked) ? asked : 'overview';
  const section = LAB_SECTIONS.find((s) => s.key === tab);
  const contentRef = useRef(null);
  const openSection = (key) => {
    // On a computer a section is a tab: replace, so it is not a Back step. On a phone it opens below the list
    // like a page of its own, and Back returns to the list (navigation-10).
    setParams(key === 'overview' ? {} : { tab: key }, { replace: window.innerWidth >= 1024 });
    // On a phone the section opens below the list: bring it into view.
    if (window.innerWidth < 1024) setTimeout(() => contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const { data: cmd, isError: cmdError, refetch: retryCmd } = useQuery({
    queryKey: ['dashboard', 'command'],
    queryFn: async () => unwrap(await api.get('/dashboard/command')).data,
    enabled: tab === 'overview',
  });
  const { data: analysis } = useQuery({
    queryKey: ['dashboard', 'analysis'],
    queryFn: async () => unwrap(await api.get('/dashboard/analysis')).data,
    retry: 1,
    enabled: tab === 'overview',
  });
  const at = cmd?.attention || {};

  // Opening one of his pages should be instant (Nino, 11 Nov 2026: "why does it take so long to load —
  // make everything fast"). A moment after the profile has drawn, each section's first screen is fetched
  // quietly into the cache, under the very keys those pages use; a fresh answer is never asked for twice.
  const qc = useQueryClient();
  useEffect(() => {
    const t = setTimeout(() => {
      const get = (url, params) => api.get(url, params ? { params } : undefined);
      const warm = [
        [['users', { page: 1, search: '' }], async () => unwrap(await get('/users', { page: 1, limit: 20, search: '' }))],
        [['roles'], async () => unwrap(await get('/roles')).data],
        [['settings'], async () => unwrap(await get('/settings')).data],
        [['whatsapp-types'], async () => unwrap(await get('/settings/whatsapp/types')).data],
        [['whatsapp-history'], async () => unwrap(await get('/settings/whatsapp/history?limit=25')).data],
        [['activity'], async () => unwrap(await get('/activity', { limit: 50 })).data],
        [['audit-logs', { page: 1, search: '' }], async () => unwrap(await get('/audit-logs', { page: 1, limit: 25, search: '' }))],
        [['daily-reports', { page: 1 }], async () => unwrap(await get('/daily-reports', { page: 1, limit: 20 }))],
        [['report-archive', '', '', ''], async () => unwrap(await get('/finance/report-archive')).data],
      ];
      warm.forEach(([queryKey, queryFn]) => qc.prefetchQuery({ queryKey, queryFn }).catch(() => {}));
    }, 1200);
    return () => clearTimeout(t);
  }, [qc]);

  // A phone: one column — the card, the business, the password last. A computer: the person and the
  // password on the left, the business on the right. (The password form is placed twice and only one of
  // the two is ever shown, so each layout keeps its natural order.) For the owner it is always open, in
  // its own card — not folded away (Nino, 11 Nov 2026: "it should be visible, not hidden in the drop-down").
  // Compact (Nino, 11 Nov 2026: "the password card looks big"): a small heading inside the card, slimmer
  // fields, the same three steps.
  const password = (
    <section className="stat-glass p-4">
      <p className="mb-3 text-[11px] font-medium tracking-wide text-white/50">Change password</p>
      <ChangePasswordForm compact />
    </section>
  );
  // The whole width of the screen (Nino, 11 Nov 2026: "why the space on the sides — I want the page full").
  return (
    <div className="flex w-full flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:items-start 2xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      {/* Left: who he is, his pages, his password. It stays in view while a long section scrolls on the
          right (no empty space under it), and scrolls on its own if the window is shorter than it. */}
      <div className="space-y-5 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:p-0.5 lg:[scrollbar-width:thin]">
        <ProfileCard user={user} sub={sub} quiet />
        <LabNav tab={tab} onChange={openSection} />
        <div className="hidden lg:block">{password}</div>
      </div>

      <div ref={contentRef} className="min-w-0 scroll-mt-4 space-y-8">
        {section?.Page ? (
          // One of his pages — its title, its tools, its tables — in the profile's own finish (.lab-section).
          <div className="lab-section"><section.Page /></div>
        ) : !cmd ? (
          cmdError ? <LoadError what="the business figures" onRetry={retryCmd} /> : <PageSpinner />
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

            {/* Wide screens: the reps beside the brands and the accounts; narrower ones: one under the other. */}
            <div className="grid items-start gap-8 2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <RepsThisMonth reps={cmd.reps} onOpen={(id) => navigate(`/reps/${id}`)} />
              <div className="space-y-8">
                <BrandsThisMonth brands={cmd.brands} />
                <AccountsCard accounts={cmd.accounts} />
              </div>
            </div>
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

  const { data: stats, isLoading: statsLoading, isError: statsError, refetch: retryStats } = useQuery({
    queryKey: ['dashboard', 'me', 'stats'],
    queryFn: async () => unwrap(await api.get('/dashboard/me/stats')).data,
    enabled: isRep,
  });

  const { data: c, isError: walletFailed, refetch: retryWallet } = useQuery({
    queryKey: ['commissions', 'me'],
    queryFn: async () => unwrap(await api.get('/commissions/me')).data,
    enabled: isRep,
  });

  const { data: insights } = useQuery({
    queryKey: ['commissions', 'me', 'insights'],
    queryFn: async () => unwrap(await api.get('/commissions/me/insights')).data,
    enabled: isRep,
  });

  // The latest five, with the real number of closed orders from the list's total (the count beside
  // the heading used to be the five rows it fetched, so it never went past 5).
  const { data: closed } = useQuery({
    queryKey: ['settlements', 'profile', 'closed'],
    queryFn: async () => unwrap(await api.get('/settlements', { params: { status: 'SETTLED', limit: 5 } })),
    enabled: isRep,
  });
  const settlements = closed?.data || [];
  const closedTotal = closed?.meta?.total ?? settlements.length;

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

  // The owner is not "Administrator" here — he runs the Lab (Nino, 11 Nov 2026: "he is like the main lab,
  // call him something cooler"). Only this card; the role keeps its name in Users and permissions.
  if (user?.role === ROLES.ADMIN) return <AdminProfile user={user} sub="Head of the Lab" />;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <ProfileCard user={user} sub={sub} cities={cities} />

      {isRep && (
        <>
          {walletFailed && !c ? <LoadError what="your wallet" onRetry={retryWallet} /> : !c ? <PageSpinner /> : (
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
            {/* Never read stats while they are missing (audit pwa-brand-load-1: offline, a paused query had
                no figures and no error, and reading one blacked out the whole app). */}
            {statsLoading ? <PageSpinner /> : statsError && !stats ? (
              <LoadError what="your activity figures" onRetry={retryStats} />
            ) : !stats ? <PageSpinner /> : (
              <div className="grid grid-cols-2 gap-3">
                <ActivityCard icon={ClipboardList} label="Active requests" value={formatNumber(stats.activeRequests)} />
                <ActivityCard icon={CheckCircle2} label="Completed requests" value={formatNumber(stats.completedRequests)} />
                <ActivityCard icon={Boxes} label="Boxes settled" value={formatNumber(stats.boxesSettled)} />
                <ActivityCard icon={Undo2} label="Boxes returned" value={formatNumber(stats.boxesReturned)} />
              </div>
            )}
          </section>

          {settlements.length > 0 && (
            <CollapsibleList title="Closed orders" count={closedTotal}>
              {settlements.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{s.settlementNumber}</p>
                    <p className="mt-0.5 text-xs text-muted">{formatDateTime(s.settledAt || s.updatedAt)}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-emerald-300">{formatCurrency(s.settledValue)}</span>
                </div>
              ))}
              {closedTotal > settlements.length && (
                <button type="button" onClick={() => navigate('/settlements')}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-xs text-muted transition hover:text-foreground">
                  <span>Latest {settlements.length} of {formatNumber(closedTotal)}</span>
                  <span className="font-medium">See all</span>
                </button>
              )}
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
