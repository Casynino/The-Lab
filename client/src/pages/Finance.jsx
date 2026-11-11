import { STEADY } from '@/lib/polling';
import { useState, useRef, useEffect, useMemo } from 'react';
import ReportsArchive from '@/components/ReportsArchive';
import ProductPicker, { MoreToggle, DiscardFooter } from '@/components/ProductPicker';
import { pickerRows, lineCost, primaryWarehouse, shortPlace, buttonPlace } from '@/lib/stockPick';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Wallet, TrendingDown, Banknote, Landmark, Smartphone, Coins,
  Plus, Trash2, Pencil, ArrowLeftRight, ArrowDownLeft, ArrowUpRight, Boxes, Receipt,
  Factory, Package, Scale, FileBarChart, ChevronRight, ShieldCheck, AlertTriangle, Search as SearchIcon,
  Undo2, CheckCircle2, Eye, EyeOff,
} from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { useProducts, useBrands, useWarehouses } from '@/lib/hooks';
import { useAuth } from '@/context/AuthContext';
import { ROLES } from '@/lib/constants';
import ReportsPage from '@/pages/Reports';
import CommissionsPage from '@/pages/Commissions';
import clsx from 'clsx';
import { formatCurrency, formatNumber, formatDate, formatDateTime, sharePercents } from '@/lib/format';
import { eatISODate, eatDay } from '@/lib/tz';
import { DonutChart, BarChartCard, TrendChart, BarsWithLine } from '@/components/charts';
import {
  PageHeader, Card, PageSpinner, EmptyState, Badge, Button,
  Modal, Field, Input, NumberInput, Select, Textarea, Table, THead, TBody, TR, TH, TD, Pagination,
} from '@/components/ui';

