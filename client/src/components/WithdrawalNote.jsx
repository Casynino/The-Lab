import clsx from 'clsx';
import { Coins, Clock, ShieldCheck, PartyPopper, ShieldAlert, Sparkles } from 'lucide-react';
import { formatCurrency, formatNumber, formatDateTime } from '@/lib/format';
import { WITHDRAWAL_STATUS_META } from '@/lib/constants';
import { Badge } from '@/components/ui';

// ── WHERE A REP'S MONEY HAS GOT TO ───────────────────────────────────────────
// "make it even better on rep profile too, i think the withdraw it has been not
// nice, make the ui nice and give it like a nice note or congratulation."
//
// The withdrawal was a disabled button and a table of statuses: correct, and
// silent about the only thing the rep is actually asking — where is my money.
// This answers it in one sentence, in the state the rep is really in, and says
// congratulations where a congratulation is honest. Nothing is dressed up: a
// rep below the minimum is told the number, a rejected request says so.
//
// Every class here is a literal string. A tint assembled at runtime
// (`bg-${tone}-500/15`) compiles to nothing — this repo has been bitten by that
// three times — so each state carries its finished classes.
const TONE = {
  emerald: {
    ring: 'ring-emerald-500/25',
    glow: 'from-emerald-500/[0.12]',
    chip: 'bg-emerald-500/15 text-emerald-300',
    value: 'text-emerald-300',
  },
  amber: {
    ring: 'ring-amber-500/25',
    glow: 'from-amber-500/[0.12]',
    chip: 'bg-amber-500/15 text-amber-300',
    value: 'text-amber-300',
  },
  sky: {
    ring: 'ring-sky-500/25',
    glow: 'from-sky-500/[0.12]',
    chip: 'bg-sky-500/15 text-sky-300',
    value: 'text-sky-300',
  },
  brand: {
    ring: 'ring-brand-500/25',
    glow: 'from-brand-500/[0.12]',
    chip: 'bg-brand-500/15 text-brand-300',
    value: 'text-brand-300',
  },
  rose: {
    ring: 'ring-rose-500/25',
    glow: 'from-rose-500/[0.12]',
    chip: 'bg-rose-500/15 text-rose-300',
    value: 'text-rose-300',
  },
};

// What the boxes behind a figure were — "240 boxes settled · 150 OHIS, 90
// Civlily". A number with its reason attached is worth more than the number.
export function earnedOn({ boxesSettled, earnedByBrand } = {}) {
  const brands = (earnedByBrand || []).filter((b) => b.boxes > 0);
  const boxes = `${formatNumber(boxesSettled || 0)} box${Number(boxesSettled) === 1 ? '' : 'es'} settled`;
  if (!brands.length) return boxes;
  return `${boxes} · ${brands.map((b) => `${formatNumber(b.boxes)} ${b.brand}`).join(', ')}`;
}

// Which of the five honest states this rep is in. Order matters: a request in
// flight outranks the balance, because "where is my money" is the live question
// once one has been sent.
// How long a decided request keeps its own card. PENDING and APPROVED are
// live — they stay until they move. PAID and REJECTED are news, and news goes
// stale: a rep paid in June should not still be congratulated in September,
// least of all with today's box count attributed to that payout.
const NEWS_DAYS = 7;
const isRecent = (at) => {
  if (!at) return false;
  const t = new Date(at).getTime();
  return Number.isFinite(t) && Date.now() - t <= NEWS_DAYS * 24 * 60 * 60 * 1000;
};

