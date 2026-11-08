import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { motion } from 'motion/react';
import toast from 'react-hot-toast';
import {
  User, Mail, Phone, Shield, Calendar, CheckCircle, XCircle,
  Boxes, Coins, ClipboardList, Undo2, TrendingUp, Lock, Eye, EyeOff, Loader2, ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import api, { unwrap, apiError } from '@/lib/api';
import { ROLES, ROLE_LABELS, SETTLEMENT_STATUS_META } from '@/lib/constants';
import { formatCurrency, formatNumber, formatDateTime } from '@/lib/format';
import { PageSpinner, Badge, Field, Input, Button } from '@/components/ui';
import { initials } from '@/lib/format';

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
        <Button disabled={!valid || change.isPending} onClick={() => change.mutate()}>
          {change.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
          Update password
        </Button>
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, hint, tone = 'default' }) {
  const tones = {
    brand: 'from-brand-500/20 to-brand-500/5 text-brand-600',
    emerald: 'from-emerald-500/20 to-emerald-500/5 text-emerald-400',
    sky: 'from-sky-500/20 to-sky-500/5 text-sky-400',
    amber: 'from-amber-500/20 to-amber-500/5 text-amber-400',
    default: 'from-white/10 to-white/5 text-muted',
  };
  return (
    <motion.div whileHover={{ y: -2 }} className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
      <span className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${tones[tone]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="mt-0.5 text-sm font-medium text-white/70">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-white/40">{hint}</div>}
    </motion.div>
  );
}

// ── Info row ──────────────────────────────────────────────────────────────────
function InfoRow({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-white/50">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-white/40">{label}</div>
        <div className="truncate text-sm font-medium text-white/90">{value}</div>
      </div>
    </div>
  );
}

export default function Profile() {
  const { user } = useAuth();
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

  const joinDate = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  const repInfo = user?.salesRep;

  return (
    <div className="mx-auto max-w-3xl space-y-6">

      {/* ── Profile hero card ─────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.2, 0.7, 0.3, 1] }}
        className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#0e120c] via-[#0b0c0a] to-[#16210a] p-6 text-white shadow-xl sm:p-8"
      >
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 left-1/3 h-48 w-48 rounded-full bg-brand-500/15 blur-3xl" />

        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
          {/* Avatar */}
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-white text-2xl font-bold shadow-lg shadow-brand-500/20">
            {initials(user?.name)}
          </div>

          {/* Identity */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{user?.name}</h1>
              {user?.isActive
                ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400"><CheckCircle className="h-3 w-3" /> Active</span>
                : <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2.5 py-0.5 text-xs font-semibold text-rose-400"><XCircle className="h-3 w-3" /> Inactive</span>
              }
            </div>
            <div className="mt-1 text-sm text-white/60">{ROLE_LABELS[user?.role] || user?.role}</div>
            {repInfo?.code && <div className="mt-0.5 text-xs text-white/40">{repInfo.code}{repInfo.region ? ` · ${repInfo.region}` : ''}</div>}
          </div>
        </div>

        {/* Info rows */}
        <div className="relative mt-5 divide-y divide-white/5 border-t border-white/10 pt-1">
          <InfoRow icon={Mail} label="Email address" value={user?.email} />
          <InfoRow icon={Phone} label="Phone number" value={user?.phone || repInfo?.phone || '—'} />
          <InfoRow icon={Shield} label="Role" value={ROLE_LABELS[user?.role] || user?.role} />
          <InfoRow icon={Calendar} label="Member since" value={joinDate} />
        </div>
      </motion.div>

      {/* ── Activity summary (reps only) ──────────────────────────────────── */}
      {isRep && (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.08, ease: [0.2, 0.7, 0.3, 1] }}
        >
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Activity summary</h2>
          {statsLoading ? <PageSpinner /> : statsError ? (
            <p className="text-sm text-white/50">Could not load activity data.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard icon={ClipboardList} label="Active requests" value={formatNumber(stats.activeRequests)} tone="amber" />
              <StatCard icon={CheckCircle} label="Completed requests" value={formatNumber(stats.completedRequests)} tone="emerald" />
              <StatCard icon={Boxes} label="Boxes settled" value={formatNumber(stats.boxesSettled)} tone="brand" hint="all time" />
              <StatCard icon={Undo2} label="Boxes returned" value={formatNumber(stats.boxesReturned)} tone="sky" hint="all time" />
            </div>
          )}
        </motion.div>
      )}

      {/* ── Commission progress (reps only) ───────────────────────────────── */}
      {isRep && (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.14, ease: [0.2, 0.7, 0.3, 1] }}
          className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur"
        >
          <div className="flex items-center gap-2 mb-4">
            <Coins className="h-5 w-5 text-brand-600" />
            <h2 className="text-sm font-semibold text-white">Commission</h2>
          </div>
          {!commission ? <PageSpinner /> : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-center">
                  <div className="text-lg font-bold text-white">{formatNumber(commission.boxesSettled)}</div>
                  <div className="mt-0.5 text-xs text-white/50">Boxes settled</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-center">
                  <div className="text-lg font-bold text-brand-600">{formatCurrency(commission.earned)}</div>
                  <div className="mt-0.5 text-xs text-white/50">Total earned</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-center">
                  <div className="text-lg font-bold text-emerald-400">{formatCurrency(commission.paid)}</div>
                  <div className="mt-0.5 text-xs text-white/50">Paid out</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-center">
                  <div className="text-lg font-bold text-amber-400">{formatCurrency(commission.available)}</div>
                  <div className="mt-0.5 text-xs text-white/50">To withdraw</div>
                </div>
              </div>
              <p className="text-xs text-white/40">
                {commission.rates?.perBrand?.length
                  ? commission.rates.perBrand.map((r) => `${r.brand} ${formatCurrency(r.perBox)}/box`).join(' · ')
                  : `Rate: ${formatCurrency(commission.rule.perBox)} per box`}
                {' · '}Minimum withdrawal {formatCurrency(commission.minWithdrawal)}
              </p>
            </div>
          )}
        </motion.div>
      )}

      {/* ── Recent closed orders (reps only) ──────────────────────────────── */}
      {isRep && (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.2, ease: [0.2, 0.7, 0.3, 1] }}
          className="rounded-2xl border border-border bg-surface p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-5 w-5 text-brand-600" />
            <h2 className="text-sm font-semibold text-foreground">Closed orders</h2>
          </div>
          {!settlements ? <PageSpinner /> : !settlements.length ? (
            <p className="text-sm text-muted">No settled orders yet.</p>
          ) : (
            <ul className="space-y-2">
              {settlements.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-elevated p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{s.settlementNumber}</span>
                      <Badge className={SETTLEMENT_STATUS_META[s.status]?.cls}>{SETTLEMENT_STATUS_META[s.status]?.label}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">{formatDateTime(s.settledAt || s.updatedAt)}</div>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-emerald-400">{formatCurrency(s.settledValue)}</span>
                </li>
              ))}
            </ul>
          )}
        </motion.div>
      )}

      {/* ── Change password (all users) ───────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: isRep ? 0.26 : 0.08, ease: [0.2, 0.7, 0.3, 1] }}
        className="rounded-2xl border border-border bg-surface p-5 sm:p-6"
      >
        <div className="flex items-center gap-2 mb-4">
          <Lock className="h-5 w-5 text-brand-600" />
          <h2 className="text-sm font-semibold text-foreground">Change password</h2>
        </div>
        <ChangePasswordForm />
      </motion.div>

    </div>
  );
}