const PERIODS = [['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['all', 'All time']];
const ACCOUNT_ICON = { CASH: Banknote, BANK: Landmark, MOBILE_MONEY: Smartphone, OTHER: Wallet, COMMISSION: Coins };
// The Commission account is a RECORD of what the owner paid reps from his own
// pocket, not a wallet: no money is in it, so it is never somewhere you can pay
// from, deposit to, or transfer through. Everywhere money is picked, pick from
// wallets. The server flags it — the client never matches on a name.
const wallets = (list) => list.filter((a) => !a.isCommissionRecord);
// Each account keeps one colour everywhere on the tab — bar, dot and card.
const ACCOUNT_BAR = ['bg-emerald-500', 'bg-violet-500', 'bg-sky-500', 'bg-amber-500'];
const ACCOUNT_DOT = ['bg-emerald-400', 'bg-violet-400', 'bg-sky-400', 'bg-amber-400'];
const ACCOUNT_TINT = [
  { ring: 'ring-emerald-500/25', glow: 'from-emerald-500/[0.10]', chip: 'bg-emerald-500/15 text-emerald-300' },
  { ring: 'ring-violet-500/25', glow: 'from-violet-500/[0.10]', chip: 'bg-violet-500/15 text-violet-300' },
  { ring: 'ring-sky-500/25', glow: 'from-sky-500/[0.10]', chip: 'bg-sky-500/15 text-sky-300' },
  { ring: 'ring-amber-500/25', glow: 'from-amber-500/[0.10]', chip: 'bg-amber-500/15 text-amber-300' },
];
const TXN_TYPE_LABEL = {
  SETTLEMENT: 'Settlement received', WAREHOUSE_SALE: 'Warehouse sale', INCOME: 'Income',
  EXPENSE: 'Expense', STOCK_PURCHASE: 'Stock purchase', COMMISSION_PAYMENT: 'Commission paid',
  TRANSFER: 'Transfer', ADJUSTMENT: 'Adjustment',
  // the owner's own money, in the words of the Overview buttons ("Put my money in" / "Take profit out")
  OWNER_CONTRIBUTION: 'Your money in', OWNER_DRAWING: 'Profit taken out',
};

// One tinted stat card — the ring/glow/chip language the Inventory and
// Settlements pages settled on. Finance was the last page still on the old
// flat cards.
const TINT = {
  brand: { ring: 'ring-brand-500/25', glow: 'from-brand-500/[0.12]', chip: 'bg-brand-500/15 text-brand-600', num: 'text-brand-600' },
  emerald: { ring: 'ring-emerald-500/25', glow: 'from-emerald-500/[0.12]', chip: 'bg-emerald-500/15 text-emerald-300', num: 'text-emerald-300' },
  rose: { ring: 'ring-rose-500/30', glow: 'from-rose-500/[0.14]', chip: 'bg-rose-500/15 text-rose-300', num: 'text-rose-300' },
  amber: { ring: 'ring-amber-500/30', glow: 'from-amber-500/[0.14]', chip: 'bg-amber-500/15 text-amber-300', num: 'text-amber-300' },
  violet: { ring: 'ring-violet-500/25', glow: 'from-violet-500/[0.14]', chip: 'bg-violet-500/15 text-violet-300', num: 'text-violet-300' },
  sky: { ring: 'ring-sky-500/25', glow: 'from-sky-500/[0.12]', chip: 'bg-sky-500/15 text-sky-300', num: 'text-sky-300' },
  slate: { ring: 'ring-white/[0.08]', glow: 'from-white/[0.03]', chip: 'bg-white/10 text-muted', num: 'text-foreground' },
};
function TintCard({ label, value, icon: Icon, sub, tone = 'brand' }) {
  const t = TINT[tone] || TINT.brand;
  return (
    <div className="stat-glass p-4">
      <div className="relative flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        {Icon && <span className={`rounded-full p-1.5 ring-1 ring-inset ring-white/10 ${t.chip}`}><Icon className="h-3.5 w-3.5" /></span>}
      </div>
      <p className={`relative mt-2 text-2xl font-bold tabular-nums ${t.num}`}>{value}</p>
      {sub && <p className="relative mt-0.5 text-[11px] text-faint">{sub}</p>}
    </div>
  );
}

// One card, several segments — the joined money strip from the admin the
// owner benchmarks against. Not separate boxes: one container, hairline
// dividers, numbers a size up. The rep side's mix (Nino, 11 Nov 2026: "not every place needs red"):
// the strip is neutral glass and each segment's colour lives on its number, not on a wash behind it.
const SEG_WASH = {
  emerald: { num: 'text-emerald-400' },
  rose: { num: 'text-rose-400' },
  sky: { num: 'text-sky-300' },
  brand: { num: 'text-brand-600' },
  amber: { num: 'text-amber-300' },
  violet: { num: 'text-violet-300' },
  slate: { num: 'text-foreground' },
};
// Nino, 11 Nov 2026: "nice but too big — follow the new design": numbers a size smaller, plain-case labels.
function SegmentStrip({ segments, size = 'lg' }) {
  const numCls = size === 'lg' ? 'text-xl xl:text-2xl' : 'text-lg';
  return (
    <div className="stat-glass grid grid-cols-2 sm:flex sm:divide-x sm:divide-white/[0.08]">
      {segments.map((seg) => {
        const w = SEG_WASH[seg.tone] || SEG_WASH.slate;
        return (
          <div key={seg.label} className="flex-1 px-4 py-3.5">
            <p className="text-[11px] font-medium text-white/55">{seg.label}</p>
            <p className={`mt-1.5 font-bold leading-none tabular-nums ${numCls} ${w.num}`}>{seg.value}</p>
            {seg.sub && <p className="mt-1 text-[11px] text-faint">{seg.sub}</p>}
          </div>
        );
      })}
    </div>
  );
}

// Dark-theme badge tints. These were light-theme chips glowing on a dark page.
const DIR_BADGE = { IN: 'bg-emerald-500/15 text-emerald-300', OUT: 'bg-rose-500/15 text-rose-300' };
const round2ui = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ── A commission payout in the Ledger ────────────────────────────────────────
// "when i pay commission show it on its account name and etc so i can know
// just like other transactions." So it is a full row: the Commission account by
// name, the amount, the rep it went to, the date — nothing blanked, nothing
// hidden. What it must NOT do is read as money leaving a wallet, because none
// did: the owner paid it from his own hand. Rose with a minus sign is the
// house's "gone out of an account"; a payout gets violet, no sign, and a line
// that says whose money it was — the same violet the Commission card uses, so
// the row and the account it sits on are visibly the same story.
const isPayoutRow = (t) => t?.type === 'COMMISSION_PAYMENT';
const PAYOUT_BADGE = 'bg-violet-500/15 text-violet-300';
// What a row says it was. A payout names the rep, because "Commission Payments"
// is a category, not an answer to "who did I pay?".
const ledgerLabel = (t) => (
  isPayoutRow(t) && t.payee
    ? `Commission paid — ${t.payee}`
    : t.category || t.description || t.reference || '—'
);

// Default to All time so the dashboard opens showing the full business history.
function usePeriod() { return useState('all'); }

const invalidateFinance = (qc) => ['finance'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

// ── Modals ───────────────────────────────────────────────────────────────────
// Move money between two business accounts (banked cash, corrections). Posts
// a linked OUT+IN pair that shifts balances without touching profit or the
// income/expense reports.
// Correcting a wallet to what it really holds. The endpoint has existed since
// go-live but had no way in, so the only way to fix a balance was to edit rows
// one at a time — or for someone to write a figure into a migration, which is
// how a correction ends up invisible. You say what the account really holds;
// it records the difference as one adjustment, in the ledger, with your reason
// on it. It never touches profit.
function CorrectBalanceModal({ accounts, onClose }) {
  const qc = useQueryClient();
  const usable = accounts.filter((a) => !a.isCommissionRecord);
  const [accountId, setAccountId] = useState(usable[0]?.id || '');
  const [actual, setActual] = useState('');
  const [reason, setReason] = useState('');
  const account = usable.find((a) => a.id === accountId);
  const shown = Number(account?.balance || 0);
  const truth = actual === '' ? null : Number(actual);
  const delta = truth == null ? 0 : round2ui(truth - shown);

  const save = useMutation({
    mutationFn: () => api.post('/finance/adjustments', {
      accountId,
      direction: delta >= 0 ? 'IN' : 'OUT',
      amount: Math.abs(delta),
      description: reason.trim() || 'Balance corrected to what the account really holds',
      notes: `Corrected from ${formatCurrency(shown)} to ${formatCurrency(truth)}.`,
    }),
    onSuccess: () => { toast.success('Balance corrected'); invalidateFinance(qc); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const valid = accountId && truth != null && Number.isFinite(truth) && delta !== 0;
  return (
    <Modal open onClose={onClose} title="Correct a balance"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>Record the correction</Button></>}>
      <div className="space-y-4">
        <p className="rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-muted">
          For when the app disagrees with the real account. Say what it actually holds and the difference is written
          into the ledger as one adjustment you can see and undo. It does not touch your profit.
        </p>
        <Field label="Which account" required>
          <Select value={accountId} onChange={(e) => { setAccountId(e.target.value); setActual(''); }}>
            {usable.map((a) => <option key={a.id} value={a.id}>{a.name} — {formatCurrency(a.balance)}</option>)}
          </Select>
        </Field>
        <Field label="What it really holds now (TZS)" required hint={`The app currently shows ${formatCurrency(shown)}.`}>
          <NumberInput key={accountId} value={actual} onChange={(e) => setActual(e.target.value)} autoFocus placeholder="0" />
        </Field>
        {valid && (
          <p className="text-xs text-muted">
            This records{' '}
            <b className={delta >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
              {delta >= 0 ? '+' : '−'} {formatCurrency(Math.abs(delta))}
            </b>{' '}
            against {account?.name}, bringing it to <b className="text-foreground">{formatCurrency(truth)}</b>.
          </p>
        )}
        <Field label="Why" hint="Worth a sentence — this is the record of why the figure moved.">
          <Input value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. cash drawn out and paid to reps as commission" />
        </Field>
      </div>
    </Modal>
  );
}

function TransferModal({ accounts: all, onClose }) {
  const accounts = wallets(all);
  const qc = useQueryClient();
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const from = accounts.find((a) => a.id === fromId);

  const save = useMutation({
    mutationFn: () => api.post('/finance/transfers', { fromAccountId: fromId, toAccountId: toId, amount: Number(amount), notes }),
    onSuccess: (res) => {
      const d = unwrap(res).data;
      toast.success(`Moved ${formatCurrency(d.amount)} from ${d.from} to ${d.to}`);
      invalidateFinance(qc);
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const valid = fromId && toId && fromId !== toId && Number(amount) > 0;
  return (
    <Modal open onClose={onClose} title="Transfer between accounts" footer={
      <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>Transfer</Button>
      </>
    }>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="From" required>
            <Select value={fromId} onChange={(e) => setFromId(e.target.value)}>
              <option value="">Select account…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} — {formatCurrency(a.balance)}</option>)}
            </Select>
          </Field>
          <Field label="To" required>
            <Select value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">Select account…</option>
              {accounts.filter((a) => a.id !== fromId).map((a) => <option key={a.id} value={a.id}>{a.name} — {formatCurrency(a.balance)}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Amount" required hint={from ? `${from.name} holds ${formatCurrency(from.balance)}` : undefined}>
          <NumberInput min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Notes" hint="Optional — why the money moved">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Banked the cash drawer into M-Pesa" />
        </Field>
      </div>
    </Modal>
  );
}

function AddAccountModal({ onClose }) {
  const qc = useQueryClient();
  const { data: brands = [] } = useQuery({
    queryKey: ['brands', 'all'],
    queryFn: async () => unwrap(await api.get('/brands', { params: { limit: 50 } })).data,
  });
  const [form, setForm] = useState({ name: '', type: 'BANK', openingBalance: '', notes: '', brandId: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => api.post('/finance/accounts', {
      name: form.name.trim(), type: form.type, openingBalance: Number(form.openingBalance) || 0,
      notes: form.notes.trim() || undefined, brandId: form.brandId || undefined,
    }),
    onSuccess: () => { toast.success('Account created'); invalidateFinance(qc); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="New business account"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>Create account</Button></>}>
      <div className="space-y-4">
        <Field label="Account name" required><Input value={form.name} onChange={set('name')} placeholder="e.g. Equity Bank" /></Field>
        <Field label="Type" hint="The business does not hold money in cash, so there is no cash account to add.">
          <Select value={form.type} onChange={set('type')}><option value="BANK">Bank</option><option value="MOBILE_MONEY">Mobile money</option><option value="OTHER">Other</option></Select>
        </Field>
        <Field label="Reserved for brand" hint="Reps only see this account when settling that brand's products">
          <Select value={form.brandId} onChange={set('brandId')}>
            <option value="">Any brand (general)</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Opening balance (TZS)" hint="What's in this account right now"><NumberInput min="0" value={form.openingBalance} onChange={set('openingBalance')} placeholder="0" /></Field>
        <Field label="Notes"><Textarea rows={2} value={form.notes} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

function MoneyModal({ mode, accounts: all, categories, onClose }) {
  const accounts = wallets(all);
  const qc = useQueryClient();
  const isExpense = mode === 'expense';
  const { data: brands = [] } = useQuery({
    queryKey: ['brands', 'all'],
    queryFn: async () => unwrap(await api.get('/brands', { params: { limit: 50 } })).data,
  });
  const [form, setForm] = useState({
    accountId: accounts.find((a) => a.isDefault)?.id || accounts[0]?.id || '',
    amount: '', category: isExpense ? (categories[0]?.name || '') : '', description: '',
    occurredAt: eatISODate(), notes: '', newCategory: '', brandId: '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: async () => {
      let category = form.category;
      if (isExpense && form.category === '__new' && form.newCategory.trim()) {
        await api.post('/finance/categories', { name: form.newCategory.trim() });
        category = form.newCategory.trim();
      }
      return api.post(isExpense ? '/finance/expenses' : '/finance/income', {
        accountId: form.accountId, amount: Number(form.amount),
        category: category || undefined, description: form.description.trim() || undefined,
        occurredAt: form.occurredAt, notes: form.notes.trim() || undefined,
        brandId: form.brandId || undefined,
      });
    },
    onSuccess: () => { toast.success(isExpense ? 'Expense recorded' : 'Income recorded'); invalidateFinance(qc); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const valid = form.accountId && Number(form.amount) > 0 && (!isExpense || form.category);
  return (
    <Modal open onClose={onClose} title={isExpense ? 'Record expense' : 'Record income'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{isExpense ? 'Save expense' : 'Save income'}</Button></>}>
      <div className="space-y-4">
        <Field label="Amount (TZS)" required><NumberInput min="0" value={form.amount} onChange={set('amount')} autoFocus placeholder="0" /></Field>
        {isExpense && (
          <Field label="Category" required>
            <Select value={form.category} onChange={set('category')}>
              {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              <option value="__new">+ New category…</option>
            </Select>
          </Field>
        )}
        {isExpense && form.category === '__new' && (
          <Field label="New category name" required><Input value={form.newCategory} onChange={set('newCategory')} placeholder="e.g. Repairs" /></Field>
        )}
        {!isExpense && <Field label="Source"><Input value={form.category} onChange={set('category')} placeholder="e.g. Investment, refund" /></Field>}
        <Field label={isExpense ? 'Paid from account' : 'Deposit to account'} required>
          <Select value={form.accountId} onChange={set('accountId')}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} — {formatCurrency(a.balance)}</option>)}
          </Select>
        </Field>
        <Field label={isExpense ? 'Which brand is this coming out of' : 'Which brand is this money behind'}
          hint="Leave blank if it is not for one brand in particular.">
          <Select value={form.brandId} onChange={set('brandId')}>
            <option value="">Not tied to a brand</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Date"><Input type="date" value={form.occurredAt} onChange={set('occurredAt')} /></Field>
        <Field label="Description"><Input value={form.description} onChange={set('description')} placeholder="What was this for?" /></Field>
        <Field label="Notes"><Textarea rows={2} value={form.notes} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

// The owner's own money. Kept apart from trade on purpose: cash he puts in
// is not the business earning, and profit he takes out is not a cost of
// earning it. Both move an account balance and nothing else.
function OwnerMoneyModal({ mode, accounts: all, onClose }) {
  const accounts = wallets(all);
  const qc = useQueryClient();
  const { data: brands = [] } = useBrands();
  const isIn = mode === 'in';
  const [form, setForm] = useState({
    amount: '',
    accountId: accounts.find((a) => a.isDefault)?.id || accounts[0]?.id || '',
    brandId: '',
    occurredAt: eatISODate(),
    description: isIn ? 'Commission paid from my own pocket' : '',
    notes: '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => api.post('/finance/owner-money', {
      direction: isIn ? 'IN' : 'OUT',
      amount: Number(form.amount),
      accountId: form.accountId,
      brandId: form.brandId || undefined,
      occurredAt: form.occurredAt,
      description: form.description.trim() || (isIn ? 'Owner put money in' : 'Owner took profit out'),
      notes: form.notes.trim() || undefined,
    }),
    onSuccess: () => {
      toast.success(isIn ? 'Recorded — your money is in the business' : 'Recorded — profit taken out');
      invalidateFinance(qc);
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const valid = form.accountId && Number(form.amount) > 0;
  return (
    <Modal open onClose={onClose} title={isIn ? 'Put my own money in' : 'Take profit out'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
          {isIn ? 'Record my money in' : 'Record profit taken'}
        </Button></>}>
      <div className="space-y-4">
        <p className="rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-muted">
          {isIn
            ? 'Your personal cash entering the business — paying rep commissions out of your own pocket, or topping up an account. It is not counted as income, so it never inflates profit.'
            : 'Profit you are taking out of the business for yourself. It is not counted as an expense, so it never reduces the profit the business earned.'}
        </p>
        <Field label="Amount (TZS)" required><NumberInput min="0" value={form.amount} onChange={set('amount')} autoFocus placeholder="0" /></Field>
        <Field label={isIn ? 'Into which account' : 'Out of which account'} required>
          <Select value={form.accountId} onChange={set('accountId')}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} — {formatCurrency(a.balance)}</option>)}
          </Select>
        </Field>
        <Field label="Date"><Input type="date" value={form.occurredAt} onChange={set('occurredAt')} /></Field>
        <Field label="What was it for"><Input value={form.description} onChange={set('description')} placeholder={isIn ? 'e.g. commissions for August' : 'e.g. personal drawing'} /></Field>
        <Field label="Notes"><Textarea rows={2} value={form.notes} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────
// Nino, 11 Nov 2026: "good, but the cards and tables feel very big and there is too much wording — show the
// big picture and the money well, in little, nice, well-arranged cards". So: one header strip (the period,
// sales − goods − expenses = earned, the cash ring), a row of small figure tiles, the month chart, tidy
// lists, a compact table, one line per thing waiting, one footnote. The long explanations moved into
// `title` tooltips. Every figure the old Overview showed is still on it.
const ACCOUNT_HEX = ['#10b981', '#8b5cf6', '#0ea5e9', '#f59e0b']; // ACCOUNT_BAR as hex, for the cash donut
const PERIOD_WORDS = { today: 'today', week: 'this week', month: 'this month', all: 'all time' };

// A small glass panel: a one-line title, a short sub-line, and a pill that opens the tab with the detail.
// `aside` puts a figure (a total) where the pill would sit.
function Panel({ title, sub, link, onNavigate, aside, className, children }) {
  return (
    <section className={clsx('stat-glass flex flex-col p-4', className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight text-foreground">{title}</h3>
          {sub && <div className="mt-0.5 text-[11px] text-white/50">{sub}</div>}
        </div>
        {aside}
        {link && (
          <button type="button" onClick={() => onNavigate?.(link.tab)}
            className="shrink-0 cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-medium text-muted ring-1 ring-inset ring-white/10 transition hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-white/30">
            {link.label}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

// A small figure tile: label, number, one short caption. Opens its tab when it has one.
// `whole` keeps a money figure whole (it wraps the tile wider) instead of ending it with an ellipsis.
function Tile({ label, value, tone = 'text-foreground', caption, title, onClick, whole }) {
  // A flex column, so a <button> tile does not centre its content and every tile's label sits on one line.
  const cls = 'stat-glass flex min-w-0 flex-col justify-start px-3.5 py-3 text-left';
  const body = (
    <>
      <p className="truncate text-[11px] font-medium text-white/55">{label}</p>
      <p className={`mt-1 ${whole ? 'whitespace-nowrap' : 'truncate'} text-base font-bold leading-tight tabular-nums sm:text-lg ${tone}`}>{value}</p>
      {caption && <div className="mt-1 text-[11px] leading-snug text-white/50">{caption}</div>}
    </>
  );
  return onClick ? (
    <button type="button" title={title} onClick={onClick}
      className={`${cls} cursor-pointer transition duration-200 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30`}>
      {body}
    </button>
  ) : <div className={cls} title={title}>{body}</div>;
}

// The header's ring: how much of the cash held is yours once the supplier is covered. `label={false}` drops the
// % inside it, where the precise figure already sits beside the ring.
function Ring({ pct, size = 54, stroke = 5, label = true }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#34d399" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} />
      </svg>
      {label && <span className="absolute text-[11px] font-bold tabular-nums text-foreground">{Math.round(p)}%</span>}
    </span>
  );
}

// One term of the header's sum: a dot, a label, the number, a short caption. `wide`: the sum only runs in one
// line from xl (five terms need the room), so the sign stays in the label until then; `wide="lg"`: from lg.
function Term({ label, sign, value, tone, dot, caption, big, wide }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-white/55">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        {sign && <span className={wide === 'lg' ? 'lg:hidden' : wide ? 'xl:hidden' : 'sm:hidden'}>{sign}</span>}{label}
      </p>
      {/* Never shortened with an ellipsis: a money figure is always shown whole. */}
      <p className={`mt-1 whitespace-nowrap font-bold leading-none tabular-nums ${big ? 'text-xl 2xl:text-2xl' : 'text-[15px] sm:text-base 2xl:text-lg'} ${tone}`}>{value}</p>
      {caption && <div className="mt-1 text-[11px] leading-snug text-white/50">{caption}</div>}
    </div>
  );
}
const Op = ({ children, wide }) => <span className={`hidden self-center px-1 pt-3 text-lg font-light text-white/30 ${wide === 'lg' ? 'lg:block' : wide ? 'xl:block' : 'sm:block'}`} aria-hidden="true">{children}</span>;

function Overview({ onNavigate, onOwnerMoney }) {
  const [period, setPeriod] = usePeriod();
  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'overview', period],
    queryFn: async () => unwrap(await api.get('/finance/overview', { params: { period } })).data,
    refetchInterval: STEADY,
  });
  const { data: cf } = useQuery({
    queryKey: ['finance', 'cashflow', 'all'],
    queryFn: async () => unwrap(await api.get('/finance/cashflow', { params: { period: 'all' } })).data,
  });
  // On a very wide screen the month chart grows a little so it does not look flat.
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 1800px)').matches);
  useEffect(() => {
    const mq = window.matchMedia?.('(min-width: 1800px)');
    if (!mq) return undefined;
    const on = () => setWide(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  if (isLoading || !data) return <PageSpinner />;
  const flow = data.flow?.[period] || data.flow?.month || { moneyIn: 0, moneyOut: 0, net: 0 };
  const words = PERIOD_WORDS[period];
  // Everything of his that went in, however it went: cash through an account,
  // and commission handed to reps. Only the first can ever appear in cash flow.
  const flowOwner = flow.owner || {};
  const ownerPutIn = Number(flowOwner.putIn || 0) - Number(flowOwner.drawn || 0);
  const ownerParts = (flowOwner.intoAccounts || 0) > 0 && (flowOwner.commissionFromPocket || 0) > 0
    ? `${formatCurrency(flowOwner.intoAccounts)} through an account · ${formatCurrency(flowOwner.commissionFromPocket)} paid to reps by hand`
    : (flowOwner.commissionFromPocket || 0) > 0
      ? 'all of it commission you paid reps by hand'
      : null;
  const ny = data.needsYou || {};
  const cs = data.cashSplit;
  const om = data.ownerMoney || {};
  const net = flow.netWithOwner ?? flow.net;

  // Whose money. The whole bill and what is due now, as owed — not capped at what a wallet holds (that made
  // the total 10,410,000 against a 12,000,000 bill). Older servers without the fields fall back.
  const supplierLabel = cs?.supplierLabel || 'your suppliers';
  const totalOwed = cs
    ? (cs.owedTotal != null ? round2ui(cs.owedTotal) : round2ui((cs.setAside || 0) + (cs.dueLater || 0)))
    : round2ui(ny.supplierOutstanding || 0);
  const dueNow = cs ? (cs.dueNow != null ? round2ui(cs.dueNow) : round2ui(cs.setAside || 0)) : 0;
  const cashHeld = cs ? cs.totalCash : data.cashPosition;
  const yoursPct = cs && cs.totalCash > 0 ? (cs.yours / cs.totalCash) * 100 : null;
  const owedTitle = totalOwed > 0 && dueNow > 0
    ? `You owe ${supplierLabel} ${formatCurrency(totalOwed)} in total. Of that, ${formatCurrency(dueNow)} is due now — the cost of boxes already sold. The rest falls due as the stock on your shelf sells.`
    : totalOwed > 0
      ? `You owe ${supplierLabel} ${formatCurrency(totalOwed)} in total — but none of it is due yet. You pay ${supplierLabel} the cost of the boxes as they sell, and the boxes you have already sold are covered. The rest falls due as the stock on your shelf sells.`
      : `You owe ${supplierLabel} nothing — every box you have taken is paid for.`;

  // His own money. All time, the period's "your own money" IS the money in the business — the same total
  // from the same two parts — so it is said once; in a shorter period it shows under the tile.
  const ownerBrands = (om.byBrand || []).filter((b) => b.brandId && b.amount > 0);
  const split = (om.contributed || 0) > 0 && (om.paidRepsFromPocket || 0) > 0;
  const ownerFlowValue = ownerPutIn !== 0 ? ownerPutIn : (flow.ownerNet ?? 0);
  const ownerFlowIsDup = period === 'all'
    && round2ui(ownerFlowValue) === round2ui(om.owedBackToOwner || 0)
    && round2ui(flowOwner.intoAccounts || 0) === round2ui(om.contributed || 0)
    && round2ui(flowOwner.commissionFromPocket || 0) === round2ui(om.paidRepsFromPocket || 0);
  const showOwnerFlow = (flow.ownerNet ?? 0) !== 0 && !ownerFlowIsDup;

  const margin = data.revenue > 0 ? Math.round((data.netProfit / data.revenue) * 100) : null;
  const accountsDonut = data.accounts.filter((a) => a.balance > 0).map((a) => ({ name: a.name, value: a.balance, type: a.type }));
  const accountsTotal = accountsDonut.reduce((s, a) => s + a.value, 0);
  // Accounts below zero are not a slice, but they are listed under the donut so the list adds up to the cash held.
  const accountsBelow = data.accounts.filter((a) => a.balance < 0 && !a.isCommissionRecord);
  const expenses = data.expenseBreakdown || [];
  const expenseSum = expenses.reduce((s, e) => s + e.amount, 0);
  const buckets = cs ? cs.buckets.filter((b) => b.cash > 0 || b.revenue > 0) : [];
  // One colour per brand everywhere on the Overview: its wallet, its accounts in the donut, its sales dot.
  const brandIdx = new Map(buckets.map((b, i) => [b.key, i]));
  const accountIdx = new Map(buckets.flatMap((b, i) => b.accounts.map((a) => [a.name, i])));
  const accountHex = (name, i) => ACCOUNT_HEX[(accountIdx.get(name) ?? buckets.length + i) % ACCOUNT_HEX.length];

  // The month chart and the three figures under it.
  const series = cf?.series || [];
  const active = series.filter((m) => m.moneyIn > 0 || m.moneyOut > 0);
  const hasSeries = active.length > 0;
  const best = active.reduce((a, m) => (!a || m.moneyIn > a.moneyIn ? m : a), null);
  const avgIn = hasSeries ? active.reduce((s, m) => s + m.moneyIn, 0) / active.length : 0;
  const thisMonthIn = series.length > 0 && active.includes(series[series.length - 1]);
  // In − out over the chart's months only; the owner's own money is not in this series.
  const chartNet = series.reduce((s, m) => s + (m.net ?? (m.moneyIn - m.moneyOut)), 0);

  const now = new Date();
  const periodTitle = {
    today: eatDay(now, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
    week: 'This week',
    month: eatDay(now, { month: 'long', year: 'numeric' }),
    all: 'All time',
  }[period];
  const periodSub = {
    today: 'today so far',
    week: 'Monday to today',
    month: 'month to date',
    all: data.epochAt ? `everything since ${formatDate(data.epochAt)}` : 'everything recorded so far',
  }[period];

  const attention = [
    ny.pendingApprovals > 0 && { icon: ShieldCheck, tone: 'text-sky-300 bg-sky-500/15', text: `${ny.pendingApprovals} settlement${ny.pendingApprovals === 1 ? '' : 's'} waiting for your approval`, tab: 'commissions' },
    ny.pendingWithdrawals?.count > 0 && { icon: Coins, tone: 'text-amber-300 bg-amber-500/15', text: `${ny.pendingWithdrawals.count} withdrawal request${ny.pendingWithdrawals.count === 1 ? '' : 's'} — ${formatCurrency(ny.pendingWithdrawals.amount)}`, tab: 'commissions' },
    // Only what needs a DECISION: the supplier is paid as the stock sells, so the whole invoice is not
    // listed — only money genuinely payable now.
    (cs?.setAside || 0) > 0 && {
      icon: Factory,
      tone: 'text-rose-300 bg-rose-500/15',
      text: `${formatCurrency(cs.setAside)} is due to ${cs.supplierLabel || 'your supplier'} for boxes already sold`,
      tab: 'suppliers',
    },
    ...(ny.negativeAccounts || []).map((n) => ({ icon: AlertTriangle, tone: 'text-rose-300 bg-rose-500/15', text: `${n} is below zero — money left that never arrived`, tab: 'accounts' })),
  ].filter(Boolean);

  const desks = [
    { tab: 'profit', title: 'Profit', line: 'What you make — per brand, and box by box', value: formatCurrency(data.netProfit), tone: data.netProfit >= 0 ? 'text-emerald-300' : 'text-rose-300' },
    { tab: 'cashflow', title: 'Cash Flow', line: 'Opening to closing, and what moved it', value: formatCurrency(data.cashPosition), tone: 'text-foreground' },
    { tab: 'suppliers', title: 'Suppliers', line: 'Who you buy from and what you owe them', value: formatCurrency(ny.supplierOutstanding || 0), tone: ny.supplierOutstanding > 0 ? 'text-rose-300' : 'text-faint' },
    { tab: 'expenses', title: 'Expenses', line: 'What the business spends, by category', value: formatCurrency(data.expenses), tone: 'text-foreground' },
    { tab: 'commissions', title: 'Commissions', line: 'What the reps have earned and can withdraw', value: formatCurrency(data.outstandingCommission), tone: data.outstandingCommission > 0 ? 'text-amber-300' : 'text-faint' },
    { tab: 'ledger', title: 'Ledger', line: 'Every shilling in and out, in one register', value: null, tone: '' },
  ];

  return (
    <div className="space-y-4">
      {/* ── The period and his two money buttons ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-full bg-white/[0.04] p-1 ring-1 ring-inset ring-white/10" role="tablist" aria-label="Period">
          {PERIODS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={period === k} onClick={() => setPeriod(k)}
              className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition sm:px-3.5 sm:text-[13px] ${period === k ? 'bg-white/[0.14] text-foreground shadow-sm' : 'text-muted hover:text-foreground'}`}>{label}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => onOwnerMoney?.('in')} title="Cash of your own going into an account — owed back to you">
            <ArrowDownLeft className="h-3.5 w-3.5" /> Put my money in
          </Button>
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => onOwnerMoney?.('out')}>
            <ArrowUpRight className="h-3.5 w-3.5" /> Take profit out
          </Button>
        </div>
      </div>

      {/* ── Header strip: the period · sales − goods − expenses = earned · the cash ring ── */}
      {/* One row only from 2xl (1536px): below that the sum is too narrow for its figures, so it keeps its own
          full-width row under the period and the ring. */}
      <div className="stat-glass grid grid-cols-1 gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5 2xl:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] 2xl:gap-6">
        <div className="min-w-0">
          <p className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45 sm:block">Overview</p>
          <p className="text-[15px] font-semibold leading-tight text-foreground sm:mt-1 sm:whitespace-nowrap">{periodTitle}</p>
          <p className="mt-0.5 hidden text-[11px] text-white/50 sm:block">{periodSub}</p>
        </div>

        <div className="order-last grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/[0.07] pt-4 sm:col-span-2 sm:flex sm:items-start sm:justify-start sm:gap-5 lg:gap-7 2xl:order-none 2xl:col-span-1 2xl:justify-center 2xl:border-l 2xl:border-t-0 2xl:pl-6 2xl:pt-0"
          title={`Earned = sales − cost of goods − expenses, ${words}. Rep pay is yours, not the business's.`}>
          <Term label="Sales" value={formatCurrency(data.revenue)} tone="text-foreground" dot="bg-sky-400"
            caption={`${formatNumber(data.boxesSold ?? 0)} boxes`} />
          <Op>−</Op>
          <Term label="Cost of goods" sign="− " value={formatCurrency(data.cogs)} tone="text-foreground" dot="bg-rose-400"
            caption={<>gross <span className={`tabular-nums ${data.grossProfit >= 0 ? 'text-white/80' : 'text-rose-300'}`}>{formatCurrency(data.grossProfit)}</span></>} />
          <Op>−</Op>
          <Term label="Expenses" sign="− " value={formatCurrency(data.expenses)} tone="text-foreground" dot="bg-amber-400"
            caption={expenses.length ? `${expenses.length} categor${expenses.length === 1 ? 'y' : 'ies'}` : 'none recorded'} />
          <Op>=</Op>
          <Term label="Earned" sign="= " big value={formatCurrency(data.netProfit)} tone={data.netProfit >= 0 ? 'text-emerald-300' : 'text-rose-300'} dot="bg-emerald-400"
            caption={<>{margin != null && <span className={`mr-1 inline-block whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-semibold ${data.netProfit >= 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>{margin}% of sales</span>}reps earned <span className="whitespace-nowrap tabular-nums text-amber-300">{formatCurrency(data.commissionAccrued ?? 0)}</span></>} />
        </div>

        <div className="flex items-center gap-3 border-t border-white/[0.07] pt-4 sm:border-t-0 sm:pt-0 2xl:border-l 2xl:pl-6"
          title={cs ? `Cash in every account. ${dueNow > 0 ? `${formatCurrency(cs.yours)} of it is yours, free to use, after the supplier is covered.` : 'All of it is yours.'}` : undefined}>
          {yoursPct != null && <Ring pct={yoursPct} />}
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-white/55">Cash you hold</p>
            <p className="mt-0.5 whitespace-nowrap text-xl font-bold leading-tight tabular-nums text-foreground">{formatCurrency(cashHeld)}</p>
            {cs && (
              <p className="mt-0.5 text-[11px] text-white/50">
                {dueNow > 0
                  ? <>yours <span className="tabular-nums text-emerald-300">{formatCurrency(cs.yours)}</span></>
                  : 'all of it yours'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Six small figures ── */}
      {/* Colour only where it carries meaning: in green, out red, an amount owed amber. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <Tile label="Money in" value={formatCurrency(flow.moneyIn)} tone="text-emerald-300" caption={`collected ${words}`}
          title={`What the business collected ${words}`} onClick={() => onNavigate?.('cashflow')} />
        <Tile label="Money out" value={formatCurrency(flow.moneyOut)} tone="text-rose-300" caption={`paid ${words}`}
          title={`What the business paid ${words}`} onClick={() => onNavigate?.('cashflow')} />
        <Tile label="Net movement" value={formatCurrency(net)} tone={net >= 0 ? 'text-foreground' : 'text-rose-300'}
          caption={`accounts ${net >= 0 ? 'gained' : 'lost'}`}
          title={`What the accounts ${net >= 0 ? 'gained' : 'lost'} ${words}${ownerParts ? ' — counting only money that moved through them' : ''}`}
          onClick={() => onNavigate?.('cashflow')} />
        <Tile label={`You owe ${supplierLabel}`} value={formatCurrency(totalOwed)} tone={totalOwed > 0 ? 'text-amber-300' : 'text-foreground'}
          title={owedTitle} onClick={() => onNavigate?.('suppliers')}
          caption={dueNow > 0
            ? <span className="inline-block rounded-full bg-rose-500/15 px-1.5 py-px text-[10.5px] font-semibold tabular-nums text-rose-300">{formatCurrency(dueNow)} due now</span>
            : totalOwed > 0
              ? <>none due yet{(cs?.paidAhead || 0) > 0 && <> · <span className="tabular-nums">{formatCurrency(cs.paidAhead)}</span> paid ahead</>}</>
              : 'nothing outstanding'} />
        <Tile label="Your money in it" value={formatCurrency(om.owedBackToOwner || 0)} tone="text-foreground"
          title="What you have put into the business — owed back to you when it can afford it"
          caption={(
            <>
              {split ? (
                <>
                  <span className="block"><span className="tabular-nums">{formatCurrency(om.contributed)}</span> {ownerBrands.length > 0 ? `behind ${ownerBrands.map((b) => b.name).join(' and ')}` : 'put in'}</span>
                  <span className="block"><span className="tabular-nums">{formatCurrency(om.paidRepsFromPocket)}</span> paid reps by hand</span>
                </>
              ) : (om.paidRepsFromPocket || 0) > 0
                ? 'commission you paid reps by hand'
                : ownerBrands.length > 0
                  ? `cash behind ${ownerBrands.map((b) => b.name).join(' and ')}`
                  : 'owed back to you'}
              {showOwnerFlow && (
                <span className="mt-0.5 block text-white/70" title={ownerParts || undefined}>
                  {words}: <span className="tabular-nums">{formatCurrency(ownerFlowValue)}</span>
                  {ownerParts
                    ? <span className="block text-white/50">{ownerParts}</span>
                    : <span className="text-white/50"> · {(flow.ownerNet ?? 0) >= 0 ? 'you put in' : 'you took out'}</span>}
                </span>
              )}
            </>
          )} />
        <Tile label="Reps can withdraw" value={formatCurrency(data.outstandingCommission)}
          tone={data.outstandingCommission > 0 ? 'text-amber-300' : 'text-foreground'}
          caption="commission owed to reps" title="What the reps have earned and can withdraw"
          onClick={() => onNavigate?.('commissions')} />
      </div>

      {/* ── Month by month · where the cash sits (two cards of the same height) ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Month by month" sub={(
            <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span>The last six months</span>
              <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />In</span>
              <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-rose-400" />Out</span>
              <span className="inline-flex items-center gap-1"><span className="h-0.5 w-2.5 rounded-full bg-sky-300" />Left</span>
            </span>
          )}
          link={{ tab: 'cashflow', label: 'Cash Flow' }} onNavigate={onNavigate}>
          {hasSeries ? (
            <>
              <div className="-ml-2">
                <BarsWithLine data={series} height={wide ? 240 : 200}
                  bars={[{ key: 'moneyIn', name: 'Money in', color: '#34d399' }, { key: 'moneyOut', name: 'Money out', color: '#fb7185' }]}
                  line={{ key: 'net', name: 'Net', color: '#7dd3fc' }} />
              </div>
              <div className="mt-auto grid grid-cols-3 gap-3 border-t border-white/[0.07] pt-3">
                <div className="min-w-0">
                  <p className="min-h-[2.75em] text-[11px] leading-snug text-white/50 sm:min-h-0">Average month in</p>
                  <p className="truncate text-sm font-semibold tabular-nums text-foreground">{formatCurrency(avgIn)}</p>
                  <p className="text-[10.5px] text-white/50">{active.length} month{active.length === 1 ? '' : 's'}{thisMonthIn ? ', this one so far' : ' with money'}</p>
                </div>
                <div className="min-w-0">
                  <p className="min-h-[2.75em] text-[11px] leading-snug text-white/50 sm:min-h-0">Best month in</p>
                  <p className="truncate text-sm font-semibold tabular-nums text-emerald-300">{formatCurrency(best?.moneyIn)}</p>
                  <p className="text-[10.5px] text-white/50">{best?.period}</p>
                </div>
                <div className="min-w-0" title="Money in minus money out over the months in this chart. Your own money put in or taken out is not counted here, so this is not the same as Net movement.">
                  <p className="min-h-[2.75em] text-[11px] leading-snug text-white/50 sm:min-h-0">In − out, these {series.length} months</p>
                  <p className={`truncate text-sm font-semibold tabular-nums ${chartNet >= 0 ? 'text-foreground' : 'text-rose-300'}`}>{formatCurrency(chartNet)}</p>
                  <p className="text-[10.5px] text-white/50">your own money not counted</p>
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-[170px] items-center justify-center text-sm text-white/50">Fills in as months of activity add up.</div>
          )}
        </Panel>

        <Panel title="Where the cash sits" sub="Each account's share" link={{ tab: 'accounts', label: 'Accounts' }} onNavigate={onNavigate}>
          {accountsDonut.length ? (
            <div className="flex flex-1 flex-col justify-center gap-3">
              <div className="relative mx-auto w-full max-w-[200px]">
                {/* each account in its brand's colour — the same as its wallet and its sales dot */}
                <DonutChart data={accountsDonut} height={176} legend={false} innerRadius={58} outerRadius={80} stroke="none"
                  colors={accountsDonut.map((a, i) => accountHex(a.name, i))} />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-sm font-bold tabular-nums text-foreground">TSh {formatNumber(accountsTotal, { compact: true })}</span>
                  <span className="text-[10px] uppercase tracking-wider text-white/50">{round2ui(accountsTotal) === round2ui(cashHeld) ? 'held' : 'above zero'}</span>
                </div>
              </div>
              <ul className="space-y-1.5">
                {accountsDonut.map((a, i) => {
                  const Icon = ACCOUNT_ICON[a.type] || Wallet;
                  const hex = accountHex(a.name, i);
                  return (
                    <li key={a.name} className="flex items-center gap-2 text-[13px]">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: `${hex}26`, color: hex }}>
                        <Icon className="h-3 w-3" />
                      </span>
                      <span className="min-w-0 flex-1 leading-tight text-muted">{a.name}</span>
                      <span className="shrink-0 font-semibold tabular-nums text-foreground">{formatCurrency(a.value)}</span>
                      <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-faint">{accountsTotal > 0 ? Math.round((a.value / accountsTotal) * 100) : 0}%</span>
                    </li>
                  );
                })}
                {accountsBelow.map((a) => {
                  const Icon = ACCOUNT_ICON[a.type] || Wallet;
                  return (
                    <li key={a.name} className="flex items-center gap-2 text-[13px]" title={`${a.name} is below zero — it is not a slice of the donut, but it is counted in the cash you hold.`}>
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-white/40">
                        <Icon className="h-3 w-3" />
                      </span>
                      <span className="min-w-0 flex-1 leading-tight text-white/50">{a.name}</span>
                      <span className="shrink-0 font-semibold tabular-nums text-rose-300">{formatCurrency(a.balance)}</span>
                      <span className="w-8 shrink-0 text-right text-[11px] text-faint">—</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center py-10 text-sm text-white/50">No account holds money right now.</div>
          )}
        </Panel>
      </div>

      {/* ── Sales by brand · wallets · where the money went ── */}
      <div className={clsx('grid grid-cols-1 gap-4 lg:grid-cols-2', cs && 'xl:grid-cols-3')}>
        <Panel title="Sales by brand" sub={`What was kept · ${words}`}
          link={{ tab: 'profit', label: 'Profit' }} onNavigate={onNavigate}>
          {(data.brandFinance || []).length === 0 ? (
            <p className="py-6 text-center text-sm text-white/50">No sales in this period.</p>
          ) : (
            <div className="flex flex-1 flex-col gap-4">
              {data.brandFinance.map((b, i) => {
                const kept = b.revenue - b.cogs;
                const keptPct = b.revenue > 0 ? Math.round((kept / b.revenue) * 100) : 0;
                const cogsPct = b.revenue > 0 ? Math.min(100, (b.cogs / b.revenue) * 100) : 0;
                return (
                  <div key={b.brandId}
                    title={`Sales over ${period === 'all' ? 'the whole period' : words}, not money sitting in an account — most of it has already gone back out to buy stock. Out of every 100 shillings of ${b.name} sold, ${keptPct} stayed in the business after paying for the boxes.${(b.commission ?? 0) > 0 ? ` Reps earned ${formatCurrency(b.commission)} on these sales, which you pay yourself.` : ''}`}>
                    <div className="flex items-baseline gap-2">
                      <span className={`h-2 w-2 shrink-0 self-center rounded-full ${ACCOUNT_DOT[(brandIdx.get(b.brandId) ?? buckets.length + i) % ACCOUNT_DOT.length]}`} />
                      <span className="text-[13px] font-semibold text-foreground">{b.name}</span>
                      <span className="text-[11px] text-faint">{formatNumber(b.boxesSold)} box{b.boxesSold === 1 ? '' : 'es'}</span>
                      <span className={`ml-auto text-sm font-bold tabular-nums ${kept >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{formatCurrency(kept)}</span>
                    </div>
                    <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                      <div className="h-full bg-rose-400/45" style={{ width: `${cogsPct}%` }} />
                      <div className="h-full bg-emerald-400" style={{ width: `${Math.max(0, 100 - cogsPct)}%` }} />
                    </div>
                    <p className="mt-1.5 text-[11px] text-white/50">
                      <span className="whitespace-nowrap">Sales <span className="tabular-nums text-white/80">{formatCurrency(b.revenue)}</span></span>{' '}
                      <span className="whitespace-nowrap">− goods <span className="tabular-nums text-white/80">{formatCurrency(b.cogs)}</span></span>
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-white/50">
                      <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${kept >= 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>{keptPct}% kept</span>
                      {(b.commission ?? 0) > 0 && <span className="whitespace-nowrap">reps earned <span className="tabular-nums text-amber-300/90">{formatCurrency(b.commission)}</span></span>}
                    </p>
                  </div>
                );
              })}
              {data.brandFinance.length > 1 && (() => {
                const rev = data.brandFinance.reduce((t, b) => t + b.revenue, 0);
                const kept = data.brandFinance.reduce((t, b) => t + (b.revenue - b.cogs), 0);
                return (
                  <div className="mt-auto flex items-center gap-2 border-t border-white/[0.07] pt-2.5 text-[13px]">
                    <span className="flex-1 font-semibold text-foreground">All brands</span>
                    {rev > 0 && <span className="rounded-full bg-white/[0.06] px-1.5 py-px text-[10px] font-semibold tabular-nums text-muted">{Math.round((kept / rev) * 100)}% kept</span>}
                    <span className={`font-bold tabular-nums ${kept >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{formatCurrency(kept)}</span>
                  </div>
                );
              })()}
            </div>
          )}
        </Panel>

        {cs && (
          <Panel title="Wallets" sub="Whose money each one holds"
            link={{ tab: 'accounts', label: 'Accounts' }} onNavigate={onNavigate}>
            {buckets.length === 0 ? (
              <p className="py-6 text-center text-sm text-white/50">No wallet holds money yet.</p>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {buckets.map((b, i) => {
                  const tint = ACCOUNT_TINT[i % ACCOUNT_TINT.length];
                  const named = b.accounts.filter((a) => a.balance !== 0);
                  const Icon = named[0] ? (ACCOUNT_ICON[data.accounts.find((a) => a.name === named[0].name)?.type] || Wallet) : Wallet;
                  const yoursPct2 = b.cash > 0 ? Math.max(0, Math.min(100, (b.yours / b.cash) * 100)) : 0;
                  const mix = b.cash > 0 && b.revenue > 0;
                  return (
                    <div key={b.key} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-2.5">
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tint.chip}`}><Icon className="h-3.5 w-3.5" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold text-foreground">{b.brandName}</p>
                          <p className="truncate text-[11px] text-white/50">{named.map((a) => a.name).join(', ') || 'no account holds money'}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold tabular-nums text-foreground">{formatCurrency(b.cash)}</p>
                          <span className={`mt-0.5 inline-block rounded-full px-1.5 py-px text-[10px] font-semibold ${b.setAside > 0 ? 'bg-rose-500/15 text-rose-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                            {b.setAside > 0 ? 'Supplier owed' : 'All yours'}
                          </span>
                        </div>
                      </div>
                      {b.cash > 0 && (
                        <>
                          <div className="mt-2.5 flex h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                            <div className="h-full bg-rose-400/45" style={{ width: `${100 - yoursPct2}%` }} />
                            <div className="h-full bg-emerald-400" style={{ width: `${yoursPct2}%` }} />
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
                            <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-rose-400/60" />{b.supplierName || 'Supplier'} <b className="font-semibold tabular-nums text-white/90">{formatCurrency(b.setAside)}</b></span>
                            <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Yours <b className="font-semibold tabular-nums text-white/90">{formatCurrency(b.yours)}</b></span>
                          </div>
                        </>
                      )}
                      {(b.moneyIn > 0 || b.moneyOut > 0) && (
                        <div className="mt-2 grid grid-cols-3 gap-2 border-t border-white/[0.06] pt-2">
                          <div className="min-w-0">
                            <p className="text-[10px] text-white/50">Came in</p>
                            <p className="truncate text-xs font-semibold tabular-nums text-emerald-300">{formatCurrency(b.moneyIn)}</p>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[10px] text-white/50">Went out</p>
                            <p className="truncate text-xs font-semibold tabular-nums text-rose-300">{formatCurrency(b.moneyOut)}</p>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[10px] text-white/50">Profit in it</p>
                            <p className="truncate text-xs font-semibold tabular-nums text-white/90">{formatCurrency(b.profitPart)}</p>
                          </div>
                        </div>
                      )}
                      {/* What the money held is made of (the same mix as the sales that brought it in), and
                          what falls due later. "X is the supplier's" is the legend above, so it is not repeated.
                          Each part stays whole, so a line only breaks at a " · ". */}
                      {(mix || b.dueLater > 0 || b.paidAhead > 0) && (
                        <p className="mt-1.5 text-[11px] leading-snug text-white/50">
                          {mix && (
                            <span className="whitespace-nowrap">Goods <span className="tabular-nums text-white/75">{formatCurrency(b.costPart)}</span> ({Math.round(b.costShare)}%) · profit {Math.round(b.profitShare)}%</span>
                          )}
                          {b.paidAhead > 0 && <>{mix && ' · '}<span className="whitespace-nowrap"><span className="tabular-nums text-white/75">{formatCurrency(b.paidAhead)}</span> paid ahead</span></>}
                          {b.dueLater > 0 && <>{(mix || b.paidAhead > 0) && ' · '}<span className="whitespace-nowrap"><span className="tabular-nums text-white/75">{formatCurrency(b.dueLater)}</span> more as stock sells</span></>}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        )}

        <Panel className={cs ? 'lg:col-span-2 xl:col-span-1' : ''} title="Where the money went" sub={`Expenses by category · ${words}`}
          link={{ tab: 'expenses', label: 'Expenses' }} onNavigate={onNavigate}>
          {expenses.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 py-6 text-center"
              title={`When you buy boxes you have not lost the money, you have turned it into stock on your shelf. The cost counts the day a box sells — that is the cost of goods. Paying ${cs?.supplierLabel || 'your supplier'} is settling a debt, not a cost. Running costs like rent, transport and airtime belong here; record them with the Expense button.`}>
              <p className="text-sm text-muted">No running costs recorded</p>
              <p className="max-w-[18rem] text-[11px] leading-snug text-white/50">
                Buying stock is not one — it counts as goods when the boxes sell: <span className="tabular-nums text-white/75">{formatCurrency(data.cogs)}</span> for {formatNumber(data.boxesSold ?? 0)} boxes.
              </p>
            </div>
          ) : (
            <>
              {/* One hue for every category (money out); the length of the bar is the share. */}
              <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-1">
                {expenses.map((e) => {
                  const pct = expenseSum > 0 ? (e.amount / expenseSum) * 100 : 0;
                  return (
                    <div key={e.category}>
                      <div className="flex items-center gap-2 text-[13px]">
                        <span className="min-w-0 flex-1 truncate text-muted">{e.category}</span>
                        {e.count != null && <span className="shrink-0 text-[10.5px] tabular-nums text-faint">{formatNumber(e.count)}×</span>}
                        <span className="shrink-0 font-semibold tabular-nums text-foreground">{formatCurrency(e.amount)}</span>
                        <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-faint">{pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`}</span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                        <div className="h-full rounded-full bg-rose-400/60" style={{ width: `${Math.max(2, pct)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-auto pt-3">
                <div className="flex items-center justify-between border-t border-white/[0.07] pt-2.5 text-[13px]">
                  <span className="font-semibold text-foreground">Total</span>
                  <span className="font-bold tabular-nums text-rose-300">{formatCurrency(data.expenses)}</span>
                </div>
              </div>
            </>
          )}
        </Panel>
      </div>

      {/* ── Best products · the desk ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Best products" sub={`By what you keep · ${words}`}
          link={{ tab: 'profit', label: 'Profit' }} onNavigate={onNavigate}>
          {!(data.topProducts || []).length ? (
            <p className="py-6 text-center text-sm text-white/50">No sales in this period.</p>
          ) : (
            <>
            <ul className="-mx-4 -mb-4 divide-y divide-white/[0.05] border-t border-white/[0.06] sm:hidden">
              {data.topProducts.map((p) => (
                <li key={p.productId}>
                  <button type="button" onClick={() => onNavigate?.('profit')} className="w-full cursor-pointer px-4 py-2.5 text-left transition hover:bg-white/[0.035]">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 text-[13px] font-medium leading-snug text-foreground">
                        {p.name}
                        {p.brandName && !p.name.startsWith(p.brandName) && <span className="ml-1.5 text-[11px] font-normal text-faint">{p.brandName}</span>}
                      </span>
                      <span className={`shrink-0 text-[13px] font-semibold tabular-nums ${p.contribution >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{formatCurrency(p.contribution)}</span>
                    </span>
                    <span className="mt-0.5 block text-[11px] tabular-nums text-white/50">
                      {formatNumber(p.boxes)} boxes · revenue {formatCurrency(p.revenue)} · margin <span title={`${p.contributionMargin}%`}>{Math.round(p.contributionMargin)}%</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="-mx-4 -mb-4 hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[34rem] text-[13px]">
                <thead>
                  <tr className="border-y border-white/[0.06] bg-white/[0.025] text-[10.5px] font-semibold uppercase tracking-wider text-white/45">
                    <th className="px-4 py-2 text-left font-semibold">Product</th>
                    <th className="w-px whitespace-nowrap px-3 py-2 text-right font-semibold">Boxes</th>
                    <th className="w-px whitespace-nowrap px-3 py-2 text-right font-semibold">Revenue</th>
                    <th className="w-px whitespace-nowrap px-3 py-2 text-right font-semibold">Earned</th>
                    <th className="w-px whitespace-nowrap px-4 py-2 text-right font-semibold">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topProducts.map((p) => (
                    <tr key={p.productId} onClick={() => onNavigate?.('profit')}
                      className="cursor-pointer border-b border-white/[0.05] transition last:border-0 hover:bg-white/[0.035]">
                      <td className="px-4 py-2">
                        <span className="block font-medium leading-snug text-foreground">
                          {p.name}
                          {p.brandName && !p.name.startsWith(p.brandName) && <span className="ml-1.5 text-[11px] font-normal text-faint">{p.brandName}</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{formatNumber(p.boxes)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{formatCurrency(p.revenue)}</td>
                      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${p.contribution >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{formatCurrency(p.contribution)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted" title={`${p.contributionMargin}%`}>{Math.round(p.contributionMargin)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </Panel>

        <Panel title="The finance desk" sub="Each tab and its number">
          <div className="-mx-1 divide-y divide-white/[0.06]">
            {desks.map((d) => (
              <button key={d.tab} type="button" title={d.line} onClick={() => onNavigate?.(d.tab)}
                className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-1 py-2 text-left text-[13px] transition hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30">
                <span className="flex-1 font-medium text-foreground">{d.title}</span>
                {d.value != null
                  ? <span className={`font-semibold tabular-nums ${d.tone}`}>{d.value}</span>
                  : <span className="text-[11px] text-faint">every shilling</span>}
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
              </button>
            ))}
          </div>
        </Panel>
      </div>

      {/* ── Needs attention: one line each ── */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">Needs attention</h3>
          <span className={`rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums ${attention.length ? 'bg-brand-500/20 text-brand-600' : 'bg-emerald-500/15 text-emerald-300'}`}>{attention.length}</span>
        </div>
        {attention.length === 0 ? (
          <div className="glass-list flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-muted">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            All clear — no settlement or withdrawal waiting, no account below zero.
          </div>
        ) : (
          <div className="glass-list">
            {attention.map((a, i) => (
              <button key={i} type="button" onClick={() => onNavigate?.(a.tab)}
                className="flex w-full cursor-pointer items-center gap-3 border-b border-white/[0.05] px-4 py-2.5 text-left transition duration-200 last:border-0 hover:bg-white/[0.04]">
                <span className={`rounded-md p-1 ${a.tone}`}><a.icon className="h-3.5 w-3.5" /></span>
                <span className="min-w-0 flex-1 text-[13px] leading-snug text-foreground sm:truncate">{a.text}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-white/50">
        Earned is sales − cost of goods − expenses. Rep commission is yours to pay, not the business&apos;s. Buying stock is not an expense — it counts as goods the day a box sells.
      </p>
    </div>
  );
}

function Money({ label, value, tone, big }) {
  const tones = { emerald: 'text-emerald-500', rose: 'text-rose-500', brand: 'text-brand-600', amber: 'text-amber-500', sky: 'text-sky-400', slate: 'text-muted', default: 'text-foreground' };
  return (
    <div className={`rounded-xl border border-border bg-elevated p-3 ${big ? 'ring-1 ring-white/20' : ''}`}>
      <div className="text-[11px] uppercase tracking-wide text-faint">{label}</div>
      <div className={`mt-0.5 font-bold tabular-nums ${big ? 'text-xl' : 'text-base'} ${tones[tone] || tones.default}`}>{formatCurrency(value)}</div>
    </div>
  );
}

// ── Accounts tab ──────────────────────────────────────────────────────────────
// Everything that has moved through one account, newest first, with a running
// balance. The running balance is walked BACKWARDS from the account's current
// balance: the newest row must end at the balance on the card, and each
// earlier row is that figure with the later movements undone. Adding forwards
// from an opening balance would drift the moment a page boundary hid a row.
function AccountStatementModal({ account, onClose }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'account-statement', account.id, page],
    queryFn: async () => unwrap(await api.get('/finance/transactions', {
      params: { accountId: account.id, page, limit: 25, sortBy: 'occurredAt', sortDir: 'desc' },
    })),
  });
  const rows = data?.data || [];
  const sums = data?.meta?.sums;
  const isRecord = !!account.isCommissionRecord;

  // Balance after each row, newest first. A record has no running balance to
  // walk — every row on it was paid from the owner's own hand and moved no
  // account — so the column is dropped rather than filled with zeroes.
  // Page 2 onwards starts below the rows on the pages before it (newerNet = their in minus out),
  // not at today's balance again.
  let running = Math.round((account.balance - Number(data?.meta?.newerNet || 0)) * 100) / 100;
  const withBalance = rows.map((t) => {
    const after = running;
    running = Math.round((after - (t.direction === 'IN' ? Number(t.amount) : -Number(t.amount))) * 100) / 100;
    return { ...t, balanceAfter: after };
  });

  const Icon = ACCOUNT_ICON[account.type] || Wallet;
  return (
    <Modal open onClose={onClose} size="xl" title={`${account.name} — every movement`}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/[0.08] bg-surface p-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600"><Icon className="h-5 w-5" /></span>
          {isRecord ? (
            <>
              <div>
                <p className="text-xs text-muted">Commission recorded</p>
                <p className="text-2xl font-bold tabular-nums text-violet-300">{formatCurrency(account.recorded)}</p>
              </div>
              <p className="ml-auto max-w-xs text-right text-[11px] text-faint">
                Every payout you have made from your own pocket. No money is held here, so there is no balance to show.
              </p>
            </>
          ) : (
            <>
              <div>
                <p className="text-xs text-muted">Balance now</p>
                <p className={`text-2xl font-bold tabular-nums ${account.balance < 0 ? 'text-rose-400' : 'text-foreground'}`}>{formatCurrency(account.balance)}</p>
              </div>
              <div className="ml-auto flex gap-6 text-right">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted">Came in</p>
                  <p className="text-sm font-bold tabular-nums text-emerald-400">{formatCurrency(sums?.in ?? account.moneyIn)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted">Went out</p>
                  <p className="text-sm font-bold tabular-nums text-rose-400">{formatCurrency(sums?.out ?? account.moneyOut)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted">Opening</p>
                  <p className="text-sm font-bold tabular-nums text-muted">{formatCurrency(account.openingBalance)}</p>
                </div>
              </div>
            </>
          )}
        </div>
        {account.notes && <p className="text-xs text-faint">{account.notes}</p>}

        {isLoading ? <PageSpinner /> : !rows.length ? (
          <EmptyState title="Nothing has moved through this account yet" icon={Receipt} />
        ) : (
          <>
            <Table>
              <THead>
                {/* On the record, In/Out is the wrong question — nothing came
                    in and nothing went out of any account. Every row is one
                    payout, so it gets one column: who, and how much. */}
                <TR>
                  <TH>Date</TH><TH>Type</TH><TH>{isRecord ? 'Paid to' : 'What it was'}</TH>
                  {isRecord ? <TH className="text-right">Amount</TH> : (
                    <><TH className="text-right">In</TH><TH className="text-right">Out</TH><TH className="text-right">Balance</TH></>
                  )}
                </TR>
              </THead>
              <TBody>
                {withBalance.map((t) => (
                  <TR key={t.id}>
                    <TD className="whitespace-nowrap text-faint">{formatDate(t.occurredAt)}</TD>
                    <TD><Badge className={isPayoutRow(t) ? PAYOUT_BADGE : DIR_BADGE[t.direction]}>{TXN_TYPE_LABEL[t.type] || t.type}</Badge></TD>
                    {/* Wraps to two lines rather than pushing Balance past the window's edge (it ran 63 px over at 1440). */}
                    <TD className="min-w-[170px] max-w-[260px] whitespace-normal text-foreground"
                      title={isRecord && t.payee ? t.payee : (t.description || t.category || t.reference || undefined)}>
                      <div className="line-clamp-2 break-words leading-snug">
                        {isRecord && t.payee ? t.payee : (t.description || t.category || t.reference || '—')}
                        {isRecord && t.payeeCode && <span className="ml-1.5 text-[11px] text-faint">{t.payeeCode}</span>}
                        {t.brandName && <span className="ml-1.5 text-[11px] text-faint">{t.brandName}</span>}
                      </div>
                    </TD>
                    {isRecord ? (
                      <TD className="text-right font-semibold tabular-nums text-violet-300">{formatCurrency(t.amount)}</TD>
                    ) : (
                      <>
                        <TD className="text-right font-semibold tabular-nums text-emerald-400">
                          {t.direction === 'IN' ? formatCurrency(t.amount) : ''}
                        </TD>
                        <TD className="text-right font-semibold tabular-nums text-rose-400">
                          {t.direction === 'OUT' ? formatCurrency(t.amount) : ''}
                        </TD>
                        <TD className="text-right font-bold tabular-nums text-foreground">{formatCurrency(t.balanceAfter)}</TD>
                      </>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} totalPages={data.meta?.totalPages} total={data.meta?.total} onChange={setPage} />
          </>
        )}
      </div>
    </Modal>
  );
}

// Each account is the rep's Wallet card (components/WalletCard) in the account's own colour — Nino, 11 Nov 2026:
// "I need the same card like the one on the rep, the card that shows the wallet balance". The same deep gradient,
// the soft light from the corner and two hair-thin arcs, the house mark where a bank card keeps its logo, the eye,
// the balance big with one word of action beside it, then three small figures. The colour is the account's
// (its brand's, as on the Overview), never red; a balance below zero turns the figure rose.
const ACCOUNT_LIGHT = ['#34d399', '#a78bfa', '#38bdf8', '#fbbf24']; // ACCOUNT_DOT as hex: text on a dark card
// The card's gradient per colour: [from, middle] — it always ends in the app's near-black, as the rep card does.
const WALLET_TINT = [['#0b2a20', '#0a1712'], ['#211538', '#120d1f'], ['#0b2333', '#09141d'], ['#2c2109', '#171106']];
const RECORD_TINT = ['#1f1f24', '#141417'];
const HIDE_KEY = 'zelab:hideAccounts';
const readHideAccounts = () => { try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; } };
const saveHideAccounts = (v) => { try { localStorage.setItem(HIDE_KEY, v ? '1' : '0'); } catch { /* private window: fine */ } };

function walletStyle([from, mid]) {
  return {
    background: `linear-gradient(140deg, ${from} 0%, ${mid} 52%, #0e0e10 100%)`,
    boxShadow: '0 14px 32px -16px rgba(0,0,0,.9), inset 0 1px 0 rgba(255,255,255,.07)',
  };
}
const WALLET_FRAME = 'relative isolate flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-[22px] p-4 text-left text-white ring-1 ring-inset ring-white/[0.09] transition duration-200 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30';

// One colour per brand on every Finance tab, by the Overview's rule (its cash buckets): brands ranked by the cash
// their accounts hold, most first, take emerald, violet, sky, amber in turn; an account wears its brand's colour.
// `alsoKeys` ranks brands with sales but no cash after those holding cash, as the Overview does.
function brandRank(accounts, alsoKeys = []) {
  const cash = new Map();
  for (const a of wallets(accounts)) { const k = a.brandId || 'general'; cash.set(k, (cash.get(k) || 0) + a.balance); }
  for (const k of alsoKeys) if (!cash.has(k)) cash.set(k, 0);
  const ranked = [...cash].sort((x, y) => y[1] - x[1]).filter(([k, c]) => c > 0 || alsoKeys.includes(k)).map(([k]) => k);
  return new Map(ranked.map((k, i) => [k, i]));
}

function WalletArcs() {
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 h-full w-full" viewBox="0 0 360 180" preserveAspectRatio="none">
      <path d="M-10 150 C 100 70, 240 40, 380 96" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="1" />
      <path d="M-10 178 C 120 100, 250 78, 380 128" fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="1" />
    </svg>
  );
}

// The top line of every wallet card: the label and the eye on the left, the house mark on the right. The eye is a
// <span role="button"> because the whole card is already a button (a button may not hold another).
function WalletTop({ label, chip, hidden, onToggleHide }) {
  const toggle = (e) => { e.stopPropagation(); onToggleHide(); };
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-[12px] font-medium tracking-wide text-white/70">{label}</span>
        {chip}
        <span role="button" tabIndex={0} onClick={toggle}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); } }}
          aria-pressed={hidden} aria-label={hidden ? 'Show amounts' : 'Hide amounts'}
          className="-m-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/55 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30">
          {hidden ? <EyeOff className="h-[15px] w-[15px]" /> : <Eye className="h-[15px] w-[15px]" />}
        </span>
      </div>
      <img src="/brand/zelab-dark.svg" alt="" aria-hidden="true" className="h-[15px] w-auto shrink-0 opacity-90" />
    </div>
  );
}

const DOTS = '••••••';

function AccountWalletCard({ account, tint, hex, light, sharePct, hidden, onToggleHide, onOpen }) {
  const negative = account.balance < 0;
  const mask = (s) => (hidden ? '•••' : s);
  return (
    <button type="button" onClick={onOpen} className={WALLET_FRAME} style={walletStyle(tint)}
      aria-label={`${account.name}: open every movement`}>
      <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-20 -z-10 h-56 w-56 rounded-full"
        style={{ background: `radial-gradient(closest-side, ${negative ? 'rgba(244,63,94,.28)' : `${hex}57`}, transparent)` }} />
      <WalletArcs />
      <WalletTop label={account.name} hidden={hidden} onToggleHide={onToggleHide}
        chip={account.isDefault ? <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-px text-[9.5px] font-semibold text-white/70">Default</span> : null} />

      {/* The balance, and the one action beside it — a word, like the rep card's Withdraw. */}
      <div className="-mt-0.5 flex flex-wrap items-center justify-between gap-x-3">
        <p className={`min-w-0 whitespace-nowrap text-[27px] font-bold leading-none tabular-nums ${negative ? 'text-rose-300' : 'text-white'} ${hidden ? 'tracking-[0.18em]' : ''}`}>
          {hidden ? DOTS : formatCurrency(account.balance)}
        </p>
        <span className="flex h-11 shrink-0 items-center gap-1 text-[15px] font-semibold text-white">
          Movements <ArrowUpRight className="h-[17px] w-[17px]" strokeWidth={2.4} />
        </span>
      </div>

      {/* Its share of the cash, as a thin line in its colour; below zero, one rose line says why there is none. */}
      {negative ? (
        <p className="text-[11px] font-medium text-rose-300">Below zero — money left that never arrived</p>
      ) : sharePct != null ? (
        <div className="flex items-center gap-2.5">
          <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/[0.09]">
            <div className="h-full rounded-full" style={{ width: `${Math.max(2, sharePct)}%`, background: light }} />
          </div>
          <span className="shrink-0 text-[11px] font-semibold tabular-nums" style={{ color: light }}>{sharePct}%</span>
        </div>
      ) : null}

      {/* The three supporting figures: small, plain, no lines or boxes around them. */}
      <div className="mt-3.5 flex flex-wrap justify-between gap-x-4 gap-y-2">
        {[['Money in', account.moneyIn, 'text-emerald-300'], ['Money out', account.moneyOut, 'text-rose-300'], ['Opening', account.openingBalance, 'text-white/85']].map(([label, v, tone]) => (
          <div key={label} className="min-w-0">
            <p className="text-[10px] text-white/45">{label}</p>
            <p className={`mt-px whitespace-nowrap text-[12.5px] font-medium tabular-nums ${tone}`}>{mask(formatCurrency(v))}</p>
          </div>
        ))}
      </div>

      {/* Where a bank card prints its holder: the number and whose it is. */}
      {account.notes && <p className="mt-auto pt-3.5 text-[10.5px] tracking-wide text-white/40">{account.notes}</p>}
    </button>
  );
}

// The Commission account is a record, not a wallet: the same card, quiet grey — no colour light — with what was
// paid to reps big and one short line saying what it is.
function RecordWalletCard({ account, hidden, onToggleHide, onOpen }) {
  return (
    <button type="button" onClick={onOpen} className={WALLET_FRAME} style={walletStyle(RECORD_TINT)}
      aria-label={`${account.name}: open every payout`}>
      <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-20 -z-10 h-56 w-56 rounded-full"
        style={{ background: 'radial-gradient(closest-side, rgba(255,255,255,.09), transparent)' }} />
      <WalletArcs />
      <WalletTop label={`${account.name} paid`} hidden={hidden} onToggleHide={onToggleHide}
        chip={<span className="shrink-0 rounded-full bg-white/10 px-1.5 py-px text-[9.5px] font-semibold text-white/70">Record only</span>} />
      <div className="-mt-0.5 flex flex-wrap items-center justify-between gap-x-3">
        <p className={`min-w-0 whitespace-nowrap text-[27px] font-bold leading-none tabular-nums text-white/85 ${hidden ? 'tracking-[0.18em]' : ''}`}>
          {hidden ? DOTS : formatCurrency(account.recorded)}
        </p>
        <span className="flex h-11 shrink-0 items-center gap-1 text-[15px] font-semibold text-white/80">
          Payouts <ArrowUpRight className="h-[17px] w-[17px]" strokeWidth={2.4} />
        </span>
      </div>
      <p className="text-[11px] text-white/50" title="Paid to reps from your own pocket — never from an account, never off your profit.">
        Paid to reps from your own pocket.
      </p>
      <p className="mt-auto pt-3.5 text-[10.5px] tracking-wide text-white/40">No money is held here</p>
    </button>
  );
}

function Accounts({ onQuick, onNavigate }) {
  const [addOpen, setAddOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [correctOpen, setCorrectOpen] = useState(false);
  const [viewing, setViewing] = useState(null); // account whose statement is open
  // The eye on any wallet card hides every amount on this tab (remembered on this device only).
  const [hidden, setHidden] = useState(readHideAccounts);
  const toggleHide = () => setHidden((h) => { saveHideAccounts(!h); return !h; });
  const mask = (s) => (hidden ? DOTS : s);
  // Transfers and balance corrections are the owner's (the server refuses staff); staff do not see them.
  const isAdmin = useAuth().user?.role === ROLES.ADMIN;
  const { data: accounts = [], isLoading } = useQuery({ queryKey: ['finance', 'accounts'], queryFn: async () => unwrap(await api.get('/finance/accounts')).data });
  // The newest movements across every account (the Ledger's own list, first eight rows). Under the 'finance'
  // key, so recording income, an expense or a transfer refreshes it with everything else.
  const { data: latest } = useQuery({
    queryKey: ['finance', 'transactions', 'latest'],
    queryFn: async () => unwrap(await api.get('/finance/transactions', { params: { page: 1, limit: 8, sortBy: 'occurredAt', sortDir: 'desc' } })).data,
  });
  if (isLoading) return <PageSpinner />;
  // Wallets hold the money; the Commission account holds a record of money the
  // owner paid out of his own hand. Adding a record into a cash total would
  // claim the business is holding cash it has never held.
  const held = wallets(accounts);
  const records = accounts.filter((a) => a.isCommissionRecord);
  const total = held.reduce((s, a) => s + a.balance, 0);
  // The donut: every account above zero is a slice of what is held above zero. One at or below zero is not a
  // slice, but it is listed under the donut so the list adds up to the total cash position.
  const slices = held.map((a, i) => ({ a, i })).filter(({ a }) => a.balance > 0);
  const above = slices.reduce((s, { a }) => s + a.balance, 0);
  const rest = held.map((a, i) => ({ a, i })).filter(({ a }) => a.balance <= 0); // empty or below zero: not a slice
  // Shares by the largest remainder, so the slices always add up to exactly 100%.
  const shareOf = new Map(sharePercents(slices.map(({ a }) => a.balance), above).map((p, k) => [slices[k].a.id, p]));
  const pctOf = (a) => shareOf.get(a.id) ?? 0;
  // Each account in its brand's colour — the same colour it has on the Overview.
  const rank = brandRank(accounts);
  const unranked = held.filter((a) => !rank.has(a.brandId || 'general'));
  const colourIdx = (a) => (rank.get(a.brandId || 'general') ?? rank.size + unranked.indexOf(a)) % ACCOUNT_HEX.length;

  return (
    <div className="space-y-4">
      {/* Stacked on a phone. Side by side, five buttons that will not shrink
          squeezed the heading into a 90 px column and broke the figure over
          three lines — "TSh 2," / "520," / "000" on the owner's screen. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-white/55">Total cash position</p>
          <p className={`mt-0.5 whitespace-nowrap text-2xl font-bold leading-tight tabular-nums ${total < 0 ? 'text-rose-300' : 'text-foreground'}${hidden ? ' tracking-[0.18em]' : ''}`}>{mask(formatCurrency(total))}</p>
          <p className="mt-0.5 hidden text-[11px] text-white/50 sm:block">What your accounts are holding right now</p>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {isAdmin && <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setTransferOpen(true)}><ArrowLeftRight className="h-3.5 w-3.5" /> Transfer</Button>}
          {isAdmin && <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setCorrectOpen(true)}><Scale className="h-3.5 w-3.5" /> Correct balance</Button>}
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => onQuick('income')}><ArrowDownLeft className="h-3.5 w-3.5" /> Income</Button>
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => onQuick('expense')}><ArrowUpRight className="h-3.5 w-3.5" /> Expense</Button>
          <Button className="px-3 py-1.5 text-xs" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" /> Account</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* The wallets, two to a row, then the record. */}
        <div className="grid grid-cols-1 content-start gap-4 sm:grid-cols-2 xl:col-span-2">
          {held.map((a) => (
            <AccountWalletCard key={a.id} account={a} tint={WALLET_TINT[colourIdx(a)]}
              hex={ACCOUNT_HEX[colourIdx(a)]} light={ACCOUNT_LIGHT[colourIdx(a)]}
              sharePct={a.balance > 0 && above > 0 ? pctOf(a) : null}
              hidden={hidden} onToggleHide={toggleHide} onOpen={() => setViewing(a)} />
          ))}
          {records.map((a) => <RecordWalletCard key={a.id} account={a} hidden={hidden} onToggleHide={toggleHide} onOpen={() => setViewing(a)} />)}
        </div>

        {/* Which pocket holds the money: one big donut, each account in its own colour. */}
        <Panel title="Where the cash sits" sub={round2ui(above) === round2ui(total) ? "Each account's share" : "Each account's share of what is held above zero"}>
          {slices.length ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 sm:flex-row sm:gap-8 xl:flex-col xl:gap-3">
              <div className="relative w-full max-w-[230px] shrink-0">
                <DonutChart data={slices.map(({ a }) => ({ name: a.name, value: a.balance }))} height={210} legend={false}
                  innerRadius={70} outerRadius={100} stroke="none"
                  colors={slices.map(({ a }) => ACCOUNT_HEX[colourIdx(a)])} />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="whitespace-nowrap text-[15px] font-bold tabular-nums text-foreground">{mask(formatCurrency(above))}</span>
                  <span className="mt-0.5 text-[10px] uppercase tracking-wider text-white/50">{round2ui(above) === round2ui(total) ? 'held' : 'above zero'}</span>
                </div>
              </div>
              <ul className="w-full min-w-0 space-y-1 sm:flex-1 xl:flex-none">
                {slices.map(({ a }) => {
                  const Icon = ACCOUNT_ICON[a.type] || Wallet;
                  const hex = ACCOUNT_HEX[colourIdx(a)];
                  const light = ACCOUNT_LIGHT[colourIdx(a)];
                  return (
                    <li key={a.id}>
                      <button type="button" onClick={() => setViewing(a)}
                        className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 text-left text-[13px] transition hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: `${hex}26`, color: light }}>
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1 leading-tight text-muted">{a.name}</span>
                        <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-foreground">{mask(formatCurrency(a.balance))}</span>
                        <span className="w-9 shrink-0 text-right text-[11px] font-semibold tabular-nums" style={{ color: light }}>{pctOf(a)}%</span>
                      </button>
                    </li>
                  );
                })}
                {rest.map(({ a }) => {
                  const Icon = ACCOUNT_ICON[a.type] || Wallet;
                  return (
                    <li key={a.id} className="flex items-center gap-2.5 px-1 py-1 text-[13px]"
                      title={a.balance < 0 ? `${a.name} is below zero — it is not a slice of the donut, but it is counted in the total cash position.` : undefined}>
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-white/40"><Icon className="h-3.5 w-3.5" /></span>
                      <span className="min-w-0 flex-1 leading-tight text-white/50">{a.name}</span>
                      <span className={`shrink-0 whitespace-nowrap font-semibold tabular-nums ${a.balance < 0 ? 'text-rose-300' : 'text-white/60'}`}>{mask(formatCurrency(a.balance))}</span>
                      <span className="w-9 shrink-0 text-right text-[11px] text-faint">—</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center py-10 text-sm text-white/50">No account holds money right now.</div>
          )}
        </Panel>
      </div>

      {/* What just happened to the money: the newest movements across every account, in two columns (newest at
          the top left). A row opens its account's statement; the Ledger has the rest. */}
      <Panel title="Latest movements" sub="Across every account · newest first" link={{ tab: 'ledger', label: 'Ledger' }} onNavigate={onNavigate}>
        {latest?.length ? (
          <ul className="-mx-1 grid grid-cols-1 gap-x-8 lg:grid-flow-col lg:grid-rows-4">
            {latest.map((t, k) => {
              const acc = accounts.find((a) => a.id === t.accountId);
              const idx = acc && !acc.isCommissionRecord ? colourIdx(acc) : null;
              const payout = isPayoutRow(t);
              const tone = payout ? 'text-violet-300' : t.direction === 'IN' ? 'text-emerald-300' : 'text-rose-300';
              const sign = payout ? '' : t.direction === 'IN' ? '+' : '−';
              const what = (payout && t.payee ? `Commission to ${t.payee}` : t.description) || t.category || TXN_TYPE_LABEL[t.type] || t.type;
              return (
                <li key={t.id} className={`border-b border-white/[0.06] last:border-0 ${k === 3 ? 'lg:border-0' : ''}`}>
                  <button type="button" disabled={!acc} onClick={() => acc && setViewing(acc)} title={what}
                    className="flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left transition enabled:cursor-pointer enabled:hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: idx == null ? 'rgba(255,255,255,.35)' : ACCOUNT_LIGHT[idx] }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-foreground">{what}</span>
                      <span className="block truncate text-[11px] text-white/45">
                        {t.account?.name || acc?.name || '—'} · {TXN_TYPE_LABEL[t.type] || t.type} · {formatDate(t.occurredAt)}
                      </span>
                    </span>
                    <span className={`shrink-0 whitespace-nowrap text-[13px] font-semibold tabular-nums ${tone}`}>
                      {hidden ? '•••' : `${sign}${formatCurrency(t.amount)}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-6 text-center text-sm text-white/50">{latest ? 'Nothing has moved through any account yet.' : 'Loading…'}</p>
        )}
      </Panel>

      {addOpen && <AddAccountModal onClose={() => setAddOpen(false)} />}
      {transferOpen && <TransferModal accounts={accounts} onClose={() => setTransferOpen(false)} />}
      {correctOpen && <CorrectBalanceModal accounts={accounts} onClose={() => setCorrectOpen(false)} />}
      {viewing && <AccountStatementModal account={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

// ── Transactions / Expenses tab ───────────────────────────────────────────────
function Ledger({ expensesOnly }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null); // transaction being corrected
  const [account, setAccount] = useState('');
  const [type, setType] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');      // what has been searched
  const [searchDraft, setSearchDraft] = useState(''); // what is being typed
  const { data: accounts = [] } = useQuery({ queryKey: ['finance', 'accounts'], queryFn: async () => unwrap(await api.get('/finance/accounts')).data });
  const { data: brands = [] } = useQuery({ queryKey: ['brands', 'all'], queryFn: async () => unwrap(await api.get('/brands', { params: { limit: 50 } })).data });
  const params = { page, limit: 25, accountId: account || undefined, brandId: brand || undefined, category: category || undefined, search: search || undefined };
  // Only genuine expenses. Filtering on direction alone swept in account
  // transfers, stock purchases and commission payouts, so "Spent in this
  // view" reported money that was not spent and contradicted the Overview.
  if (expensesOnly) { params.direction = 'OUT'; params.type = 'EXPENSE'; }
  else if (type) params.type = type;
  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'transactions', { page, account, type, brand, category, search, expensesOnly }],
    queryFn: async () => unwrap(await api.get('/finance/transactions', { params })),
  });
  const del = useMutation({
    mutationFn: (id) => api.delete(`/finance/transactions/${id}`, { data: { reason: 'Removed from finance ledger' } }),
    onSuccess: () => { toast.success('Transaction deleted'); invalidateFinance(qc); },
    onError: (e) => toast.error(apiError(e)),
  });
  const rows = data?.data || [];
  const sums = data?.meta?.sums;
  const byCategory = data?.meta?.byCategory || [];

  const count = data?.meta?.total ?? 0;
  return (
    <div className="space-y-4">
      {!expensesOnly && (
        <div>
          <h2 className="text-xl font-bold text-foreground">The Ledger</h2>
          <p className="mt-0.5 text-sm text-muted">
            Every movement of money — settlements collected, stock paid for, transfers between accounts — with its account and what it was for.
          </p>
        </div>
      )}

      {/* Find a movement by anything a person remembers about it. */}
      <form
        onSubmit={(e) => { e.preventDefault(); setSearch(searchDraft.trim()); setPage(1); }}
        className="flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-surface px-4 py-1.5 focus-within:border-brand-500/40"
      >
        <SearchIcon className="h-4 w-4 shrink-0 text-faint" />
        <input
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder="What it was, a reference, a note, a category…"
          className="h-9 min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-faint focus:outline-none"
        />
        {search && (
          <button type="button" onClick={() => { setSearch(''); setSearchDraft(''); setPage(1); }}
            className="cursor-pointer text-xs text-faint hover:text-foreground">Clear</button>
        )}
        <Button type="submit" variant="secondary" className="px-3 py-1.5 text-xs">Search</Button>
      </form>

      {/* What the CURRENT view adds up to — the whole filtered ledger, not
          just the visible page. One joined strip, not separate boxes. */}
      {sums && (
        expensesOnly ? (
          <SegmentStrip size="sm" segments={[
            { label: 'Spent, all filters applied', value: formatCurrency(sums.out), sub: `across ${formatNumber(count)} record${count === 1 ? '' : 's'}`, tone: 'rose' },
            ...byCategory.slice(0, 3).map((c) => ({ label: c.category, value: formatCurrency(c.amount), sub: `${formatNumber(c.count)} record${c.count === 1 ? '' : 's'}`, tone: 'slate' })),
          ]} />
        ) : (
          <SegmentStrip segments={[
            { label: 'Money in', value: formatCurrency(sums.in), sub: 'settlements collected and money moved in', tone: 'emerald' },
            { label: 'Money out', value: formatCurrency(sums.out), sub: 'costs paid and money moved out', tone: 'rose' },
            { label: 'Net', value: formatCurrency(sums.net), sub: `${formatNumber(count)} movement${count === 1 ? '' : 's'}`, tone: sums.net >= 0 ? 'sky' : 'amber' },
            // Listed beside in/out, never inside them. Without it a reader sees
            // payout rows in the list that are in neither total and has no way
            // to tell whether they were counted.
            ...(sums.fromPocket > 0
              ? [{ label: 'Commission you paid', value: formatCurrency(sums.fromPocket), sub: 'your own money — in neither total above', tone: 'violet' }]
              : []),
          ]} />
        )
      )}

      <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <Select className="sm:w-44" value={account} onChange={(e) => { setAccount(e.target.value); setPage(1); }}>
          <option value="">All accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        {!expensesOnly && (
          <Select className="sm:w-48" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            <option value="">All types</option>
            {Object.entries(TXN_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        )}
        <Select className="sm:w-40" value={brand} onChange={(e) => { setBrand(e.target.value); setPage(1); }}>
          <option value="">All brands</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          <option value="none">General (no brand)</option>
        </Select>
        {expensesOnly && byCategory.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => { setCategory(''); setPage(1); }}
              className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition duration-200 ${!category ? 'bg-white/10 text-foreground ring-white/20' : 'text-muted ring-white/10 hover:bg-white/[0.05]'}`}>
              All
            </button>
            {byCategory.slice(0, 6).map((c) => (
              <button key={c.category} type="button" onClick={() => { setCategory(c.category === category ? '' : c.category); setPage(1); }}
                className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition duration-200 ${category === c.category ? 'bg-rose-500/15 text-rose-300 ring-rose-500/30' : 'text-muted ring-white/10 hover:bg-white/[0.05]'}`}>
                {c.category} <span className="ml-1 tabular-nums text-faint">{c.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {isLoading ? <PageSpinner /> : !rows.length ? (
        <EmptyState title={expensesOnly ? 'No expenses yet' : 'No transactions yet'} message="Record income or expenses, or approve a settlement." icon={Receipt} />
      ) : (
        <>
          <Table>
            <THead><TR><TH>Date</TH><TH>Type</TH><TH>Brand</TH><TH>Description</TH><TH>Account</TH><TH className="text-right">Amount</TH><TH /></TR></THead>
            <TBody>
              {rows.map((t) => (
                <TR key={t.id}>
                  <TD className="whitespace-nowrap text-faint">{formatDate(t.occurredAt)}</TD>
                  <TD><Badge className={isPayoutRow(t) ? PAYOUT_BADGE : DIR_BADGE[t.direction]}>{TXN_TYPE_LABEL[t.type] || t.type}</Badge></TD>
                  <TD>{t.brandName ? <Badge className="bg-white/[0.08] text-foreground">{t.brandName}</Badge> : <span className="text-faint">—</span>}</TD>
                  <TD className="max-w-[220px] truncate text-foreground">{ledgerLabel(t)}</TD>
                  <TD className="text-muted">{t.account?.name}</TD>
                  {isPayoutRow(t) ? (
                    <TD className="text-right tabular-nums">
                      <div className="font-semibold text-violet-300">{formatCurrency(t.amount)}</div>
                      <div className="text-[10px] font-normal text-faint">from your pocket</div>
                    </TD>
                  ) : (
                    <TD className={`text-right font-semibold tabular-nums ${t.direction === 'IN' ? 'text-emerald-500' : 'text-rose-500'}`}>{t.direction === 'IN' ? '+' : '−'}{formatCurrency(t.amount)}</TD>
                  )}
                  <TD>
                    <div className="flex items-center justify-end gap-2">
                      <button title="Correct this transaction" onClick={() => setEditing(t)} className="text-faint hover:text-brand-600"><Pencil className="h-4 w-4" /></button>
                      {/* Asks first and ignores repeat taps (audit #22): one tap used to delete the row —
                          both legs of a transfer — with nothing to stop a slip of the finger. */}
                      <button
                        title="Delete"
                        disabled={del.isPending}
                        onClick={() => {
                          const what = `${t.txnNumber || 'this entry'} (${formatCurrency(t.amount)})`;
                          const legs = t.type === 'TRANSFER' ? ' Both sides of the transfer will be removed.' : '';
                          if (confirm(`Delete ${what}? This cannot be undone.${legs}`)) del.mutate(t.id);
                        }}
                        className="text-faint hover:text-rose-500 disabled:opacity-40"
                      ><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} totalPages={data.meta?.totalPages} total={data.meta?.total} onChange={setPage} />
        </>
      )}
      {editing && <EditTxnModal txn={editing} accounts={accounts} brands={brands} onClose={() => setEditing(null)} />}
      </Card>
    </div>
  );
}

// Correct a mis-recorded transaction: move it to the right account, fix the
// brand/date/description — with a mandatory reason for the audit trail.
// Amounts on sale-linked money stay locked (the sale document is the truth).
function EditTxnModal({ txn, accounts, brands, onClose }) {
  const qc = useQueryClient();
  const saleLinked = txn.refType === 'Sale';
  const [accountId, setAccountId] = useState(txn.accountId || '');
  const [brandId, setBrandId] = useState(txn.brandId || '');
  const [amount, setAmount] = useState(String(txn.amount ?? ''));
  const [occurredAt, setOccurredAt] = useState(txn.occurredAt ? eatISODate(txn.occurredAt) : '');
  const [description, setDescription] = useState(txn.description || '');
  const [reason, setReason] = useState('');

  // Brand-reserved accounts only accept their own brand's money.
  // Wallets only — plus the row's own account, so a commission row still shows
  // where it is filed instead of an empty box.
  const accountOptions = accounts
    .filter((a) => !a.isCommissionRecord || a.id === txn.accountId)
    .filter((a) => !a.brandId || !brandId || a.brandId === brandId);

  const save = useMutation({
    mutationFn: () => api.put(`/finance/transactions/${txn.id}`, {
      accountId,
      brandId: brandId || null,
      ...(saleLinked ? {} : { amount: Number(amount) }),
      occurredAt,
      description,
      reason,
    }),
    onSuccess: () => { toast.success('Transaction corrected'); invalidateFinance(qc); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Modal open onClose={onClose} title={`Correct ${txn.txnNumber || 'transaction'}`} footer={
      <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={save.isPending} disabled={!accountId || !reason.trim() || !(saleLinked || Number(amount) > 0)} onClick={() => save.mutate()}>Save correction</Button>
      </>
    }>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Account" required hint="Where the money actually is">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {/* A row filed against a retired account has no option of its own:
                  the select would show the FIRST option's name while state
                  still held the old id, so Save looked like it worked and moved
                  nothing. Show where it actually sits, and make it unpickable. */}
              {txn.accountId && !accountOptions.some((a) => a.id === txn.accountId) && (
                <option value={txn.accountId} disabled>
                  {(accounts.find((a) => a.id === txn.accountId) || {}).name || 'Retired account'} — closed, pick a new one
                </option>
              )}
              {accountOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Brand">
            <Select value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              <option value="">General (no brand)</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field label="Amount" hint={saleLinked ? 'Locked — comes from the sale. Recall the sale to change it.' : undefined}>
            <NumberInput min="0" value={amount} disabled={saleLinked} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Date">
            <Input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </Field>
        </div>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Why is this being corrected?" required hint="Saved in the audit log">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Recorded to the wrong account by mistake" />
        </Field>
      </div>
    </Modal>
  );
}

// ── Profit and Cash Flow: the Overview's look ───────────────────────────────
// Nino, 11 Nov 2026: "make them nice too but cooler — keep the well-arranged cards, but the cool style". So the
// same parts as the Overview: the period as one pill switch, one header strip that is the tab's sum, small
// figure tiles, a chart, tidy lists and compact tables. Every figure the old tabs showed is still on them.

// The Overview's period switch.
function PeriodPills({ periods, value, onChange }) {
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-full bg-white/[0.04] p-1 ring-1 ring-inset ring-white/10" role="tablist" aria-label="Period">
      {periods.map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={`shrink-0 cursor-pointer whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold transition sm:px-3.5 sm:text-[13px] ${value === k ? 'bg-white/[0.14] text-foreground shadow-sm' : 'text-muted hover:text-foreground'}`}>{label}</button>
      ))}
    </div>
  );
}

// The left part of a header strip: what the strip is, the period, the window it covers.
function StripTitle({ eyebrow, title, sub }) {
  return (
    <div className="min-w-0">
      <p className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45 sm:block">{eyebrow}</p>
      <p className="text-[15px] font-semibold leading-tight text-foreground sm:mt-1">{title}</p>
      {sub && <p className="mt-0.5 text-[11px] leading-snug text-white/50">{sub}</p>}
    </div>
  );
}

// One label · figure line in a panel. A money figure is never shortened.
function Line({ label, children, tone = 'text-foreground', strong, rule }) {
  return (
    <div className={clsx('flex items-baseline justify-between gap-3', rule && 'border-t border-white/[0.06] pt-1.5')}>
      <span className={clsx('shrink-0 text-[12px]', strong ? 'font-semibold text-foreground' : 'text-white/55')}>{label}</span>
      <span className={clsx('min-w-0 text-right text-[13px] tabular-nums', strong ? 'font-bold' : 'font-semibold', tone)}>{children}</span>
    </div>
  );
}

// A compact table in a panel, edge to edge — the Overview's "Best products" table.
const TH_CLS = 'w-px whitespace-nowrap px-3 py-2 text-right font-semibold';
const TD_NUM = 'whitespace-nowrap px-3 py-2 text-right tabular-nums';

// ── Profit tab (absorbed from the old Profit & Margins page) ─────────────────
const PROFIT_PERIODS = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['all', 'All time']];
// A brand wears the colour it has on the Overview (brandRank, from the page's accounts list — no extra query).

function ProfitTab({ accounts = [] }) {
  const [period, setPeriod] = useState('all');
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'profit-overview', period],
    queryFn: async () => unwrap(await api.get('/reports/profit-overview', { params: { period } })).data,
  });
  const { data: brandStockData } = useQuery({
    queryKey: ['dashboard', 'brands'],
    queryFn: async () => unwrap(await api.get('/dashboard/brands')).data,
  });
  if (isLoading || !data) return <PageSpinner />;
  const stockByBrand = new Map((brandStockData?.brands || []).map((b) => [b.brandId, b]));
  const t = data.totals;

  // Say what window the figures actually cover. With a finance epoch set,
  // "All time" really means "since go-live" — the owner asked "what time?"
  // about a card once already; no figure gets to be vague about its period.
  // One day ("Today") is already in the title, so its range is not repeated under it.
  const windowLabel = period === 'all'
    ? (data.epochAt ? `since ${formatDate(data.epochAt)} — the day finance went live` : 'all recorded sales')
    : data.range && formatDate(data.range.start) !== formatDate(data.range.end) ? `${formatDate(data.range.start)} → ${formatDate(data.range.end)}` : '';
  const now = new Date();
  const periodTitle = {
    today: eatDay(now, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
    week: 'This week',
    month: eatDay(now, { month: 'long', year: 'numeric' }),
    all: 'All time',
  }[period];
  const words = PERIOD_WORDS[period];

  const perBoxKept = (row) => (row.boxes > 0 ? row.contribution / row.boxes : 0);
  const rank = brandRank(accounts, data.byBrand.filter((b) => b.revenue > 0).map((b) => b.brandId));
  const brandHex = (id, i) => ACCOUNT_LIGHT[(rank.get(id) ?? rank.size + i) % ACCOUNT_LIGHT.length];
  // The donut: each brand's share of what the sales earned. A brand that lost money is not a slice; it is
  // listed under the ring.
  const earnedSlices = data.byBrand.map((b, i) => ({ b, i })).filter(({ b }) => b.contribution > 0);
  const earnedPos = earnedSlices.reduce((s, { b }) => s + b.contribution, 0);
  const repTop = Math.max(0, ...data.byRep.map((r) => r.contribution));

  return (
    <div className="space-y-4">
      <PeriodPills periods={PROFIT_PERIODS} value={period} onChange={setPeriod} />

      {/* ── Header strip: the period · sales − goods = gross profit · the margin ring ── */}
      {/* Gross profit IS what the sales earned (the server sends the two as one figure), so it is said once. */}
      <div className="stat-glass grid grid-cols-1 gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5 2xl:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_auto] 2xl:gap-6">
        <StripTitle eyebrow="Profit" title={periodTitle} sub={windowLabel} />

        <div className="order-last grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/[0.07] pt-4 sm:col-span-2 sm:flex sm:items-start sm:justify-between sm:gap-5 2xl:order-none 2xl:col-span-1 2xl:border-l 2xl:border-t-0 2xl:pl-6 2xl:pt-0"
          title="Gross profit = revenue − cost of goods. Rep commission is reported beside it, never taken off: you pay reps yourself.">
          <Term label="Revenue" value={formatCurrency(t.revenue)} tone="text-foreground" dot="bg-sky-400"
            caption={`${formatNumber(t.boxes)} boxes sold`} />
          <Op>−</Op>
          <Term label="Cost of goods" sign="− " value={formatCurrency(t.cost)} tone="text-foreground" dot="bg-rose-400"
            caption="at cost when each box sold" />
          <Op>=</Op>
          <Term label="Gross profit" sign="= " big value={formatCurrency(t.profit)} tone={t.profit >= 0 ? 'text-emerald-300' : 'text-rose-300'} dot="bg-emerald-400"
            caption="mostly back in stock, not cash" />
        </div>

        <div className="flex items-center gap-3 border-t border-white/[0.07] pt-4 sm:border-t-0 sm:pt-0 2xl:border-l 2xl:pl-6"
          title="Out of every 100 shillings sold, what stayed in the business after paying for the boxes.">
          {/* The ring only fills 0–100, so a loss shows a dash, never a "0%" beside a negative figure. */}
          {t.contributionMargin >= 0 ? <Ring pct={t.contributionMargin} label={false} /> : (
            <span className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-rose-300 ring-[5px] ring-inset ring-rose-400/30" aria-hidden="true">−</span>
          )}
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-white/55">Earned on sales</p>
            <p className={`mt-0.5 whitespace-nowrap text-xl font-bold leading-tight tabular-nums ${t.contribution >= 0 ? 'text-foreground' : 'text-rose-300'}`}>{t.contributionMargin}%</p>
            <p className="mt-0.5 text-[11px] text-white/50">margin on every sale</p>
          </div>
        </div>
      </div>

      {/* ── Four small figures: what reps earned, and what the stock on hand could still make ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile whole label="Reps earned" value={formatCurrency(t.commission)} tone="text-amber-300"
          caption="you pay this, not the business" title={`Commission on the boxes settled ${words} — reported, never taken off the profit`} />
        <Tile whole label="Inventory value (cost)" value={formatCurrency(data.inventoryValue.costValue)}
          caption={`${formatNumber(data.inventoryValue.units)} boxes on hand`} title="Every box on hand, at what it cost" />
        <Tile whole label="Potential revenue" value={formatCurrency(data.inventoryValue.potentialRevenue)}
          caption="if all sold at selling price" />
        <Tile whole label="Potential profit" value={formatCurrency(data.inventoryValue.potentialProfit)} tone="text-sky-300"
          caption="before commissions" />
      </div>

      {/* ── What each brand makes · each brand's share ── */}
      {data.byBrand.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel className="lg:col-span-2" title="What each brand makes" sub={`Sales − goods = earned · ${words}`}>
            <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
              {data.byBrand.map((b, i) => {
                const stock = stockByBrand.get(b.brandId);
                const cogsPct = b.revenue > 0 ? Math.min(100, Math.max(0, (b.cost / b.revenue) * 100)) : 0;
                return (
                  <div key={b.brandId} className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="h-2 w-2 shrink-0 self-center rounded-full" style={{ background: brandHex(b.brandId, i) }} />
                      <span className="text-[13px] font-semibold text-foreground">{b.name}</span>
                      <span className="text-[11px] text-faint">{formatNumber(b.boxes)} {b.boxes === 1 ? 'box' : 'boxes'}</span>
                      <span className={`ml-auto whitespace-nowrap text-lg font-bold leading-none tabular-nums ${b.contribution >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}
                        title="earned on sales">{b.contributionMargin}%</span>
                    </div>
                    <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                      <div className="h-full bg-rose-400/45" style={{ width: `${cogsPct}%` }} />
                      <div className="h-full bg-emerald-400" style={{ width: `${Math.max(0, 100 - cogsPct)}%` }} />
                    </div>
                    <div className="mt-2.5 space-y-1">
                      <Line label="Revenue">{formatCurrency(b.revenue)}</Line>
                      <Line label="− Goods" tone="text-muted">{formatCurrency(b.cost)}</Line>
                      <Line label="= Earned" strong rule tone={b.contribution >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{formatCurrency(b.contribution)}</Line>
                    </div>
                    {/* What this brand has made, then what it could still make — money earned, then money waiting. */}
                    {stock && (
                      <div className="mt-3 space-y-1 rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-inset ring-white/[0.05]">
                        <Line label="Still in stock" tone="text-white/60">
                          <span className="text-[11.5px] font-normal">
                            <span className="whitespace-nowrap">{formatNumber(stock.stockUnits)} boxes</span>{' · '}
                            <span className="whitespace-nowrap">{formatCurrency(stock.stockValue)} at cost</span>
                          </span>
                        </Line>
                        <Line label="If it all sells">{formatCurrency(stock.stockRetail)}</Line>
                        <Line label="= Potential profit" strong rule tone={stock.stockPotential > 0 ? 'text-sky-300' : 'text-muted'}>{formatCurrency(stock.stockPotential)}</Line>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="Share by brand" sub={`Of the gross profit · ${words}`}>
            {earnedSlices.length ? (
              <div className="flex flex-1 flex-col justify-center gap-4">
                <div className="relative mx-auto w-full max-w-[180px]">
                  <DonutChart data={earnedSlices.map(({ b }) => ({ name: b.name, value: b.contribution }))} height={160} legend={false}
                    innerRadius={54} outerRadius={76} stroke="none"
                    colors={earnedSlices.map(({ b, i }) => brandHex(b.brandId, i))} />
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-sm font-bold tabular-nums text-foreground">TSh {formatNumber(earnedPos, { compact: true })}</span>
                    <span className="text-[10px] uppercase tracking-wider text-white/50">{round2ui(earnedPos) === round2ui(t.profit) ? 'earned' : 'brands above zero'}</span>
                  </div>
                </div>
                <ul className="space-y-2">
                  {data.byBrand.map((b, i) => {
                    const slice = b.contribution > 0;
                    const revPct = t.revenue > 0 ? Math.round((b.revenue / t.revenue) * 100) : 0;
                    return (
                      <li key={b.brandId} className="text-[13px]">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: slice ? brandHex(b.brandId, i) : 'rgba(255,255,255,0.2)' }} />
                          <span className="min-w-0 flex-1 text-muted">{b.name}</span>
                          <span className={`shrink-0 whitespace-nowrap font-semibold tabular-nums ${b.contribution >= 0 ? 'text-foreground' : 'text-rose-300'}`}>{formatCurrency(b.contribution)}</span>
                          <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-faint">{slice && earnedPos > 0 ? `${Math.round((b.contribution / earnedPos) * 100)}%` : '—'}</span>
                        </div>
                        <p className="ml-4 text-[11px] text-white/45">{revPct}% of the sales · <span className="whitespace-nowrap">reps earned <span className="tabular-nums text-amber-300/90">{formatCurrency(b.commission)}</span></span></p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center py-10 text-sm text-white/50">Nothing earned in this period.</div>
            )}
          </Panel>
        </div>
      )}

      {/* ── Every product · every rep ── */}
      {/* The product names need the width: the table runs full width, and the reps sit beside it, from 1400 px. */}
      <div className="grid grid-cols-1 gap-4 min-[1400px]:grid-cols-3">
        <Panel className="min-[1400px]:col-span-2" title="Every product, one by one" sub={`Best first · ${words}`}>
          {!data.byProduct.length ? (
            <p className="py-6 text-center text-sm text-white/50">No sales in this period.</p>
          ) : (
            <>
              <ul className="-mx-4 -mb-4 divide-y divide-white/[0.05] border-t border-white/[0.06] sm:hidden">
                {data.byProduct.map((p) => (
                  <li key={p.productId} className="px-4 py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 text-[13px] font-medium leading-snug text-foreground">{p.name}</span>
                      <span className={`shrink-0 whitespace-nowrap text-[13px] font-semibold tabular-nums ${p.contribution >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{formatCurrency(p.contribution)}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed tabular-nums text-white/50">
                      <span className="whitespace-nowrap">{formatNumber(p.boxes)} {p.boxes === 1 ? 'box' : 'boxes'}</span>{' · '}
                      <span className="whitespace-nowrap">revenue {formatCurrency(p.revenue)}</span>{' · '}
                      <span className="whitespace-nowrap">goods {formatCurrency(p.cost)}</span>{' · '}
                      <span className="whitespace-nowrap">{formatCurrency(perBoxKept(p))} a box</span>{' · '}
                      <span className="whitespace-nowrap">margin {p.contributionMargin}%</span>
                    </p>
                  </li>
                ))}
              </ul>
              <div className="-mx-4 -mb-4 hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[40rem] text-[13px]">
                  <thead>
                    <tr className="border-y border-white/[0.06] bg-white/[0.025] text-[10.5px] font-semibold uppercase tracking-wider text-white/45">
                      <th className="px-4 py-2 text-left font-semibold">Product</th>
                      <th className={TH_CLS}>Boxes</th>
                      <th className={TH_CLS}>Revenue</th>
                      <th className={TH_CLS}>Goods</th>
                      <th className={TH_CLS}>Earned</th>
                      <th className={TH_CLS} title="Earned per box">Per box</th>
                      <th className={clsx(TH_CLS, 'pr-4')}>Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byProduct.map((p) => (
                      <tr key={p.productId} className="border-b border-white/[0.05] transition last:border-0 hover:bg-white/[0.035]">
                        <td className="px-4 py-2 font-medium leading-snug text-foreground">{p.name}</td>
                        <td className={clsx(TD_NUM, 'text-muted')}>{formatNumber(p.boxes)}</td>
                        <td className={clsx(TD_NUM, 'text-muted')}>{formatCurrency(p.revenue)}</td>
                        <td className={clsx(TD_NUM, 'text-white/45')}>{formatCurrency(p.cost)}</td>
                        <td className={clsx(TD_NUM, 'font-semibold', p.contribution >= 0 ? 'text-emerald-300' : 'text-rose-300')}>{formatCurrency(p.contribution)}</td>
                        <td className={clsx(TD_NUM, 'text-muted')}>{formatCurrency(perBoxKept(p))}</td>
                        <td className={clsx(TD_NUM, 'pr-4 text-muted')}>{p.contributionMargin}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>

        <Panel title="Profit by sales rep" sub={`Settled boxes · ${words}`}>
          {!data.byRep.length ? (
            <p className="py-6 text-center text-sm text-white/50">No rep sales in this period.</p>
          ) : (
            <div className="-mx-1 grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3 min-[1400px]:grid-cols-1">
              {data.byRep.map((r) => (
                <div key={r.salesRepId} className="border-b border-white/[0.06] px-1 py-2.5 last:border-0 sm:border-0 min-[1400px]:border-b min-[1400px]:last:border-0">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">{r.name}</span>
                    <span className="shrink-0 text-[11px] text-faint">{formatNumber(r.boxes)} {r.boxes === 1 ? 'box' : 'boxes'}</span>
                    <span className={`ml-auto shrink-0 whitespace-nowrap text-[13px] font-bold tabular-nums ${r.contribution >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}
                      title="What the business earned on this rep's boxes">{formatCurrency(r.contribution)}</span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full bg-emerald-400/70" style={{ width: `${repTop > 0 ? Math.max(2, (Math.max(0, r.contribution) / repTop) * 100) : 0}%` }} />
                  </div>
                  <p className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] text-white/50">
                    <span className="whitespace-nowrap">sales <span className="tabular-nums text-white/80">{formatCurrency(r.revenue)}</span></span>
                    <span className="whitespace-nowrap" title="What this rep earned">rep <span className="tabular-nums text-amber-300">{formatCurrency(r.commission)}</span></span>
                    <span className="whitespace-nowrap">margin <span className="tabular-nums text-white/80">{r.contributionMargin}%</span></span>
                  </p>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ── Cash Flow tab ─────────────────────────────────────────────────────────────
const CF_PERIODS = [['today', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly'], ['all', 'All time']];
const IN_HEX = ['#34d399', '#38bdf8', '#a78bfa', '#fbbf24', '#f472b6'];
const OUT_HEX = ['#fb7185', '#fbbf24', '#a78bfa', '#38bdf8', '#f472b6'];
// A kind of movement keeps its colour whatever the period and however it ranks (the lists are biggest first);
// the index colours above are only for a kind not named here (his own money is never in these lists).
const TYPE_HEX = {
  SETTLEMENT: '#34d399', WAREHOUSE_SALE: '#38bdf8', INCOME: '#f472b6', ADJUSTMENT: '#a78bfa',
  EXPENSE: '#fb7185', STOCK_PURCHASE: '#fbbf24', COMMISSION_PAYMENT: '#fb923c', TRANSFER: '#94a3b8',
};
// The month table's cells: a little tighter than TH_CLS / TD_NUM on a phone, so four columns of money fit at 390 px.
const CF_TH = 'w-px whitespace-nowrap px-2 py-2 text-right font-semibold sm:px-3';
const CF_TD = 'whitespace-nowrap px-2 py-2 text-right tabular-nums sm:px-3';

// What moved the money, by kind: one joined bar of the shares, then a line per kind.
function KindRows({ rows, total, colours, empty }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-white/50">{empty}</p>;
  return (
    <>
      <div className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-white/[0.06]">
        {rows.map((r, i) => (
          <div key={r.label} className="h-full first:rounded-l-full last:rounded-r-full" title={`${r.label}: ${formatCurrency(r.value)}`}
            style={{ width: `${total > 0 ? Math.max(0.5, (r.value / total) * 100) : 0}%`, background: r.hex || colours[i % colours.length] }} />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {rows.map((r, i) => {
          const pct = total > 0 ? (r.value / total) * 100 : 0;
          return (
            <li key={r.label} className="flex items-center gap-2 text-[13px]">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.hex || colours[i % colours.length] }} />
              <span className="min-w-0 flex-1 text-muted">{r.label}</span>
              {r.count != null && <span className="shrink-0 text-[10.5px] tabular-nums text-faint">{formatNumber(r.count)}×</span>}
              <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-foreground">{formatCurrency(r.value)}</span>
              <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-faint">{pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function CashFlowTab() {
  const [period, setPeriod] = useState('month');
  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'cashflow', period],
    queryFn: async () => unwrap(await api.get('/finance/cashflow', { params: { period } })).data,
  });
  if (isLoading || !data) return <PageSpinner />;

  const inRows = (data.byType || []).filter((r) => r.direction === 'IN').map((r) => ({ label: TXN_TYPE_LABEL[r.type] || r.type, value: r.amount, count: r.count, hex: TYPE_HEX[r.type] }));
  const outRows = (data.byType || []).filter((r) => r.direction === 'OUT').map((r) => ({ label: TXN_TYPE_LABEL[r.type] || r.type, value: r.amount, count: r.count, hex: TYPE_HEX[r.type] }));
  const inTotal = inRows.reduce((a, r) => a + r.value, 0);
  const outTotal = outRows.reduce((a, r) => a + r.value, 0);
  const series = data.series || [];
  const hasSeries = series.some((m) => m.moneyIn > 0 || m.moneyOut > 0);
  const sixIn = series.reduce((s, m) => s + m.moneyIn, 0);
  const sixOut = series.reduce((s, m) => s + m.moneyOut, 0);
  const sixNet = series.reduce((s, m) => s + (m.net ?? (m.moneyIn - m.moneyOut)), 0);

  // The owner's own money moves balances without being trade. Shown on its own so the closing balance still
  // adds up to the real cash. Same two parts as the Overview, so the two tabs cannot disagree about how much of
  // his own money is in.
  const o = data.owner || {};
  const showOwner = (data.ownerNet ?? 0) !== 0 || (o.commissionFromPocket ?? 0) !== 0;
  const ownerPutIn = Number(o.putIn || 0) - Number(o.drawn || 0);
  // The parts add up to the figure above them: put in through an account + paid by hand − taken out.
  const intoAcc = Number(o.intoAccounts || 0);
  const byHand = Number(o.commissionFromPocket || 0);
  const drawn = Number(o.drawn || 0);
  const ownerParts = byHand > 0 && (intoAcc > 0 || drawn > 0)
    ? [intoAcc > 0 && `${formatCurrency(intoAcc)} put in`, `${formatCurrency(byHand)} by hand`, drawn > 0 && `${formatCurrency(drawn)} taken out`].filter(Boolean)
    : byHand > 0
      ? ['all of it commission paid by hand']
      : [(data.ownerNet ?? 0) >= 0 ? 'you put in' : 'you took out'];

  const now = new Date();
  const periodTitle = {
    today: eatDay(now, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
    week: 'This week',
    month: eatDay(now, { month: 'long', year: 'numeric' }),
    year: eatDay(now, { year: 'numeric' }),
    all: 'All time',
  }[period];
  const day = (v) => eatDay(v, { day: 'numeric', month: 'short', year: 'numeric' });
  // One day ("Daily") is already in the title, so its range is not repeated under it.
  const periodSub = !data.range ? 'everything recorded so far'
    : day(data.range.start) === day(data.range.end) ? '' : `${day(data.range.start)} → ${day(data.range.end)}`;
  const ownerNet = data.ownerNet ?? 0;
  // Four terms run in one line from lg; the fifth (his own money) needs xl.
  const sumWide = ownerNet !== 0 ? true : 'lg';

  return (
    <div className="space-y-4">
      <PeriodPills periods={CF_PERIODS} value={period} onChange={setPeriod} />

      {/* ── Header strip: opening + in − out (± yours) = closing, and his own money ── */}
      {/* The four figures and the line that joined them are one sum now: each figure once. */}
      <div className="stat-glass grid grid-cols-1 gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
        <StripTitle eyebrow="Cash flow" title={periodTitle} sub={periodSub} />

        {showOwner ? (
          <div className="flex items-center gap-3 border-t border-white/[0.07] pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0"
            title="Everything of yours that went in, however it went: cash through an account, and commission you handed to reps. Only the first moves a balance.">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sky-300"><Coins className="h-4 w-4" /></span>
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-white/55">Your own money</p>
              <p className="mt-0.5 whitespace-nowrap text-lg font-bold leading-tight tabular-nums text-sky-300">{formatCurrency(ownerPutIn !== 0 ? ownerPutIn : data.ownerNet)}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-white/50">
                {ownerParts.map((x, i) => <span key={i} className="block whitespace-nowrap">{x}</span>)}
              </p>
            </div>
          </div>
        ) : <div className="hidden sm:block" />}

        <div className={clsx('grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/[0.07] pt-4 sm:col-span-2',
          ownerNet !== 0 ? 'sm:grid-cols-3 xl:flex xl:items-start xl:justify-between xl:gap-4' : 'lg:flex lg:items-start lg:justify-between lg:gap-4')}>
          <Term wide={sumWide} label="Opening balance" value={formatCurrency(data.openingBalance)} tone="text-foreground" dot="bg-white/40" caption="at period start" />
          <Op wide={sumWide}>+</Op>
          <Term wide={sumWide} label="Money in" sign="+ " value={formatCurrency(data.moneyIn)} tone="text-emerald-300" dot="bg-emerald-400" caption="the business collected" />
          <Op wide={sumWide}>−</Op>
          <Term wide={sumWide} label="Money out" sign="− " value={formatCurrency(data.moneyOut)} tone="text-rose-300" dot="bg-rose-400" caption="the business paid" />
          {ownerNet !== 0 && (
            <>
              <Op wide>{ownerNet >= 0 ? '+' : '−'}</Op>
              {/* The block above leads with everything he has put in; the sum can only use the part that moved a
                  balance (put in − taken out, through an account), or the closing figure stops reconciling. */}
              <Term wide label="Yours, net through an account" sign={ownerNet >= 0 ? '+ ' : '− '} value={formatCurrency(Math.abs(ownerNet))} tone="text-sky-300" dot="bg-sky-400"
                caption={ownerNet >= 0 ? 'you put in' : 'you took out'} />
            </>
          )}
          <Op wide={sumWide}>=</Op>
          <Term wide={sumWide} big label="Closing balance" sign="= " value={formatCurrency(data.closingBalance)} tone={data.closingBalance >= 0 ? 'text-foreground' : 'text-rose-300'} dot="bg-white/70"
            caption="what the accounts hold" />
        </div>
      </div>

      {/* ── Six months: the chart, and the months as numbers ── */}
      {/* Five columns from xl: the table gets two, so its money always fits (it needs about 360 px). */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Panel className="xl:col-span-3" title="The money, in motion" sub={(
            <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span>The last six months</span>
              <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />In</span>
              <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-rose-400" />Out</span>
            </span>
          )}>
          {hasSeries ? (
            <div className="-ml-2 flex-1">
              <TrendChart data={series} height={250}
                series={[{ key: 'moneyIn', name: 'Money in', color: '#34d399' }, { key: 'moneyOut', name: 'Money out', color: '#fb7185' }]} />
            </div>
          ) : (
            <div className="flex h-[200px] items-center justify-center text-sm text-white/50">The trend fills in as months of activity add up.</div>
          )}
        </Panel>

        <Panel className="xl:col-span-2" title="The six months" sub="In, out and what was left · TSh">
          {hasSeries ? (
            <div className="-mx-4 -mb-4 flex flex-1 flex-col overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-y border-white/[0.06] bg-white/[0.025] text-[10.5px] font-semibold uppercase tracking-wider text-white/45">
                    <th className="px-3 py-2 text-left font-semibold sm:px-4">Month</th>
                    <th className={CF_TH}>In</th>
                    <th className={CF_TH}>Out</th>
                    <th className={clsx(CF_TH, 'pr-3 sm:pr-4')}>Left</th>
                  </tr>
                </thead>
                <tbody>
                  {series.map((m) => {
                    const net = m.net ?? (m.moneyIn - m.moneyOut);
                    return (
                      <tr key={m.period} className="border-b border-white/[0.05] transition hover:bg-white/[0.035]">
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-foreground sm:px-4">{m.period}</td>
                        <td className={clsx(CF_TD, 'text-emerald-300/90')}>{formatNumber(m.moneyIn)}</td>
                        <td className={clsx(CF_TD, 'text-rose-300/90')}>{formatNumber(m.moneyOut)}</td>
                        <td className={clsx(CF_TD, 'pr-3 font-semibold sm:pr-4', net < 0 ? 'text-rose-300' : 'text-foreground')}>{formatNumber(net)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="text-[12.5px]" title="The six months together. Your own money put in or taken out is not counted here.">
                    <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-foreground sm:px-4">Six months</td>
                    <td className={clsx(CF_TD, 'font-semibold text-emerald-300')}>{formatNumber(sixIn)}</td>
                    <td className={clsx(CF_TD, 'font-semibold text-rose-300')}>{formatNumber(sixOut)}</td>
                    <td className={clsx(CF_TD, 'pr-3 font-bold sm:pr-4', sixNet < 0 ? 'text-rose-300' : 'text-foreground')}>{formatNumber(sixNet)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center py-10 text-sm text-white/50">No month has money yet.</div>
          )}
        </Panel>
      </div>

      {/* ── WHAT moved the money — the strip above only says how much ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Where it came from" sub="Every shilling in, by kind"
          aside={inRows.length > 0 && <span className="shrink-0 whitespace-nowrap text-sm font-bold tabular-nums text-emerald-300">{formatCurrency(inTotal)}</span>}>
          <KindRows rows={inRows} total={inTotal} colours={IN_HEX} empty="No money came in during this period." />
        </Panel>
        <Panel title="Where it went" sub="Every shilling out, by kind"
          aside={outRows.length > 0 && <span className="shrink-0 whitespace-nowrap text-sm font-bold tabular-nums text-rose-300">{formatCurrency(outTotal)}</span>}>
          <KindRows rows={outRows} total={outTotal} colours={OUT_HEX} empty="No money went out during this period." />
        </Panel>
      </div>
    </div>
  );
}

// ── Suppliers tab (accounts payable) ─────────────────────────────────────────
function AddSupplierModal({ onClose }) {
  const qc = useQueryClient();
  const { data: brands = [] } = useQuery({
    queryKey: ['brands', 'all'],
    queryFn: async () => unwrap(await api.get('/brands', { params: { limit: 50 } })).data,
  });
  const [form, setForm] = useState({ name: '', country: 'China', brandId: '', contactName: '', phone: '', email: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => api.post('/suppliers', {
      name: form.name.trim(), country: form.country.trim() || undefined,
      brandId: form.brandId || undefined,
      contactName: form.contactName.trim() || undefined, phone: form.phone.trim() || undefined, email: form.email.trim() || undefined,
    }),
    onSuccess: () => { toast.success('Supplier added'); invalidateFinance(qc); qc.invalidateQueries({ queryKey: ['suppliers'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="New supplier"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>Add supplier</Button></>}>
      <div className="space-y-4">
        <Field label="Supplier name" required><Input value={form.name} onChange={set('name')} placeholder="e.g. Guangzhou Paper Co." autoFocus /></Field>
        <Field label="Brand" hint="Payments to this supplier count against this brand's books">
          <Select value={form.brandId} onChange={set('brandId')}>
            <option value="">General (no brand)</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Country"><Input value={form.country} onChange={set('country')} /></Field>
        <Field label="Contact person"><Input value={form.contactName} onChange={set('contactName')} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={set('email')} /></Field>
      </div>
    </Modal>
  );
}

function PaySupplierModal({ order, accounts: all, onClose, onDone }) {
  const accounts = wallets(all);
  const [accountId, setAccountId] = useState(accounts.find((a) => a.isDefault)?.id || accounts[0]?.id || '');
  const [amount, setAmount] = useState(String(order.outstanding || ''));
  // Money that moved weeks ago belongs in the week it moved. Without this the
  // payment landed on the day it was typed, which put a September purchase's
  // cash into October and left both months wrong.
  const [occurredAt, setOccurredAt] = useState(eatISODate());
  const [notes, setNotes] = useState('');
  const pay = useMutation({
    mutationFn: () => api.post('/finance/supplier-payments', {
      purchaseOrderId: order.id, accountId, amount: Number(amount), occurredAt, notes: notes.trim() || undefined,
    }),
    onSuccess: () => { toast.success('Supplier payment recorded'); onDone(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const amt = Number(amount);
  const valid = accountId && amt > 0 && amt <= order.outstanding + 0.001;
  return (
    <Modal open onClose={onClose} title={`Pay supplier · ${order.poNumber}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={pay.isPending} disabled={!valid} onClick={() => pay.mutate()}><Wallet className="h-4 w-4" /> Record payment</Button></>}>
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-muted">
          Order total {formatCurrency(order.totalCost)} · paid {formatCurrency(order.paid)} · <b className="text-rose-400">outstanding {formatCurrency(order.outstanding)}</b>
        </div>
        <Field label="Amount (TZS)" required error={amt > order.outstanding + 0.001 ? 'More than what is outstanding' : undefined}>
          <NumberInput min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Paid from account" required>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} — {formatCurrency(a.balance)}</option>)}
            </Select>
          </Field>
          <Field label="Date paid" hint="The day the money actually left">
            <Input type="date" value={occurredAt} max={eatISODate()}
              onChange={(e) => setOccurredAt(e.target.value)} />
          </Field>
        </div>
        <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

// Pay down the supplier's overall balance (installments) from any account.
function PayBalanceModal({ supplier, outstanding, accounts: all, onClose, onDone }) {
  const accounts = wallets(all);
  const [accountId, setAccountId] = useState(accounts.find((a) => a.isDefault)?.id || accounts[0]?.id || '');
  const [amount, setAmount] = useState(String(outstanding || ''));
  const [occurredAt, setOccurredAt] = useState(eatISODate());
  const [notes, setNotes] = useState('');
  const pay = useMutation({
    mutationFn: () => api.post(`/finance/suppliers/${supplier.id}/pay`, {
      accountId, amount: Number(amount), occurredAt, notes: notes.trim() || undefined,
    }),
    onSuccess: () => { toast.success('Supplier payment recorded'); onDone(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const amt = Number(amount);
  const valid = accountId && amt > 0 && amt <= outstanding + 0.001;
  return (
    <Modal open onClose={onClose} title={`Pay ${supplier.name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={pay.isPending} disabled={!valid} onClick={() => pay.mutate()}><Wallet className="h-4 w-4" /> Record payment</Button></>}>
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-muted">
          You currently owe {supplier.name} <b className="text-rose-400">{formatCurrency(outstanding)}</b>. Partial payments are fine — pay in installments until it reaches zero.
        </div>
        <Field label="Amount (TZS)" required error={amt > outstanding + 0.001 ? 'More than you owe' : undefined}>
          <NumberInput min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label="Paid from account" required>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} — {formatCurrency(a.balance)}</option>)}
          </Select>
        </Field>
        <Field label="Date"><Input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} /></Field>
        <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

// Record receiving stock from a supplier: creates + receives the purchase in
// one step — inventory goes up, the supplier's balance (what you owe) goes up.
// No payment happens here; pay later in installments.
function NewPurchaseModal({ supplier, accounts: all = [], onClose, onDone }) {
  const { data: products = [], isLoading: productsLoading } = useProducts();
  // Only to name where the boxes land: the request names no warehouse and the server receives into the primary.
  const { data: warehouses = [] } = useWarehouses();
  const into = primaryWarehouse(warehouses);
  const accounts = wallets(all);
  // Every product of this supplier's brand, each with a  −  boxes  +  and its cost per box filled in from the
  // buying price (still editable) — the quick list from Record a sale, no "Add product" and no select.
  const supplierBrand = supplier.brandId || null;
  const rows = useMemo(() => pickerRows(products, { brandId: supplierBrand || undefined }), [products, supplierBrand]);
  const [qty, setQty] = useState({});
  const [cost, setCost] = useState({});
  const [extras, setExtras] = useState(false);
  const [shippingCost, setShippingCost] = useState('');
  const [otherCost, setOtherCost] = useState('');
  const [date, setDate] = useState(eatISODate());
  const [notes, setNotes] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const sending = useRef(false);
  // Stock bought with the cash in the drawer used to be recorded as a debt and
  // nothing else, and the money then left the books on whatever day somebody
  // came back to pay it off. So the form asks here, while the person who paid
  // is still the one typing.
  const [paidNow, setPaidNow] = useState(false);
  const [payAccountId, setPayAccountId] = useState(accounts.find((a) => a.isDefault)?.id || accounts[0]?.id || '');
  const [payAmount, setPayAmount] = useState('');

  // The picked lines, as the old form held them: boxes and the cost per box.
  const lines = rows
    .filter((r) => Number(qty[r.key]) > 0)
    .map((r) => ({ productId: r.id, packagingUnitId: r.packagingUnitId, quantity: qty[r.key], unitCost: lineCost(cost, r) }));
  const boxes = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);

  const goods = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);
  const total = goods + (Number(shippingCost) || 0) + (Number(otherCost) || 0);
  const validLines = lines.filter((l) => l.productId && Number(l.quantity) > 0 && Number(l.unitCost) >= 0);
  // Empty means the whole bill — the common case, and it follows the total as
  // the lines change instead of going stale at whatever it was first.
  const paying = payAmount === '' ? total : Number(payAmount) || 0;
  const overpaid = paidNow && paying > total + 0.001;
  const valid = validLines.length > 0 && (!paidNow || (payAccountId && paying > 0 && !overpaid));

  // The purchase once it is saved. Saving and receiving are two calls; if the receive fails, pressing
  // Save again must only retry the receive — it used to create the whole purchase (and its payment) a
  // second time, doubling what the supplier is owed (audit #20).
  const createdPo = useRef(null);
  const save = useMutation({
    mutationFn: async () => {
      let po = createdPo.current;
      if (!po) {
        const items = validLines.map((l) => (
          { productId: l.productId, packagingUnitId: l.packagingUnitId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) }
        ));
        po = unwrap(await api.post('/purchase-orders', {
          supplierId: supplier.id, currency: 'TZS', items,
          shippingCost: Number(shippingCost) || 0, otherCost: Number(otherCost) || 0,
          orderedAt: new Date(`${date}T12:00:00`).toISOString(), notes: notes.trim() || undefined,
          // Paid as it was bought: the money leaves the account on the purchase
          // date, not the day this was typed in.
          payment: paidNow ? { accountId: payAccountId, amount: paying, occurredAt: date } : undefined,
        })).data;
        createdPo.current = po;
      }
      try {
        await api.post(`/purchase-orders/${po.id}/receive`, { actualArrival: new Date(`${date}T12:00:00`).toISOString() });
      } catch (e) {
        // A receive that went through but whose answer was lost comes back as "already received".
        if (e?.response?.status !== 409) {
          const err = new Error(`${po.poNumber} is saved but not received yet — ${apiError(e)} Press Save again to receive it.`);
          throw err;
        }
      }
      return po;
    },
    onSuccess: (po) => {
      const left = round2ui(total - (paidNow ? paying : 0));
      toast.success(
        !paidNow
          ? `Purchase ${po.poNumber} received — stock added, you now owe ${supplier.name} ${formatCurrency(total)} more`
          : left > 0
            ? `Purchase ${po.poNumber} received — ${formatCurrency(paying)} paid, ${formatCurrency(left)} still owed to ${supplier.name}`
            : `Purchase ${po.poNumber} received and paid in full — nothing owed to ${supplier.name} for it`,
      );
      onDone(); onClose();
    },
    onError: (e) => toast.error(e?.response ? apiError(e) : e.message),
  });

  // One purchase per press, however fast the taps come.
  const submit = () => {
    if (sending.current || save.isPending || !valid) return;
    sending.current = true;
    save.mutate(undefined, { onSettled: () => { sending.current = false; } });
  };
  const requestClose = () => {
    if (save.isPending) return;
    if (lines.length === 0 || confirmDiscard) onClose(); else setConfirmDiscard(true);
  };
  const pick = (next) => { setQty(next); setConfirmDiscard(false); };
  // The toggle only shows or hides the costs: closing it never changes a figure, and the closed toggle shows their sum.
  const toggleExtras = () => setExtras((x) => !x);
  const extraSum = (Number(shippingCost) || 0) + (Number(otherCost) || 0);
  // What the money side will be, in the footer, so it is never a screen away from the button.
  const payFrom = accounts.find((a) => a.id === payAccountId);
  const owedAfter = round2ui(total - (paidNow ? paying : 0));
  const moneyLine = !paidNow ? `You will owe ${supplier.name} ${formatCurrency(total)} more`
    : overpaid ? 'More paid than this purchase cost'
      : owedAfter > 0 ? `Paid ${formatCurrency(paying)}${payFrom ? ` from ${payFrom.name}` : ''} · ${formatCurrency(owedAfter)} still owed`
        : `Paid in full${payFrom ? ` from ${payFrom.name}` : ''}`;

  return (
    <Modal open onClose={requestClose} size="lg" title={`New purchase from ${supplier.name}`}
      footer={confirmDiscard ? (
        <DiscardFooter what="purchase" detail={`${formatNumber(boxes)} ${boxes === 1 ? 'box' : 'boxes'} picked will be lost.`} onDiscard={onClose} onKeep={() => setConfirmDiscard(false)} />
      ) : (
        <>
          <div className="mr-auto min-w-0 flex-1 basis-0 text-sm">
            {lines.length === 0 ? <span className="text-muted">Tap + on what you bought</span> : (
              <>
                <div className="truncate"><span className="text-muted">Total</span> <b className="tabular-nums">{formatCurrency(total)}</b></div>
                <div className={clsx('truncate text-xs', paidNow && overpaid ? 'text-rose-300' : 'text-muted')}>{moneyLine}</div>
              </>
            )}
          </div>
          <Button variant="secondary" className="hidden sm:inline-flex" onClick={requestClose}>Cancel</Button>
          <Button data-picker-submit="" className="h-12 w-full text-base sm:h-auto sm:w-auto sm:text-sm" loading={save.isPending} disabled={!valid} onClick={submit}>
            <Package className="h-4 w-4" />
            {boxes > 0 ? `Receive ${formatNumber(boxes)} ${boxes === 1 ? 'box' : 'boxes'}${into ? ` into ${buttonPlace(into.name)}` : ''}` : 'Receive stock'}
          </Button>
        </>
      )}>
      <div className="space-y-2.5 sm:space-y-4 max-sm:min-h-[calc(100dvh_-_17rem)]">
        <p className="rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-muted">
          Stock from {supplier.name} goes into {into ? shortPlace(into.name) : 'the main warehouse'} now, and what you owe them goes up — unless you tick below that you paid.
        </p>
        <ProductPicker rows={rows} value={qty} onChange={pick} cost={cost} onCost={(key, v) => setCost((c) => ({ ...c, [key]: v }))}
          loading={productsLoading} emptyText={supplierBrand ? 'No products of this supplier’s brand yet.' : 'No products yet.'} />
        <div className="space-y-3">
          <MoreToggle open={extras} onToggle={toggleExtras}>
            Extra costs (shipping, other){!extras && extraSum > 0 ? ` · ${formatCurrency(extraSum)}` : ''}
          </MoreToggle>
          {extras && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Shipping / transport (TZS)"><NumberInput min="0" value={shippingCost} onChange={(e) => setShippingCost(e.target.value)} placeholder="0" /></Field>
              <Field label="Other costs (TZS)"><NumberInput min="0" value={otherCost} onChange={(e) => setOtherCost(e.target.value)} placeholder="0" /></Field>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Purchase date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>
        </div>

        {/* Paid, or owed. The question is asked here because this is where the
            person who handed over the money is standing. */}
        <div className={clsx('rounded-xl border p-3 transition', paidNow ? 'border-brand-500/40 bg-brand-500/[0.07]' : 'border-border bg-elevated')}>
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
              checked={paidNow}
              onChange={(e) => setPaidNow(e.target.checked)}
              disabled={!accounts.length}
            />
            <span>
              <span className="block text-sm font-medium text-foreground">I paid for this</span>
              <span className="block text-xs text-muted">
                {accounts.length
                  ? `Money out on ${formatDate(date)}. Leave it unticked if ${supplier.name} is being paid later.`
                  : 'No account to pay from — add one under Accounts first.'}
              </span>
            </span>
          </label>

          {paidNow && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Paid from account" required>
                <Select value={payAccountId} onChange={(e) => setPayAccountId(e.target.value)}>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} — {formatCurrency(a.balance)}</option>)}
                </Select>
              </Field>
              <Field
                label="Amount paid (TZS)"
                error={overpaid ? 'More than this purchase cost'
                  : (payAmount !== '' && paying <= 0) ? 'Untick "I paid for this" if nothing was paid'
                    : undefined}
              >
                <NumberInput min="0" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder={String(total || 0)} />
              </Field>
              <p className="sm:col-span-2 text-xs text-faint">
                {overpaid
                  ? `This purchase is ${formatCurrency(total)}.`
                  : paying >= total - 0.001
                    ? `Paid in full — nothing will be owed for this purchase.`
                    : `${formatCurrency(round2ui(total - paying))} will stay owed to ${supplier.name}.`}
              </p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function SupplierDetailModal({ supplierId, accounts, onClose }) {
  const qc = useQueryClient();
  const [paying, setPaying] = useState(null); // PO row being paid
  const [payingBalance, setPayingBalance] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [returning, setReturning] = useState(false);
  const isAdmin = useAuth().user?.role === ROLES.ADMIN; // returning goods lowers a bill: owner only, as on the server
  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'supplier', supplierId],
    queryFn: async () => unwrap(await api.get(`/finance/suppliers/${supplierId}`)).data,
  });
  const refresh = () => {
    invalidateFinance(qc);
    qc.invalidateQueries({ queryKey: ['inventory'] });
    qc.invalidateQueries({ queryKey: ['purchase-orders'] });
  };
  const s = data?.supplier;
  return (
    <>
      <Modal open onClose={onClose} size="xl" title={s ? s.name : 'Supplier'}
        footer={data && (
          <>
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button variant="secondary" onClick={() => setPurchasing(true)}><Package className="h-4 w-4" /> New purchase</Button>
            {isAdmin && data.totals.outstanding > 0 && (
              <Button variant="secondary" onClick={() => setReturning(true)}><Undo2 className="h-4 w-4" /> Return goods</Button>
            )}
            {data.totals.outstanding > 0 && (
              <Button onClick={() => setPayingBalance(true)}><Wallet className="h-4 w-4" /> Pay supplier</Button>
            )}
          </>
        )}>
        {isLoading || !data ? <PageSpinner /> : (
          <div className="space-y-5">
            {/* Identity */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
              {s.brandName && <Badge className="bg-white/[0.08] text-foreground">{s.brandName}</Badge>}
              {s.country && <span>{s.country}</span>}
              {s.contactName && <span>{s.contactName}</span>}
              {s.phone && <span>{s.phone}</span>}
              {s.email && <span>{s.email}</span>}
            </div>

            {/* Balances */}
            {/* Returned sits between what was bought and what was paid, because
                that is where it acts: it comes off the purchases. It only
                appears when there is something to show, so a supplier who has
                never had goods back looks exactly as it did. */}
            <div className={`grid gap-3 ${data.totals.returned > 0 ? 'grid-cols-4' : 'grid-cols-3'}`}>
              <Money label="Total purchased" value={data.totals.purchased} />
              {data.totals.returned > 0 && <Money label="Goods returned" value={data.totals.returned} tone="amber" />}
              <Money label="Total paid" value={data.totals.paid} tone="emerald" />
              <Money label="Balance owed" value={data.totals.outstanding} tone={data.totals.outstanding > 0 ? 'rose' : 'emerald'} big />
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-faint">
              {data.lastPurchase && <span>Last purchase {formatDate(data.lastPurchase)}</span>}
              {data.lastPayment && <span>Last payment {formatDate(data.lastPayment)}</span>}
              {data.productsPurchased.length > 0 && <span>Supplies: {data.productsPurchased.join(', ')}</span>}
            </div>

            {/* Purchases */}
            <div>
              <div className="mb-2 text-sm font-semibold text-foreground">Purchase history</div>
              {!data.orders.length ? <p className="text-sm text-faint">No purchases yet — use "New purchase" when stock arrives from {s.name}.</p> : (
                <Table>
                  <THead><TR><TH>PO</TH><TH>Date</TH><TH>Boxes</TH><TH>Total</TH><TH>Paid</TH><TH>Outstanding</TH><TH /></TR></THead>
                  <TBody>
                    {data.orders.map((o) => (
                      <TR key={o.id}>
                        <TD className="font-medium">{o.poNumber}</TD>
                        <TD className="text-faint">{formatDate(o.receivedAt || o.createdAt)}</TD>
                        <TD>{formatNumber(o.boxes)}</TD>
                        <TD>{formatCurrency(o.totalCost)}</TD>
                        <TD className="text-emerald-500">{formatCurrency(o.paid)}</TD>
                        <TD className={o.outstanding > 0 ? 'font-semibold text-rose-400' : 'text-faint'}>{formatCurrency(o.outstanding)}</TD>
                        <TD>
                          {o.outstanding > 0 && (
                            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setPaying(o)}>Pay PO</Button>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </div>

            {/* Payments */}
            <div>
              <div className="mb-2 text-sm font-semibold text-foreground">Payment history</div>
              {!data.payments.length ? <p className="text-sm text-faint">No payments recorded yet.</p> : (
                <ul className="space-y-1 text-sm">
                  {data.payments.map((p) => (
                    <li key={p.id} className="flex justify-between text-muted">
                      <span>{formatDate(p.occurredAt)} · {p.reference || 'Payment'} · {p.account}</span>
                      <span className="font-semibold text-rose-400">−{formatCurrency(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>
      {paying && <PaySupplierModal order={paying} accounts={accounts} onClose={() => setPaying(null)} onDone={refresh} />}
      {payingBalance && s && <PayBalanceModal supplier={s} outstanding={data.totals.outstanding} accounts={accounts} onClose={() => setPayingBalance(false)} onDone={refresh} />}
      {purchasing && s && <NewPurchaseModal supplier={s} accounts={accounts} onClose={() => setPurchasing(false)} onDone={refresh} />}
      {returning && s && <ReturnGoodsModal supplier={s} outstanding={data.totals.outstanding} onClose={() => setReturning(false)} onDone={refresh} />}
    </>
  );
}

// Goods sent back to a supplier. Money only: it comes off the bill, and the
// boxes are corrected through the stock ledger like any other movement — one
// place changes stock, and this is not it.
function ReturnGoodsModal({ supplier, outstanding, onClose, onDone }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const amt = Number(amount) || 0;
  const overBill = amt > outstanding;
  const valid = amt > 0 && !overBill && reason.trim().length > 2;

  const save = useMutation({
    mutationFn: () => api.post(`/finance/suppliers/${supplier.id}/credits`, { amount: amt, reason: reason.trim() }),
    onSuccess: () => { toast.success('Taken off the bill'); onDone?.(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Modal open onClose={onClose} size="sm" title={`Return goods to ${supplier.name}`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
          Take it off the bill
        </Button>
      </>}>
      <div className="space-y-4">
        <div className="rounded-xl bg-elevated/60 px-4 py-3 ring-1 ring-white/[0.07]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">You owe them now</span>
            <span className="text-lg font-bold tabular-nums text-foreground">{formatCurrency(outstanding)}</span>
          </div>
          {amt > 0 && !overBill && (
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">After this</span>
              <span className="text-sm font-semibold tabular-nums text-emerald-400">{formatCurrency(outstanding - amt)}</span>
            </div>
          )}
        </div>

        <Field label="What are the goods worth?">
          <NumberInput min="0" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1776000" />
        </Field>
        {overBill && (
          <p className="text-xs text-rose-400">
            That is more than you owe {supplier.name}. A return bigger than the bill means they owe you money back,
            which is a refund rather than a credit.
          </p>
        )}

        <Field label="What went back?" hint="Kept on the supplier's record.">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. 64 boxes Civlily Pepa Ndogo — wrong filter" />
        </Field>

        <p className="text-xs leading-relaxed text-faint">
          This takes the value off what you owe. It does not say you paid anything, and it does not move stock —
          adjust the boxes in Inventory as usual.
        </p>
      </div>
    </Modal>
  );
}

function SuppliersTab({ accounts }) {
  const [addOpen, setAddOpen] = useState(false);
  const [viewing, setViewing] = useState(null);
  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ['finance', 'suppliers'],
    queryFn: async () => unwrap(await api.get('/finance/suppliers')).data,
  });
  if (isLoading) return <PageSpinner />;
  const totals = suppliers.reduce((s, x) => ({
    purchased: s.purchased + x.totalPurchased,
    returned: s.returned + (x.totalReturned || 0),
    paid: s.paid + x.totalPaid,
    out: s.out + x.outstanding,
  }), { purchased: 0, returned: 0, paid: 0, out: 0 });
  // What the bill actually came to after goods went back. The share paid is
  // measured against this rather than against everything ever ordered —
  // otherwise returning stock quietly makes you look further behind on paying
  // for it than you are.
  const netPurchased = totals.purchased - totals.returned;
  const anyReturns = totals.returned > 0;

  return (
    <div className="space-y-4">
      {/* The returned card only appears once something has gone back, so a
          business that has never returned stock sees the four cards it always
          saw. */}
      <div className={anyReturns ? 'grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5' : 'grid grid-cols-2 gap-3 xl:grid-cols-4'}>
        <TintCard label="Suppliers" value={formatNumber(suppliers.length)} icon={Factory} tone="slate" sub="who you buy from" />
        <TintCard label="Total purchased" value={formatCurrency(totals.purchased)} icon={Package} tone="slate" sub="all stock ever bought" />
        {anyReturns && (
          <TintCard label="Goods returned" value={formatCurrency(totals.returned)} icon={Undo2} tone="amber"
            sub={`bill is ${formatCurrency(netPurchased)} after them`} />
        )}
        <TintCard label="Total paid" value={formatCurrency(totals.paid)} icon={Wallet} tone="emerald"
          sub={netPurchased > 0 ? `${Math.round((totals.paid / netPurchased) * 100)}% of the bill` : 'nothing yet'} />
        <TintCard label="Still owed" value={formatCurrency(totals.out)} icon={Scale} tone={totals.out > 0 ? 'rose' : 'emerald'}
          sub={totals.out > 0 ? 'they are financing your stock' : 'all settled'} />
      </div>
      <Card>
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="text-sm text-faint">Purchases are created in <b>Imports &amp; POs</b>; record payments here.</div>
          <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Supplier</Button>
        </div>
        {!suppliers.length ? <EmptyState title="No suppliers yet" message="Add your suppliers to start tracking purchases and payments." icon={Factory} /> : (
          <Table>
            <THead><TR><TH>Supplier</TH><TH>Brand</TH><TH>Country</TH><TH>Orders</TH><TH>Purchased</TH>{anyReturns && <TH>Returned</TH>}<TH>Paid</TH><TH>Outstanding</TH></TR></THead>
            <TBody>
              {suppliers.map((s) => {
                // Measured against the bill after returns, not against
                // everything ever ordered — otherwise sending stock back makes
                // the bar go backwards on money already paid.
                const billed = s.totalPurchased - (s.totalReturned || 0);
                return (
                <TR key={s.id} className="cursor-pointer" onClick={() => setViewing(s.id)}>
                  <TD className="font-medium text-foreground">
                    {s.name}{s.contactName ? <span className="ml-1.5 text-xs text-faint">· {s.contactName}</span> : null}
                    {/* How much of this supplier's stock is actually paid for. */}
                    {billed > 0 && (
                      <div className="mt-1 h-1 w-28 overflow-hidden rounded-full bg-white/[0.07]">
                        <div className={s.outstanding > 0 ? 'h-full bg-amber-500' : 'h-full bg-emerald-500'}
                          style={{ width: `${Math.min(100, Math.max(2, (s.totalPaid / billed) * 100))}%` }} />
                      </div>
                    )}
                  </TD>
                  <TD>{s.brandName ? <Badge className="bg-white/[0.08] text-foreground">{s.brandName}</Badge> : <span className="text-faint">—</span>}</TD>
                  <TD className="text-muted">{s.country}</TD>
                  <TD>{s.poCount}</TD>
                  <TD>{formatCurrency(s.totalPurchased)}</TD>
                  {anyReturns && (
                    <TD className={s.totalReturned > 0 ? 'text-amber-400' : 'text-faint'}>
                      {s.totalReturned > 0 ? `−${formatCurrency(s.totalReturned)}` : '—'}
                    </TD>
                  )}
                  <TD className="text-emerald-500">{formatCurrency(s.totalPaid)}</TD>
                  <TD className={s.outstanding > 0 ? 'font-semibold text-rose-400' : 'text-faint'}>{formatCurrency(s.outstanding)}</TD>
                </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
      {addOpen && <AddSupplierModal onClose={() => setAddOpen(false)} />}
      {viewing && <SupplierDetailModal supplierId={viewing} accounts={accounts} onClose={() => setViewing(null)} />}
    </div>
  );
}

// ── Reports Archive: the same card view as the owner's profile (components/ReportsArchive) ──
function ArchiveTab() {
  return <ReportsArchive />;
}

// ── Page shell ────────────────────────────────────────────────────────────────
const TABS = [
  ['overview', 'Overview'], ['profit', 'Profit'], ['cashflow', 'Cash Flow'],
  ['suppliers', 'Suppliers'], ['expenses', 'Expenses'], ['accounts', 'Accounts'],
  ['ledger', 'Ledger'], ['commissions', 'Commissions'], ['reports', 'Reports'], ['archive', 'Statements'],
];

export default function Finance() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const [tab, setTabState] = useState(TABS.some(([k]) => k === urlTab) ? urlTab : 'overview');
  const setTab = (k) => { setTabState(k); setSearchParams(k === 'overview' ? {} : { tab: k }, { replace: true }); };
  const [money, setMoney] = useState(null); // 'income' | 'expense'
  const [ownerMoney, setOwnerMoney] = useState(null); // 'in' | 'out'
  const { data: accounts = [] } = useQuery({ queryKey: ['finance', 'accounts'], queryFn: async () => unwrap(await api.get('/finance/accounts')).data });
  const { data: categories = [] } = useQuery({ queryKey: ['finance', 'categories'], queryFn: async () => unwrap(await api.get('/finance/categories')).data });

  return (
    <div>
      <PageHeader title="Finance" subtitle="The accounting department of ZELab — accounts, profit, cash flow, suppliers and reports.">
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setMoney('income')}><ArrowDownLeft className="h-4 w-4" /> Income</Button>
          <Button onClick={() => setMoney('expense')}><ArrowUpRight className="h-4 w-4" /> Expense</Button>
        </div>
      </PageHeader>

      <div className="mb-6 tab-row">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`cursor-pointer rounded-full px-4 py-2 text-sm font-semibold ring-1 transition duration-200 ${tab === k
              ? 'bg-brand-500 text-white ring-brand-500'
              : 'bg-transparent text-muted ring-white/10 hover:bg-white/[0.05] hover:text-foreground'}`}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && <Overview onNavigate={setTab} onOwnerMoney={setOwnerMoney} />}
      {tab === 'profit' && <ProfitTab accounts={accounts} />}
      {tab === 'cashflow' && <CashFlowTab />}
      {tab === 'suppliers' && <SuppliersTab accounts={accounts} />}
      {tab === 'accounts' && <Accounts onQuick={setMoney} onNavigate={setTab} />}
      {tab === 'expenses' && <Ledger expensesOnly />}
      {tab === 'ledger' && <Ledger />}
      {tab === 'commissions' && <CommissionsPage embedded />}
      {tab === 'reports' && <ReportsPage embedded />}
      {tab === 'archive' && <ArchiveTab />}

      {money && <MoneyModal mode={money} accounts={accounts} categories={categories} onClose={() => setMoney(null)} />}
      {ownerMoney && <OwnerMoneyModal mode={ownerMoney} accounts={accounts} onClose={() => setOwnerMoney(null)} />}
    </div>
  );
}
