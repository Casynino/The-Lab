import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Plus, UserCog, AlertTriangle, Search, X, ArrowUpDown } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { pageQueries, keepOnPageTurn } from '@/lib/pageQueries';
import { formatCurrency, formatNumber, formatDate, fromNow, initials } from '@/lib/format';
import RegionPicker from '@/components/RegionPicker';
import { repRegions } from '@/lib/repRegions';
import { useAuth } from '@/context/AuthContext';
import { ROLES } from '@/lib/constants';
import {
  PageHeader, Card, PageSpinner, EmptyState, LoadError, Button, Modal, Field, Select, NumberInput, Pagination, Input,
} from '@/components/ui';

// A readable password the owner can read out or send: no 0/O, 1/l/I, 10 characters.
function makePassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const buf = new Uint32Array(10);
  (globalThis.crypto || window.crypto).getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join('');
}

// Adding a rep is one step (Nino, 11 Nov 2026: "I should just be able to add a rep here, no need to go and add a
// user first"). "New person" makes his sign-in account and his rep profile in ONE request — POST /users with the
// SALES_REP role creates both together on the server (one write) — and then shows the sign-in details to give him.
// "Existing account" is the old path, for a Sales-rep login that has no rep profile yet.
function RepModal({ onClose }) {
  const qc = useQueryClient();
  const { data: users = [] } = useQuery({ queryKey: ['users', 'all'], queryFn: async () => unwrap(await api.get('/users', { params: { limit: 200 } })).data });
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: async () => unwrap(await api.get('/roles')).data });
  const repRole = roles.find((r) => r.name === ROLES.SALES_REP);
  // Only Sales rep accounts: the server refuses any other role (an admin made a rep kept admin powers).
  const candidates = users.filter((u) => u.role?.name === 'SALES_REP' && !u.salesRep);

  const [mode, setMode] = useState('new'); // 'new' | 'existing'
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [userId, setUserId] = useState('');
  const [regions, setRegions] = useState([]);
  const [monthlyTarget, setMonthlyTarget] = useState('');
  const [done, setDone] = useState(null); // { name, code, email, password }

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const takenEmail = emailOk && users.some((u) => (u.email || '').toLowerCase() === email.trim().toLowerCase());
  const target = monthlyTarget ? Number(monthlyTarget) : null;
  const validNew = name.trim().length >= 2 && phone.trim().length >= 9 && emailOk && !takenEmail && password.length >= 8 && !!repRole;
  const valid = mode === 'new' ? validNew : !!userId;

  const create = useMutation({
    mutationFn: async () => {
      if (mode === 'existing') return api.post('/sales-reps', { userId, regions, monthlyTarget: target });
      return api.post('/users', {
        name: name.trim(), email: email.trim().toLowerCase(), password, phone: phone.trim(), roleId: repRole.id,
        salesRep: { regions, phone: phone.trim(), monthlyTarget: target },
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['sales-reps'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      if (mode === 'existing') { toast.success('Sales rep created'); onClose(); return; }
      const u = unwrap(res)?.data || unwrap(res);
      setDone({ name: name.trim(), code: u?.salesRep?.code || '', email: email.trim().toLowerCase(), password });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (done) {
    const text = `ZELab sign-in\nName: ${done.name}${done.code ? ` (${done.code})` : ''}\nEmail: ${done.email}\nPassword: ${done.password}\nOpen www.zelab.site on your phone and sign in.`;
    return (
      <Modal open onClose={onClose} title="Rep added"
        footer={<>
          <Button variant="secondary" onClick={() => { navigator.clipboard?.writeText(text).then(() => toast.success('Copied')).catch(() => {}); }}>Copy sign-in details</Button>
          <Button onClick={onClose}>Done</Button>
        </>}>
        <div className="space-y-3">
          <p className="text-sm text-muted"><b className="text-foreground">{done.name}</b>{done.code ? ` · ${done.code}` : ''} can sign in now. Give him these details — he can change the password on his Profile.</p>
          <dl className="space-y-2 rounded-2xl bg-white/[0.04] p-4 text-sm ring-1 ring-inset ring-white/[0.08]">
            <div className="flex justify-between gap-3"><dt className="text-muted">Email</dt><dd className="break-all text-right font-medium text-foreground">{done.email}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Password</dt><dd className="font-mono text-right font-semibold tracking-wide text-foreground">{done.password}</dd></div>
          </dl>
          <p className="text-[11px] text-faint">Reps sign in on a phone only.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="New sales representative"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={create.isPending} disabled={!valid || create.isPending} onClick={() => create.mutate()}>Add rep</Button></>}>
      <div className="space-y-4">
        {candidates.length > 0 && (
          <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Who is the rep">
            {[['new', 'New person'], ['existing', `Existing account (${candidates.length})`]].map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                className={clsx('h-10 rounded-xl text-sm font-medium ring-1 ring-inset transition', mode === k ? 'bg-white/[0.08] text-foreground ring-white/20' : 'text-muted ring-white/[0.08] hover:text-foreground')}>
                {label}
              </button>
            ))}
          </div>
        )}

        {mode === 'new' ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Full name" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Juma Hamisi" autoFocus autoComplete="off" />
              </Field>
              <Field label="Phone" required hint="His WhatsApp number">
                <Input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" autoComplete="off" />
              </Field>
            </div>
            <Field label="Sign-in email" required error={takenEmail ? 'Another account already uses this email' : undefined}>
              <Input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="juma@zelab.site" autoComplete="off" autoCapitalize="none" />
            </Field>
            <Field label="Password" required hint={password && password.length < 8 ? 'At least 8 characters' : 'He can change it later on his Profile'}>
              <div className="flex gap-2">
                <Input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className="min-w-0 flex-1" />
                <Button type="button" variant="secondary" className="shrink-0 px-3 text-xs" onClick={() => { setPassword(makePassword()); setShowPw(true); }}>Make one</Button>
              </div>
            </Field>
          </>
        ) : (
          <Field label="User account" required hint="A Sales-rep login that has no rep profile yet">
            <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Select user…</option>
              {candidates.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}
            </Select>
          </Field>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Region(s)" hint="One or more — the first is the main region; none means Dar es Salaam">
            <RegionPicker value={regions} onChange={setRegions} />
          </Field>
          <Field label="Monthly target (optional)"><NumberInput min="0" value={monthlyTarget} onChange={(e) => setMonthlyTarget(e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  );
}

// One colour per rep, fixed by their code so a face keeps its colour wherever
// the list moves it. It lives on the rep's initials, not on the whole card.
const HUES = [
  'bg-teal-400/15 text-teal-200 ring-teal-400/30',
  'bg-violet-400/15 text-violet-200 ring-violet-400/30',
  'bg-sky-400/15 text-sky-200 ring-sky-400/30',
  'bg-amber-400/15 text-amber-200 ring-amber-400/30',
  'bg-emerald-400/15 text-emerald-200 ring-emerald-400/30',
  // Not rose: red is kept for a late rep, never a rep's own colour.
  'bg-indigo-400/15 text-indigo-200 ring-indigo-400/30',
];
const hueFor = (code) => HUES[[...String(code || '')].reduce((n, c) => n + c.charCodeAt(0), 0) % HUES.length];

// What the row says about a rep, in the order it matters. Late first: that is
// the only line that needs a decision today.
function standingOf(r) {
  if (r.overdueOrders > 0) {
    return {
      key: 'late', rank: 0,
      label: `${formatNumber(r.overdueOrders)} late`,
      detail: `due ${fromNow(r.oldestOverdueAt)}`,
      cls: 'bg-rose-500/15 text-rose-300 ring-rose-500/25',
      dot: 'bg-rose-400',
    };
  }
  if (r.openOrders > 0) {
    return {
      key: 'out', rank: 1,
      label: `${formatNumber(r.openOrders)} running`,
      detail: r.nextDeadlineAt ? `next due ${fromNow(r.nextDeadlineAt)}` : 'inside the window',
      cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/25',
      dot: 'bg-amber-400',
    };
  }
  if (!r.isActive) {
    return { key: 'off', rank: 3, label: 'Not active', detail: 'no stock out', cls: 'bg-white/[0.06] text-faint ring-white/[0.08]', dot: 'bg-white/20' };
  }
  return { key: 'clear', rank: 2, label: 'Settled', detail: 'nothing out',  cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/25', dot: 'bg-emerald-400' };
}

// How often this rep brings the boxes back inside their contract window. It is
// the one number that says whether a rep can be trusted, and unlike a sales
// total it is about the rep rather than about the money.
function gradeOf(r) {
  const settled = Number(r.settledOrders || 0);
  const onTime = Number(r.onTimeOrders || 0);
  if (r.onTimeRate == null || settled <= 0) {
    return { known: false, text: 'text-muted', sub: 'none closed yet' };
  }
  // Rounding must neither flatter nor libel: a rep who was late once can never
  // read 100, and a rep who was on time once can never read 0.
  let pct = Math.round(Number(r.onTimeRate));
  if (pct >= 100 && onTime < settled) pct = 99;
  if (pct <= 0 && onTime > 0) pct = 1;
  pct = Math.min(100, Math.max(0, pct));
  return {
    known: true,
    pct,
    text: pct >= 90 ? 'text-emerald-300' : pct >= 70 ? 'text-amber-300' : 'text-rose-300',
    // Always the sample size, never the percentage twice. 100% of two orders
    // and 100% of forty are not the same claim.
    sub: `of ${formatNumber(settled)} closed`,
  };
}

const owedOf = (r) => Math.max(0, Number(r.commissionOwed || 0));
const nameOf = (r) => String(r.user?.name || r.code || '');
const byName = (a, b) => nameOf(a).localeCompare(nameOf(b));

// The four groups a rep can be in — the same four the card's chip names, so
// the counts on the chips always add up to All.
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'late', label: 'Late' },
  { key: 'out', label: 'Running' },
  { key: 'clear', label: 'Settled' },
  { key: 'off', label: 'Inactive' },
];
const NONE_IN = {
  late: 'Nobody is late — every order is inside its window.',
  out: 'No rep has an order running right now.',
  clear: 'Every rep has stock out at the moment.',
  off: 'Every rep is active.',
};

// Bonus progress toward the next tier; a rep past every tier comes first, a rep
// with no bonus run last.
const bonusRank = (b) => (!b ? -1 : b.next ? Number(b.next.progress) || 0 : 101);

const SORTS = [
  // The page's own order since it was built: late first, then whoever is
  // holding the most of your stock.
  { key: 'attention', label: 'Late first', cmp: (a, b) => a.st.rank - b.st.rank || Number(b.r.heldUnits || 0) - Number(a.r.heldUnits || 0) || byName(a.r, b.r) },
  { key: 'boxes', label: 'Most boxes', cmp: (a, b) => Number(b.r.heldUnits || 0) - Number(a.r.heldUnits || 0) || byName(a.r, b.r) },
  { key: 'owed', label: 'Most owed', cmp: (a, b) => owedOf(b.r) - owedOf(a.r) || byName(a.r, b.r) },
  // Worst first: the reps to talk to. A rep with nothing closed has no rate and goes last.
  { key: 'ontime', label: 'Lowest on time', cmp: (a, b) => (a.g.known ? a.g.pct : 101) - (b.g.known ? b.g.pct : 101) || byName(a.r, b.r) },
  { key: 'bonus', label: 'Closest to bonus', bonus: true, cmp: (a, b) => bonusRank(b.b) - bonusRank(a.b) || Number(b.b?.sales || 0) - Number(a.b?.sales || 0) || byName(a.r, b.r) },
  { key: 'name', label: 'Name A–Z', cmp: (a, b) => byName(a.r, b.r) },
];

const clampPct = (n) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));

// The sales bonus as a bar with a notch per tier, drawn against the TOP tier so
// it only ever rises (the Commissions cards draw it the same way). The caption
// leads with the server's own % to the NEXT tier, the figure Commissions shows,
// so the two pages never give two answers — and that tier's notch is drawn in
// the same sky blue as the %, so the eye knows which notch the % is about.
function BonusTrack({ b, active }) {
  if (!b) {
    return (
      <p className="mt-2 text-[10.5px] leading-4 text-faint">
        {active ? 'Sales bonus figures not ready yet' : 'Sales bonus not counted while inactive'}
      </p>
    );
  }
  const tiers = b.tiers || [];
  const top = tiers.reduce((m, t) => Math.max(m, Number(t.target) || 0), 0);
  const pct = top > 0 ? clampPct((Number(b.sales) / top) * 100) : 0;
  const won = b.claimable;
  const next = b.next;
  const none = !(Number(b.sales) > 0);
  // Every figure is on hover; the card itself keeps one line: the bar and where the rep is on it.
  const detail = [
    `Sold ${formatCurrency(b.sales)}${top > 0 ? ` of ${formatCurrency(top)} (top tier)` : ''}`,
    won ? `${formatCurrency(won.bonusAmount)} earned` : null,
    next ? `${next.progress}% · ${formatCurrency(next.remaining)} more → ${formatCurrency(next.bonusAmount)}` : 'every tier reached',
  ].filter(Boolean).join(' · ');
  return (
    <div className="mt-2 flex items-center gap-2" title={detail} aria-label={`Sales bonus: ${detail}`} role="img">
      <span className="shrink-0 text-[10.5px] text-faint">Bonus</span>
      <div className="relative min-w-0 flex-1">
        <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]">
          <div className={clsx('h-full rounded-full transition-[width] duration-700 ease-out', won ? 'bg-emerald-400' : 'bg-sky-400/80')} style={{ width: `${pct}%` }} />
        </div>
        {top > 0 && tiers.map((t) => {
          const isNext = next && t.ruleId === next.ruleId;
          return (
            <span key={t.ruleId}
              className={clsx('absolute top-1/2 w-[2px] -translate-y-1/2 rounded-full', t.reached ? 'h-2 bg-emerald-200' : isNext ? 'h-2.5 bg-sky-300' : 'h-2 bg-white/35')}
              style={{ left: `calc(${Math.min(100, ((Number(t.target) || 0) / top) * 100)}% - 1px)` }} />
          );
        })}
      </div>
      <span className="shrink-0 whitespace-nowrap text-[10.5px] tabular-nums">
        {won && <span className="font-semibold text-emerald-300">{formatCurrency(won.bonusAmount, { compact: true })} won · </span>}
        {next ? (
          none ? <span className="text-faint">no sales yet</span> : (
            <>
              <span className="font-semibold text-sky-300">{next.progress}%</span>
              <span className="text-faint"> · {formatCurrency(next.remaining, { compact: true })} to go</span>
            </>
          )
        ) : <span className="text-emerald-300/80">all tiers</span>}
      </span>
    </div>
  );
}

// A card is a glance, not a report: who, where they stand, how they grade, what they are carrying, what they
// are owed and how far the bonus is — in four short lines, so forty reps still fit on a screen or two. The rest
// is a click away on their own page.
function RepCard({ r, st, g, b, showBonus, i, onOpen }) {
  const regions = repRegions(r);
  const owed = owedOf(r);
  const name = r.user?.name || r.code;
  return (
    <button
      type="button"
      data-rep={r.code}
      data-prefetch={`/reps/${r.id}`}
      onClick={onOpen}
      // A late rep is the one card that needs action, so only that card is tinted.
      data-tone={st.key === 'late' ? 'late' : undefined}
      style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
      className={clsx(
        'stat-glass animate-rise flex flex-col px-3 py-2.5 text-left transition duration-200 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30',
        st.key === 'off' && 'opacity-75',
      )}
    >
      {/* Who, where they stand, and how they grade. */}
      <div className="flex w-full items-center gap-2.5">
        <span className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ring-1 ring-inset', hueFor(r.code))} aria-hidden="true">
          {initials(name) || '?'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-[13.5px] font-semibold leading-5 text-foreground" title={name}>{name}</p>
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 text-[9.5px] font-medium leading-4 ring-1 ${st.cls}`}>
              {st.key === 'late'
                ? <AlertTriangle className="h-2.5 w-2.5" />
                : <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />}
              {st.label}
            </span>
          </div>
          <p className="truncate text-[10.5px] leading-4 text-faint" title={`${r.code}${regions.length ? ` · ${regions.join(', ')}` : ''}`}>
            {r.code}{regions.length ? ` · ${regions.join(', ')}` : ''}
            {/* A rep switched off while still holding stock sits under Late or Running; say so here. */}
            {!r.isActive && st.key !== 'off' && <span className="text-white/60"> · not active</span>}
          </p>
        </div>
        <div className="shrink-0 text-right" title={g.known ? `On time ${g.pct}% ${g.sub}` : g.sub}>
          {g.known ? (
            <>
              <div className={`text-[17px] font-bold leading-5 tabular-nums ${g.text}`}>{g.pct}<span className="text-[11px] font-semibold">%</span></div>
              <div className="whitespace-nowrap text-[10px] leading-4 text-faint">{g.sub}</div>
            </>
          ) : <span className="whitespace-nowrap text-[10px] leading-4 text-faint">{g.sub}</span>}
        </div>
      </div>

      {/* What they are holding and what they are owed, on one line. mt-auto keeps a row of cards level. */}
      <div className="mt-auto w-full">
        <div className="mt-2 flex w-full items-baseline justify-between gap-3 border-t border-white/[0.06] pt-2">
          <div className="min-w-0 truncate text-[11px] leading-4" title={`${formatNumber(r.heldUnits || 0)} boxes · ${st.detail}`}>
            <span className={`text-[14px] font-bold tabular-nums ${r.heldUnits > 0 ? 'text-foreground' : 'text-muted'}`}>{formatNumber(r.heldUnits || 0)}</span>
            <span className="text-faint"> boxes · </span>
            <span className={st.key === 'late' ? 'text-rose-300/90' : 'text-faint'}>{st.detail}</span>
          </div>
          <div className="shrink-0 whitespace-nowrap text-right leading-4" title={r.commissionOwed > 0 ? 'Commission owed' : 'Nothing owed'}>
            <span className={`text-[14px] font-bold tabular-nums ${r.commissionOwed > 0 ? 'text-amber-300' : 'text-muted'}`}>{formatCurrency(owed)}</span>
            <span className="text-[10.5px] text-faint"> owed</span>
          </div>
        </div>

        {showBonus && <BonusTrack b={b} active={r.isActive} />}
      </div>
    </button>
  );
}

export default function SalesReps() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  // Making someone a rep is the owner's (the server refuses staff, and its account list is owner-only).
  const isAdmin = useAuth().user?.role === ROLES.ADMIN;

  // Search, group and order live in the address, so Back from a rep's page
  // returns to the same list.
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const show = FILTERS.some((f) => f.key === params.get('show')) ? params.get('show') : 'all';
  const setParam = (key, value, fallback) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (!value || value === fallback) n.delete(key); else n.set(key, value);
    return n;
  }, { replace: true });

  const { data, isLoading, isError, refetch } = useQuery({
    ...pageQueries.salesReps({ page }),
    placeholderData: keepOnPageTurn(),
  });

  // The sales bonus run, read from the same endpoint and cache key as the
  // Commissions page. Owner and warehouse staff may read it (the same roles
  // this page is open to); if it ever fails, the bonus part simply is not drawn.
  const bonusQ = useQuery(pageQueries.bonusSummary());
  const bonusFor = new Map((bonusQ.isError ? [] : bonusQ.data?.items || []).filter((b) => b.configured).map((b) => [b.salesRepId, b]));
  const showBonus = bonusFor.size > 0;
  const starts = [...bonusFor.values()].map((b) => new Date(b.cycleStart).getTime()).filter(Number.isFinite);
  const sharedStart = starts.length && starts.every((t) => t === starts[0]) ? starts[0] : null;

  const sortKey = SORTS.some((s) => s.key === params.get('sort') && (!s.bonus || showBonus)) ? params.get('sort') : 'attention';
  const sort = SORTS.find((s) => s.key === sortKey);

  const rows = (data?.data || []).map((r) => ({ r, st: standingOf(r), g: gradeOf(r), b: bonusFor.get(r.id) || null }));
  const reps = rows.map((x) => x.r);
  const counts = rows.reduce((c, x) => ({ ...c, [x.st.key]: (c[x.st.key] || 0) + 1 }), { all: rows.length });

  const needle = q.trim().toLowerCase();
  const shown = rows
    .filter((x) => show === 'all' || x.st.key === show)
    .filter((x) => !needle || [nameOf(x.r), x.r.code, ...repRegions(x.r), x.r.isActive ? '' : 'inactive'].some((v) => String(v || '').toLowerCase().includes(needle)))
    .sort(sort.cmp);
  const narrowed = show !== 'all' || !!needle;
  // The list asks for 100 reps a page; past that, search and the chip counts
  // only see the page on screen, and the page says so.
  const partial = data?.meta?.totalPages > 1;
  const clearAll = () => setParams((p) => { const n = new URLSearchParams(p); n.delete('q'); n.delete('show'); return n; }, { replace: true });

  const t = reps.reduce((a, r) => ({
    boxes: a.boxes + Number(r.heldUnits || 0),
    value: a.value + Number(r.heldStockValue || 0),
    owed: a.owed + owedOf(r),
    late: a.late + Number(r.overdueOrders || 0),
    lateReps: a.lateReps + (r.overdueOrders > 0 ? 1 : 0),
    settled: a.settled + Number(r.settledOrders || 0),
    onTime: a.onTime + Number(r.onTimeOrders || 0),
  }), { boxes: 0, value: 0, owed: 0, late: 0, lateReps: 0, settled: 0, onTime: 0 });

  // Every closed order belongs to exactly one rep, so summing the reps gives
  // the team's true rate — no second query needed.
  // The same guards gradeOf applies per rep: without them 199 on time of 200
  // rounds to a clean 100% here while a card below it correctly reads 99%.
  const teamRate = (() => {
    if (t.settled <= 0) return null;
    let pct = Math.round((t.onTime / t.settled) * 100);
    if (pct >= 100 && t.onTime < t.settled) pct = 99;
    if (pct <= 0 && t.onTime > 0) pct = 1;
    return Math.min(100, Math.max(0, pct));
  })();
  const rateTone = (p) => (p >= 90 ? 'text-emerald-300' : p >= 70 ? 'text-amber-300' : 'text-rose-300');

  const strip = [
    { label: 'Boxes out with reps', value: formatNumber(t.boxes), sub: `${formatCurrency(t.value)} of stock`, num: 'text-violet-300', dot: 'bg-violet-400' },
    { label: 'Running late', value: formatNumber(t.late), sub: t.late > 0 ? `${formatNumber(t.lateReps)} rep${t.lateReps === 1 ? '' : 's'} past deadline` : 'everyone inside the window', num: t.late > 0 ? 'text-rose-300' : 'text-foreground', dot: t.late > 0 ? 'bg-rose-400' : 'bg-white/25' },
    { label: 'Commission owed', value: formatCurrency(t.owed), sub: 'earned, not yet withdrawn', num: t.owed > 0 ? 'text-amber-300' : 'text-foreground', dot: 'bg-amber-400' },
    { label: 'Settled on time', value: teamRate == null ? '—' : `${teamRate}%`, sub: teamRate == null ? 'no orders closed yet' : `of ${formatNumber(t.settled)} orders closed`, num: teamRate == null ? 'text-foreground' : rateTone(teamRate), dot: 'bg-emerald-400', bar: teamRate },
  ];
  // Hairlines between the four: a 2 × 2 block on a phone, one row from sm.
  const cellLines = ['', 'border-l', 'border-t sm:border-l sm:border-t-0', 'border-l border-t sm:border-t-0'];

  return (
    <div>
      <PageHeader title="Sales Representatives" subtitle="Who is holding your stock, and who is late with it.">
        {isAdmin && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New rep</Button>}
      </PageHeader>

      {reps.length > 0 && (
        <div className="glass-list mb-4">
          <dl className="grid grid-cols-2 sm:grid-cols-4">
            {strip.map((c, n) => (
              <div key={c.label} data-strip={c.label} className={clsx('min-w-0 border-white/[0.06] px-3.5 py-3 sm:p-4', cellLines[n])}>
                <dt className="flex items-center gap-1.5 truncate text-[11px] font-medium text-white/55">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.dot}`} aria-hidden="true" />
                  {c.label}
                </dt>
                {/* The on-time bar sits beside its figure, so all four captions share one line. */}
                <dd className={`mt-1.5 flex items-center gap-2.5 whitespace-nowrap text-lg font-bold leading-none tabular-nums sm:text-xl ${c.num}`}>
                  {c.value}
                  {c.bar != null && (
                    <span className="h-1 w-10 shrink overflow-hidden rounded-full bg-white/[0.07] sm:w-16" aria-hidden="true">
                      <span className={clsx('block h-full rounded-full', c.bar >= 90 ? 'bg-emerald-400' : c.bar >= 70 ? 'bg-amber-400' : 'bg-rose-400')} style={{ width: `${c.bar}%` }} />
                    </span>
                  )}
                </dd>
                <dd className="mt-1.5 text-[11px] leading-snug text-white/50">{c.sub}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {isLoading ? (
        <Card><PageSpinner /></Card>
      ) : isError ? (
        <Card><LoadError what="the reps" onRetry={refetch} /></Card>
      ) : !reps.length ? (
        <Card><EmptyState title="No sales reps" icon={UserCog} action={isAdmin && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New rep</Button>} /></Card>
      ) : (
        <>
          {/* Find a rep: the group chips (counts always add up to All), a search, an order. */}
          <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            {/* Wraps to two lines on a phone rather than hiding a chip off the edge. */}
            <div role="group" aria-label="Show reps" className="-mx-1 flex flex-wrap gap-1.5 px-1 py-0.5 sm:flex-nowrap sm:overflow-x-auto sm:[scrollbar-width:none]">
              {FILTERS.filter((f) => f.key !== 'off' || counts.off > 0 || show === 'off').map((f) => {
                const on = show === f.key;
                const n = counts[f.key] || 0;
                return (
                  <button
                    key={f.key}
                    type="button"
                    data-filter={f.key}
                    aria-pressed={on}
                    onClick={() => setParam('show', f.key, 'all')}
                    className={clsx(
                      'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold ring-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30',
                      on ? 'bg-white/[0.12] text-foreground ring-white/20' : 'text-muted ring-white/10 hover:bg-white/[0.05] hover:text-foreground',
                    )}
                  >
                    {f.label}
                    <span className={clsx('tabular-nums', f.key === 'late' && n > 0 ? 'text-rose-300' : n > 0 ? 'text-white/60' : 'text-white/30')}>{formatNumber(n)}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1 lg:w-64 lg:flex-none">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden="true" />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setParam('q', e.target.value, '')}
                  onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.preventDefault(); setParam('q', '', ''); } }}
                  placeholder="Name, code, region"
                  aria-label="Search reps by name, code or region"
                  className={clsx('input h-9 py-0 pl-9 sm:py-0 [&::-webkit-search-cancel-button]:appearance-none', q ? 'pr-9' : 'pr-3')}
                />
                {q && (
                  <button type="button" onClick={() => setParam('q', '', '')} aria-label="Clear search"
                    className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-faint transition hover:bg-white/[0.08] hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="relative w-[9.5rem] shrink-0 sm:w-40">
                <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" aria-hidden="true" />
                <Select data-sort value={sortKey} onChange={(e) => setParam('sort', e.target.value, 'attention')} aria-label="Order reps by" title="Order reps by" className="h-9 py-0 pl-8 sm:py-0">
                  {SORTS.filter((s) => !s.bonus || showBonus).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </Select>
              </div>
            </div>
          </div>

          {/* One quiet line: what is on screen, and where the bonus figures run from. */}
          {((narrowed && shown.length > 0) || partial || showBonus) && (
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1 text-[11px] leading-4">
              {narrowed && shown.length > 0 ? (
                <p className="text-muted" aria-live="polite">
                  Showing {formatNumber(shown.length)} of {formatNumber(rows.length)} reps{partial ? ' on this page' : ''}
                  <button type="button" onClick={clearAll} className="ml-2 font-semibold text-foreground/80 underline-offset-2 hover:underline">Show all</button>
                </p>
              ) : partial ? (
                <p className="text-muted">Search and counts cover this page — {formatNumber(rows.length)} of {formatNumber(data.meta?.total)} reps</p>
              ) : <span />}
              {showBonus && (
                <p className="text-faint">
                  <span className="whitespace-nowrap">Sales bonus from {sharedStart ? formatDate(new Date(sharedStart)) : 'each rep’s own start'}</span>
                  {' · '}<span className="whitespace-nowrap">paid on Commissions</span>
                </p>
              )}
            </div>
          )}

          {!shown.length ? (
            <div className="glass-list px-4 py-10 text-center" aria-live="polite">
              <p className="text-sm font-semibold text-foreground">
                {needle ? <>No rep matches “{q.trim()}”</> : NONE_IN[show]}
              </p>
              {needle && show !== 'all' && <p className="mt-1 text-xs text-muted">among the {FILTERS.find((f) => f.key === show)?.label.toLowerCase()} reps</p>}
              {needle && partial && <p className="mt-1 text-xs text-muted">Only this page of {formatNumber(rows.length)} reps was searched — try the next page.</p>}
              <button type="button" onClick={clearAll}
                className="mt-4 rounded-full px-3.5 py-1.5 text-xs font-semibold text-foreground ring-1 ring-white/15 transition hover:bg-white/[0.06]">
                Show all reps
              </button>
            </div>
          ) : (
            // One on a phone, two on a tablet, three on a small laptop, four at 1440, five on a big
            // screen. Names wrap and amounts widen their half rather than being cut.
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3 min-[1400px]:grid-cols-4 min-[1800px]:grid-cols-5">
              {shown.map((x, i) => (
                <RepCard key={x.r.id} r={x.r} st={x.st} g={x.g} b={x.b} showBonus={showBonus} i={i} onOpen={() => navigate(`/reps/${x.r.id}`)} />
              ))}
            </div>
          )}

          {data.meta?.totalPages > 1 && (
            <div className="mt-4">
              <Pagination page={page} totalPages={data.meta?.totalPages} total={data.meta?.total} onChange={setPage} />
            </div>
          )}
        </>
      )}
      {open && <RepModal onClose={() => setOpen(false)} />}
    </div>
  );
}