export function withdrawalState({ commission = {}, latest = null, firstName = '', audience = 'rep' } = {}) {
  const forOwner = audience === 'owner';
  const they = firstName || 'This rep';
  const available = Number(commission.available) || 0;
  const min = Number(commission.minWithdrawal ?? commission.threshold) || 0;
  const earned = Number(commission.earned) || 0;
  const who = firstName ? `, ${firstName}` : '';

  if (latest?.status === 'PENDING') {
    return {
      key: 'pending', tone: 'amber', icon: Clock,
      title: forOwner ? `${they} is waiting on you` : 'Your request is with The Lab',
      value: formatCurrency(latest.amount),
      line: forOwner
        ? `Requested ${formatDateTime(latest.requestedAt)}. Approve or decline it on the Commissions page.`
        : `Sent ${formatDateTime(latest.requestedAt)}. You will get a notification the moment it is approved — nothing more to do.`,
    };
  }
  if (latest?.status === 'APPROVED') {
    return {
      key: 'approved', tone: 'sky', icon: ShieldCheck,
      title: forOwner ? `Approved — still to pay ${they}` : 'Approved — the payout is being made',
      value: formatCurrency(latest.amount),
      line: forOwner
        ? 'You have approved this. Mark it paid once the money is in their hand.'
        : 'The Lab has approved it. You will be notified again once the money is in your hand.',
    };
  }
  if (latest?.status === 'PAID' && isRecent(latest.paidAt || latest.decidedAt)) {
    return {
      key: 'paid', tone: 'emerald', icon: PartyPopper,
      title: forOwner ? `Paid to ${they}` : `Paid — well done${who}`,
      value: formatCurrency(latest.amount),
      line: forOwner
        ? `Paid ${formatDateTime(latest.paidAt || latest.decidedAt || latest.requestedAt)}, from your own pocket. Recorded on the Commission account.`
        : `Paid out ${formatDateTime(latest.paidAt || latest.decidedAt || latest.requestedAt)}. Earned on ${earnedOn(commission)}. Keep settling and the next one builds from here.`,
    };
  }
  if (latest?.status === 'REJECTED' && isRecent(latest.decidedAt || latest.requestedAt)) {
    return {
      key: 'rejected', tone: 'rose', icon: ShieldAlert,
      title: 'That request was not approved',
      value: formatCurrency(latest.amount),
      line: 'Your balance is untouched — nothing was taken. Ask The Lab what happened, then request again.',
    };
  }
  if (available < 0) {
    return {
      key: 'negative', tone: 'rose', icon: ShieldAlert,
      title: 'Fines have taken your balance below zero',
      value: formatCurrency(available),
      line: 'Settle your overdue orders and every box you sell from here builds the balance back up.',
    };
  }
  if (earned <= 0 && available <= 0) {
    return {
      key: 'none', tone: 'brand', icon: Coins,
      title: 'Nothing to withdraw yet',
      value: formatCurrency(0),
      line: `Every box you settle earns commission. The first ${formatCurrency(min)} unlocks a withdrawal.`,
    };
  }
  if (available < min) {
    return {
      key: 'below', tone: 'brand', icon: Sparkles,
      title: 'Building towards your next withdrawal',
      value: formatCurrency(available),
      line: `${formatCurrency(min - available)} to go before you can request one. Earned on ${earnedOn(commission)}.`,
    };
  }
  return {
    key: 'ready', tone: 'emerald', icon: Coins,
    title: `Ready when you are${who}`,
    value: formatCurrency(available),
    line: `You have passed the ${formatCurrency(min)} minimum. Earned on ${earnedOn(commission)}.`,
  };
}

// One tinted card in the house language: glow, icon chip, the figure, and a
// plain sentence under it. No exclamation marks and no confetti — he asked for
// nice, not loud.
export default function WithdrawalNote({ commission, latest, firstName, audience = 'rep', className, children }) {
  const s = withdrawalState({ commission, latest, firstName, audience });
  const t = TONE[s.tone];
  const Icon = s.icon;
  return (
    <div className={clsx('relative overflow-hidden rounded-2xl bg-surface p-4 ring-1', t.ring, className)}>
      <div className={clsx('pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent', t.glow)} aria-hidden="true" />
      <div className="relative flex items-start gap-3">
        <span className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', t.chip)}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground">{s.title}</p>
          <p className={clsx('mt-0.5 text-2xl font-bold leading-none tabular-nums', t.value)}>{s.value}</p>
          <p className="mt-1.5 text-[11px] leading-snug text-faint">{s.line}</p>
          {children && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </div>
  );
}

// The last few requests, newest first — the history behind the note above.
// Used on the rep's own page and on the admin's view of that rep, so a
// conversation about a payout is had over one list, not two.
export function PayoutHistory({ items = [], empty = 'No withdrawals yet' }) {
  if (!items.length) return <p className="text-xs text-faint">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((w) => (
        <li key={w.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-elevated px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold tabular-nums text-foreground">{formatCurrency(w.amount)}</p>
            <p className="text-[11px] text-faint">
              {w.status === 'PAID' && w.paidAt
                ? `Paid ${formatDateTime(w.paidAt)}`
                : `Requested ${formatDateTime(w.requestedAt)}`}
            </p>
          </div>
          <Badge className={WITHDRAWAL_STATUS_META[w.status]?.cls}>{WITHDRAWAL_STATUS_META[w.status]?.label}</Badge>
        </li>
      ))}
    </ul>
  );
}
