import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Wallet, TrendingUp, TrendingDown, Banknote, Landmark, Smartphone, Coins,
  Plus, Trash2, Pencil, ArrowLeftRight, ArrowDownLeft, ArrowUpRight, Boxes, Receipt, PiggyBank,
  Factory, Package, Scale, FileBarChart, ChevronRight, ShieldCheck, AlertTriangle, Search as SearchIcon,
} from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { useProducts } from '@/lib/hooks';
import ReportsPage from '@/pages/Reports';
import CommissionsPage from '@/pages/Commissions';
import { formatCurrency, formatNumber, formatDate, formatDateTime } from '@/lib/format';
import { DonutChart, BarChartCard, TrendChart } from '@/components/charts';
import {
  PageHeader, Card, CardHeader, CardBody, StatCard, PageSpinner, EmptyState, Badge, Button,
  Modal, Field, Input, Select, Textarea, Table, THead, TBody, TR, TH, TD, Pagination,
} from '@/components/ui';

const PERIODS = [['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['all', 'All time']];
const ACCOUNT_ICON = { CASH: Banknote, BANK: Landmark, MOBILE_MONEY: Smartphone, OTHER: Wallet };
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
};

// One tinted stat card — the ring/glow/chip language the Inventory and
// Settlements pages settled on. Finance was the last page still on the old
// flat cards.
const TINT = {
  brand: { ring: 'ring-brand-500/25', glow: 'from-brand-500/[0.12]', chip: 'bg-brand-500/15 text-brand-300', num: 'text-brand-300' },
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
    <div className={`relative overflow-hidden rounded-2xl bg-surface p-4 ring-1 ${t.ring}`}>
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${t.glow} to-transparent`} aria-hidden="true" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        {Icon && <span className={`rounded-lg p-1.5 ${t.chip}`}><Icon className="h-3.5 w-3.5" /></span>}
      </div>
      <p className={`relative mt-2 text-2xl font-bold tabular-nums ${t.num}`}>{value}</p>
      {sub && <p className="relative mt-0.5 text-[11px] text-faint">{sub}</p>}
    </div>
  );
}

// A named share of a total: label, amount, thin bar. The list pattern from
// "Who is holding it" / "Who owes what", reused for money by kind.
function ShareRows({ rows, total, colours }) {
  return (
    <div className="mt-4 space-y-2.5">
      {rows.map((r, i) => {
        const pct = total > 0 ? (r.value / total) * 100 : 0;
        return (
          <div key={r.label}>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{r.label}</span>
              {r.count != null && <span className="shrink-0 text-[11px] tabular-nums text-faint">{formatNumber(r.count)}×</span>}
              <span className="w-28 shrink-0 text-right text-sm font-bold tabular-nums text-foreground">{formatCurrency(r.value)}</span>
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-faint">{Math.round(pct)}%</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div className={`h-full rounded-full ${colours[i % colours.length]}`} style={{ width: `${Math.max(2, pct)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// One card, several segments — the joined money strip from the admin the
// owner benchmarks against. Not separate boxes: one container, hairline
// dividers, each segment washed in its own colour, numbers a size up.
const SEG_WASH = {
  emerald: { bg: 'bg-gradient-to-br from-emerald-500/[0.12] via-emerald-500/[0.04] to-transparent', num: 'text-emerald-400' },
  rose: { bg: 'bg-gradient-to-br from-rose-500/[0.12] via-rose-500/[0.04] to-transparent', num: 'text-rose-400' },
  sky: { bg: 'bg-gradient-to-br from-sky-500/[0.12] via-sky-500/[0.04] to-transparent', num: 'text-sky-300' },
  brand: { bg: 'bg-gradient-to-br from-brand-500/[0.12] via-brand-500/[0.04] to-transparent', num: 'text-brand-300' },
  amber: { bg: 'bg-gradient-to-br from-amber-500/[0.12] via-amber-500/[0.04] to-transparent', num: 'text-amber-300' },
  violet: { bg: 'bg-gradient-to-br from-violet-500/[0.12] via-violet-500/[0.04] to-transparent', num: 'text-violet-300' },
  slate: { bg: 'bg-gradient-to-br from-white/[0.04] to-transparent', num: 'text-foreground' },
};
function SegmentStrip({ segments, size = 'lg' }) {
  const numCls = size === 'lg' ? 'text-2xl xl:text-3xl' : 'text-xl';
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-white/[0.08] bg-surface sm:flex sm:divide-x sm:divide-white/[0.06]">
      {segments.map((seg) => {
        const w = SEG_WASH[seg.tone] || SEG_WASH.slate;
        return (
          <div key={seg.label} className={`flex-1 p-5 ${w.bg}`}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{seg.label}</p>
            <p className={`mt-2 font-bold leading-none tabular-nums ${numCls} ${w.num}`}>{seg.value}</p>
            {seg.sub && <p className="mt-1.5 text-xs text-faint">{seg.sub}</p>}
          </div>
        );
      })}
    </div>
  );
}

// Dark-theme badge tints. The old bg-emerald-100/rose-100 were light-theme
// chips glowing on a dark page.
const DIR_BADGE = { IN: 'bg-emerald-500/15 text-emerald-300', OUT: 'bg-rose-500/15 text-rose-300' };

// Default to All time so the dashboard opens showing the full business history.
function usePeriod() { return useState('all'); }

const invalidateFinance = (qc) => ['finance'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

// ── Modals ───────────────────────────────────────────────────────────────────
// Move money between two business accounts (banked cash, corrections). Posts
// a linked OUT+IN pair that shifts balances without touching profit or the
// income/expense reports.
function TransferModal({ accounts, onClose }) {
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
          <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
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
        <Field label="Type"><Select value={form.type} onChange={set('type')}><option value="CASH">Cash</option><option value="BANK">Bank</option><option value="MOBILE_MONEY">Mobile money</option><option value="OTHER">Other</option></Select></Field>
        <Field label="Reserved for brand" hint="Reps only see this account when settling that brand's products">
          <Select value={form.brandId} onChange={set('brandId')}>
            <option value="">Any brand (general)</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Opening balance (TZS)" hint="What's in this account right now"><Input type="number" min="0" value={form.openingBalance} onChange={set('openingBalance')} placeholder="0" /></Field>
        <Field label="Notes"><Textarea rows={2} value={form.notes} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

function MoneyModal({ mode, accounts, categories, onClose }) {
  const qc = useQueryClient();
  const isExpense = mode === 'expense';
  const { data: brands = [] } = useQuery({
    queryKey: ['brands', 'all'],
    queryFn: async () => unwrap(await api.get('/brands', { params: { limit: 50 } })).data,
  });
  const [form, setForm] = useState({
    accountId: accounts.find((a) => a.isDefault)?.id || accounts[0]?.id || '',
    amount: '', category: isExpense ? (categories[0]?.name || '') : '', description: '',
    occurredAt: new Date().toISOString().slice(0, 10), notes: '', newCategory: '', brandId: '',
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
        <Field label="Amount (TZS)" required><Input type="number" min="0" value={form.amount} onChange={set('amount')} autoFocus placeholder="0" /></Field>
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
        <Field label="Brand" hint="Which brand's books this belongs to (optional)">
          <Select value={form.brandId} onChange={set('brandId')}>
            <option value="">General business</option>
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
function OwnerMoneyModal({ mode, accounts, onClose }) {
  const qc = useQueryClient();
  const isIn = mode === 'in';
  const [form, setForm] = useState({
    amount: '',
    accountId: accounts.find((a) => a.isDefault)?.id || accounts[0]?.id || '',
    occurredAt: new Date().toISOString().slice(0, 10),
    description: isIn ? 'Commission paid from my own pocket' : '',
    notes: '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => api.post('/finance/owner-money', {
      direction: isIn ? 'IN' : 'OUT',
      amount: Number(form.amount),
      accountId: form.accountId,
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
        <Field label="Amount (TZS)" required><Input type="number" min="0" value={form.amount} onChange={set('amount')} autoFocus placeholder="0" /></Field>
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
// Uppercase micro-header with a plain-English subtitle — the section rhythm
// the owner pointed at in the Target admin.
function SectionHead({ label, sub }) {
  return (
    <div className="border-l-2 border-brand-500/70 pl-3">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-300">{label}</h2>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function Overview({ onNavigate, onOwnerMoney }) {
  const [period, setPeriod] = usePeriod();
  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'overview', period],
    queryFn: async () => unwrap(await api.get('/finance/overview', { params: { period } })).data,
    refetchInterval: 60_000,
  });
  const { data: cf } = useQuery({
    queryKey: ['finance', 'cashflow', 'all'],
    queryFn: async () => unwrap(await api.get('/finance/cashflow', { params: { period: 'all' } })).data,
  });
  if (isLoading || !data) return <PageSpinner />;
  const flow = data.flow?.[period] || data.flow?.month || { moneyIn: 0, moneyOut: 0, net: 0 };
  const donut = data.expenseBreakdown.map((e) => ({ name: e.category, value: e.amount }));
  const accountsDonut = data.accounts.filter((a) => a.balance > 0).map((a) => ({ name: a.name, value: a.balance }));
  const periodLabel = PERIODS.find((p) => p[0] === period)[1].toLowerCase();
  const ny = data.needsYou || {};
  const hasSeries = (cf?.series || []).some((m) => m.moneyIn > 0 || m.moneyOut > 0);

  // The briefing lives inside the hero now: two or three short readings of
  // the period, hardest-hitting first.
  const briefing = [];
  if (flow.moneyIn === 0 && flow.moneyOut === 0) {
    briefing.push('Nothing has moved ' + (period === 'all' ? 'yet' : periodLabel) + '. The figures below are the whole story.');
  } else {
    briefing.push(`${formatCurrency(flow.moneyIn)} came in and ${formatCurrency(flow.moneyOut)} went out ${periodLabel}.`);
    if (data.netProfit !== 0) {
      briefing.push(data.netProfit >= 0
        ? `After goods, commissions and expenses, ${formatCurrency(data.netProfit)} is real profit.`
        : `After goods, commissions and expenses, the period is ${formatCurrency(Math.abs(data.netProfit))} in the red.`);
    }
    if (ny.supplierOutstanding > 0) briefing.push(`Suppliers are still owed ${formatCurrency(ny.supplierOutstanding)}.`);
  }

  const attention = [
    ny.pendingApprovals > 0 && { icon: ShieldCheck, tone: 'text-sky-300 bg-sky-500/15', text: `${ny.pendingApprovals} settlement${ny.pendingApprovals === 1 ? '' : 's'} waiting for your approval`, tab: 'commissions' },
    ny.pendingWithdrawals?.count > 0 && { icon: Coins, tone: 'text-amber-300 bg-amber-500/15', text: `${ny.pendingWithdrawals.count} withdrawal request${ny.pendingWithdrawals.count === 1 ? '' : 's'} — ${formatCurrency(ny.pendingWithdrawals.amount)}`, tab: 'commissions' },
    ny.supplierOutstanding > 0 && { icon: Factory, tone: 'text-rose-300 bg-rose-500/15', text: `Suppliers are owed ${formatCurrency(ny.supplierOutstanding)}`, tab: 'suppliers' },
    ...(ny.negativeAccounts || []).map((n) => ({ icon: AlertTriangle, tone: 'text-rose-300 bg-rose-500/15', text: `${n} is below zero — money left that never arrived`, tab: 'accounts' })),
  ].filter(Boolean);

  const desks = [
    { tab: 'profit', title: 'Profit', line: 'What you make — per brand, and box by box', value: formatCurrency(data.netProfit), tone: data.netProfit >= 0 ? 'text-emerald-300' : 'text-rose-300' },
    { tab: 'cashflow', title: 'Cash Flow', line: 'Opening to closing, and what moved it', value: formatCurrency(data.cashPosition), tone: 'text-brand-300' },
    { tab: 'suppliers', title: 'Suppliers', line: 'Who you buy from and what you owe them', value: formatCurrency(ny.supplierOutstanding || 0), tone: ny.supplierOutstanding > 0 ? 'text-rose-300' : 'text-faint' },
    { tab: 'expenses', title: 'Expenses', line: 'What the business spends, by category', value: formatCurrency(data.expenses), tone: 'text-foreground' },
    { tab: 'commissions', title: 'Commissions', line: 'What the reps have earned and can withdraw', value: formatCurrency(data.outstandingCommission), tone: data.outstandingCommission > 0 ? 'text-amber-300' : 'text-faint' },
    { tab: 'ledger', title: 'The Ledger', line: 'Every shilling in and out, in one register', value: null, tone: '' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1.5">
        {PERIODS.map(([k, label]) => (
          <button key={k} onClick={() => setPeriod(k)}
            className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-semibold transition ${period === k ? 'bg-brand-500 text-slate-950' : 'border border-border text-muted hover:bg-elevated'}`}>{label}</button>
        ))}
      </div>

      {/* ── Hero: the one number the business runs on, with the briefing
             beside it — the same gradient identity as the Dashboard hero. ── */}
      <div className="relative overflow-hidden rounded-3xl p-6 sm:p-7"
        style={{ background: 'linear-gradient(115deg, #1a2e05 0%, #064e3b 42%, #0e3a4a 100%)' }}>
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand-400/10 blur-3xl" aria-hidden="true" />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-300">Cash in hand</p>
            <p className="mt-2 text-4xl font-bold leading-none tabular-nums text-white">{formatCurrency(data.cashPosition)}</p>
            <p className="mt-2 text-xs text-white/60">across all accounts, right now</p>
            <span className={`mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${data.netProfit >= 0 ? 'bg-emerald-400/15 text-emerald-300' : 'bg-rose-400/15 text-rose-300'}`}>
              {data.netProfit >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {formatCurrency(data.netProfit)} real profit · {periodLabel}
            </span>
          </div>
          <div className="border-white/10 lg:border-l lg:pl-6">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/50">The briefing</p>
            <div className="mt-2 space-y-1.5">
              {briefing.map((b, i) => (
                <p key={i} className={`text-sm leading-relaxed ${i === 0 ? 'text-white' : 'text-white/70'}`}>{b}</p>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Whose money is this? ───────────────────────────────────────────
             The owner's question, in his words: "I have 364,000 for Civlily
             — what is mine and what is for Bonge?" Every other panel talked
             about profit; this one talks about the cash he can touch. ── */}
      {data.cashSplit && (
        <div className="space-y-3">
          <SectionHead label="Whose money is this?" sub="Your cash, split between what you owe and what you keep." />
          <Card>
            <div className="p-5">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-3xl font-bold leading-none tabular-nums text-foreground">{formatCurrency(data.cashSplit.totalCash)}</p>
                  <p className="mt-1 text-xs text-muted">cash you have right now, across every account</p>
                </div>
                <div className="flex gap-6">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-300">Set aside</p>
                    <p className="mt-1 text-xl font-bold tabular-nums text-rose-400">{formatCurrency(data.cashSplit.setAside)}</p>
                    <p className="text-[11px] text-faint">for your suppliers</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">Yours</p>
                    <p className="mt-1 text-xl font-bold tabular-nums text-emerald-400">{formatCurrency(data.cashSplit.yours)}</p>
                    <p className="text-[11px] text-faint">free to use</p>
                  </div>
                </div>
              </div>

              {data.cashSplit.totalCash > 0 && (
                <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-white/[0.07]">
                  <div className="h-full bg-rose-500" style={{ width: `${(data.cashSplit.setAside / data.cashSplit.totalCash) * 100}%` }} />
                  <div className="h-full bg-emerald-500" style={{ width: `${(data.cashSplit.yours / data.cashSplit.totalCash) * 100}%` }} />
                </div>
              )}

              {/* One row per pot of money, so he can see it account by account. */}
              <div className="mt-5 space-y-3 border-t border-white/[0.06] pt-4">
                {data.cashSplit.buckets.map((b) => (
                  <div key={b.key} className="rounded-xl bg-white/[0.02] p-3.5 ring-1 ring-white/[0.06]">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {b.brandName}
                        <span className="ml-2 text-[11px] font-normal text-faint">
                          {b.accounts.filter((a) => a.balance !== 0).map((a) => a.name).join(', ') || 'no account holds money'}
                        </span>
                      </span>
                      <span className="text-sm font-bold tabular-nums text-foreground">{formatCurrency(b.cash)}</span>
                    </div>
                    {b.cash > 0 && (
                      <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                        <div className="h-full bg-rose-500" style={{ width: `${(b.setAside / b.cash) * 100}%` }} />
                        <div className="h-full bg-emerald-500" style={{ width: `${(b.yours / b.cash) * 100}%` }} />
                      </div>
                    )}
                    <p className="mt-2 text-xs leading-relaxed text-muted">
                      {b.owed > 0 ? (
                        <>
                          <b className="text-rose-400">{formatCurrency(b.setAside)}</b> of this belongs to {b.supplierName || 'your supplier'}
                          {b.yours > 0
                            ? <> and <b className="text-emerald-400">{formatCurrency(b.yours)}</b> is yours.</>
                            : <> — all of it.</>}
                          {b.shortfall > 0 && <> You still owe <b className="text-foreground">{formatCurrency(b.shortfall)}</b> beyond this.</>}
                        </>
                      ) : (
                        <>Nothing is owed here — <b className="text-emerald-400">{formatCurrency(b.yours)}</b> is all yours.</>
                      )}
                    </p>
                  </div>
                ))}
              </div>

              {/* Your own money, kept apart from the business's. Paying rep
                  commissions from your pocket is recorded here so it never
                  looks like the business earned it. */}
              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-4">
                <span className="text-xs text-muted">
                  Your own money —
                  {' '}put in <b className="tabular-nums text-sky-300">{formatCurrency(data.ownerMoney?.contributed || 0)}</b>,
                  {' '}taken out <b className="tabular-nums text-foreground">{formatCurrency(data.ownerMoney?.drawn || 0)}</b>
                </span>
                <div className="ml-auto flex gap-2">
                  <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => onOwnerMoney?.('in')}>
                    <ArrowDownLeft className="h-3.5 w-3.5" /> Put my money in
                  </Button>
                  <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => onOwnerMoney?.('out')}>
                    <ArrowUpRight className="h-3.5 w-3.5" /> Take profit out
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ── One joined strip: the flow of the period ── */}
      <SegmentStrip segments={[
        { label: 'Money in', value: formatCurrency(flow.moneyIn), sub: `collected ${periodLabel}`, tone: 'emerald' },
        { label: 'Money out', value: formatCurrency(flow.moneyOut), sub: `paid ${periodLabel}`, tone: 'rose' },
        { label: 'Net cash flow', value: formatCurrency(flow.net), sub: flow.net >= 0 ? 'more came in than left' : 'more left than came in', tone: flow.net >= 0 ? 'sky' : 'amber' },
        { label: 'Owed to suppliers', value: formatCurrency(ny.supplierOutstanding || 0), sub: ny.supplierOutstanding > 0 ? 'they are financing your stock' : 'all settled', tone: ny.supplierOutstanding > 0 ? 'amber' : 'slate' },
      ]} />

      {/* ── The business, by brand ──────────────────────────────────────────
             The owner said plainly he did not understand "TSh 2,112,500".
             A profit figure alone is an abstraction; the three steps that
             produced it are not. Money came in, money paid for it, what was
             left — in that order, in words. ── */}
      {(data.brandFinance || []).length > 0 && (
        <div className="space-y-3">
          <SectionHead label="How each brand did" sub="Money in, what it cost, what was left." />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {data.brandFinance.map((b) => {
              const costs = b.cogs + (b.commission ?? 0) + b.expenses;
              const keptPct = b.revenue > 0 ? Math.round((b.netProfit / b.revenue) * 100) : 0;
              return (
                <div key={b.brandId} className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-surface">
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-500/[0.06] to-transparent" aria-hidden="true" />
                  <div className="relative p-5">
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-brand-500/15 px-3 py-1 text-sm font-bold text-brand-300">{b.name}</span>
                      <span className="text-xs text-faint">{formatNumber(b.boxesSold)} box{b.boxesSold === 1 ? '' : 'es'} sold · {periodLabel}</span>
                    </div>

                    {/* The three steps, top to bottom, in plain words. */}
                    <div className="mt-4 space-y-2.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm text-muted">Customers paid you</span>
                        <span className="text-base font-bold tabular-nums text-emerald-400">{formatCurrency(b.revenue)}</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm text-muted">The boxes and the reps cost</span>
                        <span className="text-base font-bold tabular-nums text-rose-400">− {formatCurrency(costs)}</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-3 border-t border-white/[0.08] pt-2.5">
                        <span className="text-sm font-semibold text-foreground">Left in the business</span>
                        <span className={`text-xl font-bold tabular-nums ${b.netProfit >= 0 ? 'text-brand-300' : 'text-rose-400'}`}>
                          {formatCurrency(b.netProfit)}
                        </span>
                      </div>
                    </div>

                    <p className="mt-3 rounded-lg bg-white/[0.03] px-3 py-2 text-xs leading-relaxed text-muted">
                      Out of every 100 shillings of {b.name} sold, <b className="text-foreground">{keptPct}</b> stayed in the business.
                      It is not cash — it bought the {formatNumber(b.inventoryUnits)} boxes on your shelf.
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Charts row: motion + where the cash sits ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="The money, in motion" subtitle="Money in and out, month by month — the last six" />
          <div className="px-2 pb-3">
            {hasSeries ? (
              <TrendChart
                data={cf.series}
                series={[
                  { key: 'moneyIn', name: 'Money in', color: '#34d399' },
                  { key: 'moneyOut', name: 'Money out', color: '#fb7185' },
                ]}
                height={230}
              />
            ) : (
              <div className="flex h-[170px] items-center justify-center text-sm text-faint">The trend fills in as months of activity accumulate.</div>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Where the cash sits" subtitle="Each account's share" />
          <CardBody>
            {accountsDonut.length ? (
              <DonutChart data={accountsDonut} height={230} />
            ) : (
              <div className="flex h-[200px] items-center justify-center text-sm text-faint">No account holds money right now.</div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ── Needs you ── */}
      <div className="space-y-3">
        <SectionHead label="Needs you" sub="Only what is actually waiting for a decision." />
        {attention.length === 0 ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] px-5 py-4 text-sm text-muted">
            Nothing is waiting. Every settlement is decided, no withdrawal is pending, and no account is below zero.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-surface">
            {attention.map((a, i) => (
              <button key={i} type="button" onClick={() => onNavigate?.(a.tab)}
                className="flex w-full cursor-pointer items-center gap-3 border-b border-white/[0.05] px-5 py-3 text-left transition duration-200 last:border-0 hover:bg-white/[0.04]">
                <span className={`rounded-lg p-1.5 ${a.tone}`}><a.icon className="h-3.5 w-3.5" /></span>
                <span className="flex-1 text-sm text-foreground">{a.text}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Real profit ── */}
      <div className="space-y-3">
        <SectionHead label="Real business profit" sub={`Revenue − goods − rep commission − expenses · ${periodLabel}`} />
        <Card>
          <CardBody>
            <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
              <Money label="Revenue" value={data.revenue} tone="emerald" />
              <Money label="− COGS" value={data.cogs} tone="slate" />
              <Money label="= Gross profit" value={data.grossProfit} tone="brand" />
              <Money label="− Commission" value={data.commissionAccrued ?? 0} tone="amber" />
              <Money label="− Expenses" value={data.expenses} tone="rose" />
              <Money label="= Net profit" value={data.netProfit} tone={data.netProfit >= 0 ? 'emerald' : 'rose'} big />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* ── Products table + expense donut ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="The products carrying the business" subtitle={`Best first, by what you keep · ${periodLabel}`} />
          {!(data.topProducts || []).length ? (
            <CardBody><div className="py-6 text-center text-sm text-faint">No sales in this period.</div></CardBody>
          ) : (
            <Table>
              <THead><TR><TH>Product</TH><TH>Boxes</TH><TH>Revenue</TH><TH>You keep</TH><TH>Margin</TH></TR></THead>
              <TBody>
                {data.topProducts.map((p) => (
                  <TR key={p.productId} className="cursor-pointer" onClick={() => onNavigate?.('profit')}>
                    <TD className="font-medium text-foreground">
                      {p.name}
                      {p.brandName && <span className="ml-1.5 text-[11px] text-faint">{p.brandName}</span>}
                    </TD>
                    <TD>{formatNumber(p.boxes)}</TD>
                    <TD>{formatCurrency(p.revenue)}</TD>
                    <TD className={`font-semibold ${p.contribution >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatCurrency(p.contribution)}</TD>
                    <TD>{p.contributionMargin}%</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Where money goes" subtitle={`Expenses by category · ${periodLabel}`} />
          <CardBody>
            {donut.length === 0 ? (
              <div className="flex h-[200px] items-center justify-center text-sm text-faint">No expenses in this period</div>
            ) : (
              <DonutChart data={donut} height={230} />
            )}
          </CardBody>
        </Card>
      </div>

      {/* ── The desk ── */}
      <div className="space-y-3">
        <SectionHead label="The finance desk" sub="Every department, its job, and its number." />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {desks.map((d) => (
            <button key={d.tab} type="button" onClick={() => onNavigate?.(d.tab)}
              className="cursor-pointer rounded-2xl border border-white/[0.08] bg-surface p-4 text-left transition duration-200 hover:border-white/20 hover:bg-white/[0.03]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">{d.title}</span>
                {d.value != null && <span className={`text-sm font-bold tabular-nums ${d.tone}`}>{d.value}</span>}
              </div>
              <p className="mt-1 text-xs text-muted">{d.line}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Money({ label, value, tone, big }) {
  const tones = { emerald: 'text-emerald-500', rose: 'text-rose-500', brand: 'text-brand-400', amber: 'text-amber-500', slate: 'text-muted', default: 'text-foreground' };
  return (
    <div className={`rounded-xl border border-border bg-elevated p-3 ${big ? 'ring-1 ring-brand-500/30' : ''}`}>
      <div className="text-[11px] uppercase tracking-wide text-faint">{label}</div>
      <div className={`mt-0.5 font-bold tabular-nums ${big ? 'text-xl' : 'text-base'} ${tones[tone] || tones.default}`}>{formatCurrency(value)}</div>
    </div>
  );
}

// ── Accounts tab ──────────────────────────────────────────────────────────────
function Accounts({ onQuick }) {
  const [addOpen, setAddOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const { data: accounts = [], isLoading } = useQuery({ queryKey: ['finance', 'accounts'], queryFn: async () => unwrap(await api.get('/finance/accounts')).data });
  if (isLoading) return <PageSpinner />;
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><div className="text-xs uppercase tracking-wide text-faint">Total cash position</div><div className="text-2xl font-black text-brand-400 tabular-nums">{formatCurrency(total)}</div></div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setTransferOpen(true)}><ArrowLeftRight className="h-4 w-4" /> Transfer</Button>
          <Button variant="secondary" onClick={() => onQuick('income')}><ArrowDownLeft className="h-4 w-4" /> Income</Button>
          <Button variant="secondary" onClick={() => onQuick('expense')}><ArrowUpRight className="h-4 w-4" /> Expense</Button>
          <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Account</Button>
        </div>
      </div>
      {/* Which pocket holds the money — the Inventory "where every box is"
          pattern, applied to cash. One bar, one truth. */}
      {total > 0 && accounts.length > 1 && (
        <Card>
          <div className="p-5">
            <h3 className="text-sm font-semibold text-foreground">Where the money sits</h3>
            <p className="mt-0.5 text-xs text-muted">Every account's share of the {formatCurrency(total)}.</p>
            <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
              {accounts.map((a, i) => (
                <div key={a.id} className={`h-full ${ACCOUNT_BAR[i % ACCOUNT_BAR.length]}`}
                  style={{ width: `${Math.max(0, (a.balance / total) * 100)}%` }} />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5">
              {accounts.map((a, i) => (
                <span key={a.id} className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <span className={`h-2 w-2 rounded-full ${ACCOUNT_DOT[i % ACCOUNT_DOT.length]}`} />
                  {a.name} <b className="tabular-nums text-foreground">{formatCurrency(a.balance)}</b>
                </span>
              ))}
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((a, i) => {
          const Icon = ACCOUNT_ICON[a.type] || Wallet;
          const tint = ACCOUNT_TINT[i % ACCOUNT_TINT.length];
          return (
            <div key={a.id} className={`relative overflow-hidden rounded-2xl bg-surface p-5 ring-1 ${tint.ring}`}>
              <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${tint.glow} to-transparent`} aria-hidden="true" />
              <div className="relative flex items-center justify-between">
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tint.chip}`}><Icon className="h-5 w-5" /></span>
                {a.isDefault && <Badge className="bg-brand-500/15 text-brand-400">Default</Badge>}
              </div>
              <div className="relative mt-3 text-sm font-semibold text-foreground">{a.name}</div>
              {a.notes && <div className="relative text-[11px] text-faint">{a.notes}</div>}
              <div className={`relative mt-1 text-2xl font-bold tabular-nums ${a.balance < 0 ? 'text-rose-400' : 'text-foreground'}`}>{formatCurrency(a.balance)}</div>
              <div className="relative mt-3 flex justify-between border-t border-white/[0.07] pt-2 text-xs">
                <span className="text-emerald-400">In {formatCurrency(a.moneyIn)}</span>
                <span className="text-rose-400">Out {formatCurrency(a.moneyOut)}</span>
              </div>
              <div className="relative mt-1 text-[11px] text-faint">Opening {formatCurrency(a.openingBalance)}</div>
            </div>
          );
        })}
      </div>
      {addOpen && <AddAccountModal onClose={() => setAddOpen(false)} />}
      {transferOpen && <TransferModal accounts={accounts} onClose={() => setTransferOpen(false)} />}
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
            { label: 'Spent in this view', value: formatCurrency(sums.out), sub: `${formatNumber(count)} record${count === 1 ? '' : 's'}`, tone: 'rose' },
            ...byCategory.slice(0, 3).map((c) => ({ label: c.category, value: formatCurrency(c.amount), sub: `${formatNumber(c.count)} record${c.count === 1 ? '' : 's'}`, tone: 'slate' })),
          ]} />
        ) : (
          <SegmentStrip segments={[
            { label: 'Money in', value: formatCurrency(sums.in), sub: 'settlements collected and money moved in', tone: 'emerald' },
            { label: 'Money out', value: formatCurrency(sums.out), sub: 'costs paid and money moved out', tone: 'rose' },
            { label: 'Net', value: formatCurrency(sums.net), sub: `${formatNumber(count)} movement${count === 1 ? '' : 's'}`, tone: sums.net >= 0 ? 'sky' : 'amber' },
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
                  <TD><Badge className={DIR_BADGE[t.direction]}>{TXN_TYPE_LABEL[t.type] || t.type}</Badge></TD>
                  <TD>{t.brandName ? <Badge className="bg-brand-500/15 text-brand-400">{t.brandName}</Badge> : <span className="text-faint">—</span>}</TD>
                  <TD className="max-w-[220px] truncate text-foreground">{t.category || t.description || t.reference || '—'}</TD>
                  <TD className="text-muted">{t.account?.name}</TD>
                  <TD className={`text-right font-semibold tabular-nums ${t.direction === 'IN' ? 'text-emerald-500' : 'text-rose-500'}`}>{t.direction === 'IN' ? '+' : '−'}{formatCurrency(t.amount)}</TD>
                  <TD>
                    <div className="flex items-center justify-end gap-2">
                      <button title="Correct this transaction" onClick={() => setEditing(t)} className="text-faint hover:text-brand-400"><Pencil className="h-4 w-4" /></button>
                      <button title="Delete" onClick={() => del.mutate(t.id)} className="text-faint hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
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
  const [occurredAt, setOccurredAt] = useState(txn.occurredAt ? String(txn.occurredAt).slice(0, 10) : '');
  const [description, setDescription] = useState(txn.description || '');
  const [reason, setReason] = useState('');

  // Brand-reserved accounts only accept their own brand's money.
  const accountOptions = accounts.filter((a) => !a.brandId || !brandId || a.brandId === brandId);

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
        <Button loading={save.isPending} disabled={!accountId || !reason.trim()} onClick={() => save.mutate()}>Save correction</Button>
      </>
    }>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Account" required hint="Where the money actually is">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
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
            <Input type="number" min="0" value={amount} disabled={saleLinked} onChange={(e) => setAmount(e.target.value)} />
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

// ── Profit tab (absorbed from the old Profit & Margins page) ─────────────────
const PROFIT_PERIODS = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['all', 'All time']];

function ProfitTab() {
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
  const windowLabel = period === 'all'
    ? (data.epochAt ? `since ${formatDate(data.epochAt)} — the day finance went live` : 'all recorded sales')
    : data.range ? `${formatDate(data.range.start)} → ${formatDate(data.range.end)}` : '';

  const cards = [
    { label: 'Revenue', value: formatCurrency(t.revenue), icon: TrendingUp, sub: `${formatNumber(t.boxes)} boxes sold`,
      ring: 'ring-emerald-500/25', glow: 'from-emerald-500/[0.12]', chip: 'bg-emerald-500/15 text-emerald-300', num: 'text-emerald-300' },
    { label: 'Cost of goods', value: formatCurrency(t.cost), icon: Package, sub: 'at cost when each box sold',
      ring: 'ring-white/[0.08]', glow: 'from-white/[0.03]', chip: 'bg-white/10 text-muted', num: 'text-foreground' },
    { label: 'Gross profit', value: formatCurrency(t.profit), icon: Wallet, sub: `${t.margin}% margin`,
      ring: 'ring-brand-500/25', glow: 'from-brand-500/[0.12]', chip: 'bg-brand-500/15 text-brand-300', num: 'text-brand-300' },
    { label: 'Rep commission', value: formatCurrency(t.commission), icon: Coins, sub: 'earned on these boxes',
      ring: 'ring-amber-500/25', glow: 'from-amber-500/[0.12]', chip: 'bg-amber-500/15 text-amber-300', num: 'text-amber-300' },
    { label: 'You keep', value: `${t.contributionMargin}%`, icon: Scale, sub: `${formatCurrency(t.contribution)} after goods & reps`,
      ring: 'ring-violet-500/25', glow: 'from-violet-500/[0.14]', chip: 'bg-violet-500/15 text-violet-300', num: 'text-violet-300' },
  ];

  const perBoxKept = (row) => (row.boxes > 0 ? row.contribution / row.boxes : 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1.5">
        {PROFIT_PERIODS.map(([k, label]) => (
          <button key={k} onClick={() => setPeriod(k)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${period === k ? 'bg-brand-500 text-slate-950' : 'border border-border text-muted hover:bg-elevated'}`}>{label}</button>
        ))}
        {windowLabel && <span className="ml-2 text-xs text-faint">{windowLabel}</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className={`relative overflow-hidden rounded-2xl bg-surface p-4 ring-1 ${c.ring}`}>
            <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${c.glow} to-transparent`} aria-hidden="true" />
            <div className="relative flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-muted">{c.label}</p>
              <span className={`rounded-lg p-1.5 ${c.chip}`}><c.icon className="h-3.5 w-3.5" /></span>
            </div>
            <p className={`relative mt-2 text-2xl font-bold tabular-nums ${c.num}`}>{c.value}</p>
            <p className="relative mt-0.5 text-[11px] text-faint">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Per brand: the full money path, ending at the number the owner
          actually means — what is left after the goods AND the rep. */}
      {data.byBrand.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">What each brand makes</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {data.byBrand.map((b) => {
              const stock = stockByBrand.get(b.brandId);
              const path = [
                { label: 'Revenue', v: b.revenue, cls: 'text-foreground' },
                { label: '− Goods', v: -b.cost, cls: 'text-muted' },
                { label: '− Commission', v: -b.commission, cls: 'text-amber-400' },
              ];
              return (
                <Card key={b.brandId}>
                  <div className="p-5">
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-brand-500/15 px-2.5 py-0.5 text-xs font-bold text-brand-400">{b.name}</span>
                      <span className="text-xs text-faint">{formatNumber(b.boxes)} box{b.boxes === 1 ? '' : 'es'}</span>
                    </div>
                    <p className={`mt-3 text-3xl font-bold leading-none tabular-nums ${b.contribution >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {b.contributionMargin}%
                    </p>
                    <p className="mt-1 text-xs text-faint">kept — {formatCurrency(b.contribution)} after goods & reps</p>
                    <div className="mt-4 space-y-1.5 border-t border-white/[0.06] pt-3">
                      {path.map((r) => (
                        <div key={r.label} className="flex items-baseline justify-between">
                          <span className="text-xs text-muted">{r.label}</span>
                          <span className={`text-sm font-semibold tabular-nums ${r.cls}`}>{formatCurrency(Math.abs(r.v))}</span>
                        </div>
                      ))}
                      <div className="flex items-baseline justify-between border-t border-white/[0.06] pt-1.5">
                        <span className="text-xs font-semibold text-foreground">= You keep</span>
                        <span className={`text-sm font-bold tabular-nums ${b.contribution >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {formatCurrency(b.contribution)}
                        </span>
                      </div>
                    </div>
                    {stock && (
                      <p className="mt-3 text-[11px] text-faint">
                        Inventory {formatCurrency(stock.stockValue)} ({formatNumber(stock.stockUnits)} boxes)
                      </p>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Inventory value (cost)" value={formatCurrency(data.inventoryValue.costValue)} icon={Boxes} tone="slate" hint={`${formatNumber(data.inventoryValue.units)} boxes on hand`} />
        <StatCard label="Potential revenue" value={formatCurrency(data.inventoryValue.potentialRevenue)} icon={TrendingUp} tone="emerald" hint="if all sold at selling price" />
        <StatCard label="Potential profit" value={formatCurrency(data.inventoryValue.potentialProfit)} icon={Wallet} tone="brand" hint="before commissions" />
      </div>

      {/* Every product, one by one — the whole catalogue, not a top list. */}
      <Card>
        <CardHeader title="Every product, one by one" subtitle="What each one brings in and what you keep, best first" />
        <CardBody>
          {!data.byProduct.length ? <EmptyState title="No sales in this period" icon={Package} /> : (
            <Table>
              <THead><TR><TH>Product</TH><TH>Boxes</TH><TH>Revenue</TH><TH>Goods</TH><TH>Commission</TH><TH>You keep</TH><TH>Kept / box</TH><TH>Margin</TH></TR></THead>
              <TBody>
                {data.byProduct.map((p) => (
                  <TR key={p.productId}>
                    <TD className="font-medium text-foreground">{p.name}</TD>
                    <TD>{formatNumber(p.boxes)}</TD>
                    <TD>{formatCurrency(p.revenue)}</TD>
                    <TD className="text-muted">{formatCurrency(p.cost)}</TD>
                    <TD className="text-amber-400">{formatCurrency(p.commission)}</TD>
                    <TD className={`font-semibold ${p.contribution >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatCurrency(p.contribution)}</TD>
                    <TD className="tabular-nums">{formatCurrency(perBoxKept(p))}</TD>
                    <TD>{p.contributionMargin}%</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Profit by sales rep" subtitle="What each rep's settled boxes bring in, after their commission" />
        <CardBody>
          {!data.byRep.length ? <EmptyState title="No rep sales in this period" icon={TrendingUp} /> : (
            <Table>
              <THead><TR><TH>Sales rep</TH><TH>Boxes</TH><TH>Revenue</TH><TH>Their commission</TH><TH>You keep</TH><TH>Margin</TH></TR></THead>
              <TBody>
                {data.byRep.map((r) => (
                  <TR key={r.salesRepId}>
                    <TD className="font-medium text-foreground">{r.name}</TD>
                    <TD>{formatNumber(r.boxes)}</TD>
                    <TD>{formatCurrency(r.revenue)}</TD>
                    <TD className="text-amber-400">{formatCurrency(r.commission)}</TD>
                    <TD className={`font-semibold ${r.contribution >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatCurrency(r.contribution)}</TD>
                    <TD>{r.contributionMargin}%</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ── Cash Flow tab ─────────────────────────────────────────────────────────────
const CF_PERIODS = [['today', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly'], ['all', 'All time']];

function CashFlowTab() {
  const [period, setPeriod] = useState('month');
  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'cashflow', period],
    queryFn: async () => unwrap(await api.get('/finance/cashflow', { params: { period } })).data,
  });
  if (isLoading || !data) return <PageSpinner />;

  const inRows = (data.byType || []).filter((r) => r.direction === 'IN').map((r) => ({ label: TXN_TYPE_LABEL[r.type] || r.type, value: r.amount, count: r.count }));
  const outRows = (data.byType || []).filter((r) => r.direction === 'OUT').map((r) => ({ label: TXN_TYPE_LABEL[r.type] || r.type, value: r.amount, count: r.count }));
  const inTotal = inRows.reduce((a, r) => a + r.value, 0);
  const outTotal = outRows.reduce((a, r) => a + r.value, 0);
  const hasSeries = (data.series || []).some((m) => m.moneyIn > 0 || m.moneyOut > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5">
        {CF_PERIODS.map(([k, label]) => (
          <button key={k} onClick={() => setPeriod(k)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${period === k ? 'bg-brand-500 text-slate-950' : 'border border-border text-muted hover:bg-elevated'}`}>{label}</button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <TintCard label="Opening balance" value={formatCurrency(data.openingBalance)} icon={PiggyBank} tone="slate" sub="at period start" />
        <TintCard label="Money in" value={formatCurrency(data.moneyIn)} icon={ArrowDownLeft} tone="emerald" sub="collected this period" />
        <TintCard label="Money out" value={formatCurrency(data.moneyOut)} icon={ArrowUpRight} tone="rose" sub="paid this period" />
        <TintCard label="Closing balance" value={formatCurrency(data.closingBalance)} icon={Wallet} tone={data.closingBalance >= 0 ? 'brand' : 'rose'} sub={`net ${formatCurrency(data.net)}`} />
      </div>

      {/* The story in one line: the four figures above, connected. */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center justify-center gap-3 py-1 text-sm">
            <span className="text-muted">Opening <b className="text-foreground">{formatCurrency(data.openingBalance)}</b></span>
            <ChevronRight className="h-4 w-4 text-faint" />
            <span className="text-emerald-500">+ {formatCurrency(data.moneyIn)}</span>
            <ChevronRight className="h-4 w-4 text-faint" />
            <span className="text-rose-400">− {formatCurrency(data.moneyOut)}</span>
            <ChevronRight className="h-4 w-4 text-faint" />
            <span className="text-muted">Closing <b className={data.closingBalance >= 0 ? 'text-brand-400' : 'text-rose-500'}>{formatCurrency(data.closingBalance)}</b></span>
          </div>
        </CardBody>
      </Card>

      {/* Motion, not one frame: six months of in vs out. */}
      <Card>
        <CardHeader title="The money, in motion" subtitle="Money in and out, month by month — the last six" />
        <div className="px-2 pb-3">
          {hasSeries ? (
            <TrendChart
              data={data.series}
              series={[
                { key: 'moneyIn', name: 'Money in', color: '#34d399' },
                { key: 'moneyOut', name: 'Money out', color: '#fb7185' },
              ]}
              height={220}
            />
          ) : (
            <div className="flex h-[160px] items-center justify-center text-sm text-faint">
              The trend fills in as months of activity accumulate.
            </div>
          )}
        </div>
      </Card>

      {/* WHAT moved the money — the cards above only say how much. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Where it came from</h3>
                <p className="mt-0.5 text-xs text-muted">Every shilling in, by kind.</p>
              </div>
              <span className="rounded-lg bg-emerald-500/15 p-1.5 text-emerald-300"><ArrowDownLeft className="h-3.5 w-3.5" /></span>
            </div>
            {inRows.length ? (
              <ShareRows rows={inRows} total={inTotal} colours={['bg-emerald-500', 'bg-brand-500', 'bg-sky-500', 'bg-violet-500']} />
            ) : <p className="mt-4 text-sm text-faint">No money came in during this period.</p>}
          </div>
        </Card>
        <Card>
          <div className="p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Where it went</h3>
                <p className="mt-0.5 text-xs text-muted">Every shilling out, by kind.</p>
              </div>
              <span className="rounded-lg bg-rose-500/15 p-1.5 text-rose-300"><ArrowUpRight className="h-3.5 w-3.5" /></span>
            </div>
            {outRows.length ? (
              <ShareRows rows={outRows} total={outTotal} colours={['bg-rose-500', 'bg-amber-500', 'bg-violet-500', 'bg-sky-500']} />
            ) : <p className="mt-4 text-sm text-faint">No money went out during this period.</p>}
          </div>
        </Card>
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

function PaySupplierModal({ order, accounts, onClose, onDone }) {
  const [accountId, setAccountId] = useState(accounts.find((a) => a.isDefault)?.id || accounts[0]?.id || '');
  const [amount, setAmount] = useState(String(order.outstanding || ''));
  const [notes, setNotes] = useState('');
  const pay = useMutation({
    mutationFn: () => api.post('/finance/supplier-payments', {
      purchaseOrderId: order.id, accountId, amount: Number(amount), notes: notes.trim() || undefined,
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
          <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label="Paid from account" required>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} — {formatCurrency(a.balance)}</option>)}
          </Select>
        </Field>
        <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

// Pay down the supplier's overall balance (installments) from any account.
function PayBalanceModal({ supplier, outstanding, accounts, onClose, onDone }) {
  const [accountId, setAccountId] = useState(accounts.find((a) => a.isDefault)?.id || accounts[0]?.id || '');
  const [amount, setAmount] = useState(String(outstanding || ''));
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
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
          <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
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
function NewPurchaseModal({ supplier, onClose, onDone }) {
  const { data: products = [] } = useProducts();
  const [lines, setLines] = useState([{ productId: '', quantity: '', unitCost: '' }]);
  const [shippingCost, setShippingCost] = useState('');
  const [otherCost, setOtherCost] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  const patch = (i, p) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...p } : l)));
  const pickProduct = (i, productId) => {
    const prod = products.find((p) => p.id === productId);
    patch(i, { productId, unitCost: prod ? String(Number(prod.purchasePrice) || '') : '' });
  };
  const supplierBrand = supplier.brandId || null;
  const options = supplierBrand ? products.filter((p) => p.brandId === supplierBrand) : products;

  const goods = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);
  const total = goods + (Number(shippingCost) || 0) + (Number(otherCost) || 0);
  const validLines = lines.filter((l) => l.productId && Number(l.quantity) > 0 && Number(l.unitCost) >= 0);
  const valid = validLines.length > 0;

  const save = useMutation({
    mutationFn: async () => {
      const items = validLines.map((l) => {
        const prod = products.find((p) => p.id === l.productId);
        const pkg = prod?.packagings?.find((pk) => pk.isBaseUnit) || prod?.packagings?.[0];
        return { productId: l.productId, packagingUnitId: pkg?.packagingUnitId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) };
      });
      const po = unwrap(await api.post('/purchase-orders', {
        supplierId: supplier.id, currency: 'TZS', items,
        shippingCost: Number(shippingCost) || 0, otherCost: Number(otherCost) || 0,
        orderedAt: new Date(`${date}T12:00:00`).toISOString(), notes: notes.trim() || undefined,
      })).data;
      await api.post(`/purchase-orders/${po.id}/receive`, { actualArrival: new Date(`${date}T12:00:00`).toISOString() });
      return po;
    },
    onSuccess: (po) => {
      toast.success(`Purchase ${po.poNumber} received — stock added, you now owe ${supplier.name} ${formatCurrency(total)} more`);
      onDone(); onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Modal open onClose={onClose} size="lg" title={`New purchase from ${supplier.name}`}
      footer={<>
        <div className="mr-auto text-sm"><span className="text-muted">Total</span> <b>{formatCurrency(total)}</b></div>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}><Package className="h-4 w-4" /> Receive stock</Button>
      </>}>
      <div className="space-y-4">
        <p className="rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-muted">
          Records stock received from {supplier.name}: inventory increases and the amount you owe them increases. No money moves now — pay later from any account.
        </p>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select className="min-w-[200px] flex-1" value={l.productId} onChange={(e) => pickProduct(i, e.target.value)}>
                <option value="">Select product…</option>
                {options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <Input type="number" min="1" className="w-20" placeholder="Boxes" value={l.quantity} onChange={(e) => patch(i, { quantity: e.target.value })} />
              <Input type="number" min="0" className="w-28" placeholder="Cost/box" value={l.unitCost} onChange={(e) => patch(i, { unitCost: e.target.value })} />
              <button onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="text-faint hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <button onClick={() => setLines((ls) => [...ls, { productId: '', quantity: '', unitCost: '' }])}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline"><Plus className="h-3.5 w-3.5" /> Add product</button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Shipping / transport (TZS)"><Input type="number" min="0" value={shippingCost} onChange={(e) => setShippingCost(e.target.value)} placeholder="0" /></Field>
          <Field label="Other costs (TZS)"><Input type="number" min="0" value={otherCost} onChange={(e) => setOtherCost(e.target.value)} placeholder="0" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Purchase date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>
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
            {data.totals.outstanding > 0 && (
              <Button onClick={() => setPayingBalance(true)}><Wallet className="h-4 w-4" /> Pay supplier</Button>
            )}
          </>
        )}>
        {isLoading || !data ? <PageSpinner /> : (
          <div className="space-y-5">
            {/* Identity */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
              {s.brandName && <Badge className="bg-brand-500/15 text-brand-400">{s.brandName}</Badge>}
              {s.country && <span>{s.country}</span>}
              {s.contactName && <span>{s.contactName}</span>}
              {s.phone && <span>{s.phone}</span>}
              {s.email && <span>{s.email}</span>}
            </div>

            {/* Balances */}
            <div className="grid grid-cols-3 gap-3">
              <Money label="Total purchased" value={data.totals.purchased} />
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
      {purchasing && s && <NewPurchaseModal supplier={s} onClose={() => setPurchasing(false)} onDone={refresh} />}
    </>
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
  const totals = suppliers.reduce((s, x) => ({ purchased: s.purchased + x.totalPurchased, paid: s.paid + x.totalPaid, out: s.out + x.outstanding }), { purchased: 0, paid: 0, out: 0 });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <TintCard label="Suppliers" value={formatNumber(suppliers.length)} icon={Factory} tone="slate" sub="who you buy from" />
        <TintCard label="Total purchased" value={formatCurrency(totals.purchased)} icon={Package} tone="brand" sub="all stock ever bought" />
        <TintCard label="Total paid" value={formatCurrency(totals.paid)} icon={Wallet} tone="emerald"
          sub={totals.purchased > 0 ? `${Math.round((totals.paid / totals.purchased) * 100)}% of purchases` : 'nothing yet'} />
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
            <THead><TR><TH>Supplier</TH><TH>Brand</TH><TH>Country</TH><TH>Orders</TH><TH>Purchased</TH><TH>Paid</TH><TH>Outstanding</TH></TR></THead>
            <TBody>
              {suppliers.map((s) => (
                <TR key={s.id} className="cursor-pointer" onClick={() => setViewing(s.id)}>
                  <TD className="font-medium text-foreground">
                    {s.name}{s.contactName ? <span className="ml-1.5 text-xs text-faint">· {s.contactName}</span> : null}
                    {/* How much of this supplier's stock is actually paid for. */}
                    {s.totalPurchased > 0 && (
                      <div className="mt-1 h-1 w-28 overflow-hidden rounded-full bg-white/[0.07]">
                        <div className={s.outstanding > 0 ? 'h-full bg-amber-500' : 'h-full bg-emerald-500'}
                          style={{ width: `${Math.max(2, (s.totalPaid / s.totalPurchased) * 100)}%` }} />
                      </div>
                    )}
                  </TD>
                  <TD>{s.brandName ? <Badge className="bg-brand-500/15 text-brand-400">{s.brandName}</Badge> : <span className="text-faint">—</span>}</TD>
                  <TD className="text-muted">{s.country}</TD>
                  <TD>{s.poCount}</TD>
                  <TD>{formatCurrency(s.totalPurchased)}</TD>
                  <TD className="text-emerald-500">{formatCurrency(s.totalPaid)}</TD>
                  <TD className={s.outstanding > 0 ? 'font-semibold text-rose-400' : 'text-faint'}>{formatCurrency(s.outstanding)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {addOpen && <AddSupplierModal onClose={() => setAddOpen(false)} />}
      {viewing && <SupplierDetailModal supplierId={viewing} accounts={accounts} onClose={() => setViewing(null)} />}
    </div>
  );
}

// ── Reports Archive (generated weekly/monthly statement PDFs) ─────────────────
function ArchiveTab() {
  const [type, setType] = useState('');
  const [year, setYear] = useState('');
  const [search, setSearch] = useState('');
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['finance', 'report-archive', type, year, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (type) params.set('type', type);
      if (year) params.set('year', year);
      if (search) params.set('search', search);
      return unwrap(await api.get(`/finance/report-archive?${params}`)).data;
    },
  });

  const years = [];
  for (let y = new Date().getFullYear(); y >= 2026; y -= 1) years.push(String(y));

  const download = async (row) => {
    try {
      const res = await api.get(`/finance/report-archive/${row.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `TheLab-${row.type.toLowerCase()}-${row.periodKey}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  return (
    <Card>
      <CardHeader
        title="Reports archive"
        subtitle="Every weekly and monthly statement PDF, exactly as it was generated and sent — nothing is lost."
      />
      <CardBody>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Select value={type} onChange={(e) => setType(e.target.value)} className="w-36">
            <option value="">All types</option>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
          </Select>
          <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-28">
            <option value="">All years</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
          <Input placeholder="Search period… (e.g. W27, 2026-06)" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
        </div>
        {isLoading ? (
          <PageSpinner label="Loading archive…" />
        ) : rows.length === 0 ? (
          <EmptyState icon={FileBarChart} title="No reports yet" message="Weekly and monthly PDFs are archived here automatically when they are sent." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR><TH>Period</TH><TH>Type</TH><TH>Key</TH><TH>Generated</TH><TH className="text-right">Actions</TH></TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium">{r.label}</TD>
                    <TD>
                      <Badge className={r.type === 'MONTHLY' ? 'bg-violet-500/15 text-violet-500' : 'bg-lime-500/15 text-lime-600'}>
                        {r.type === 'MONTHLY' ? 'Monthly' : 'Weekly'}
                      </Badge>
                    </TD>
                    <TD className="text-xs text-muted">{r.periodKey}</TD>
                    <TD className="text-xs">{formatDateTime(r.updatedAt || r.createdAt)}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" onClick={() => window.open(r.link, '_blank')}>Open</Button>
                        <Button variant="secondary" onClick={() => download(r)}>Download</Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </CardBody>
    </Card>
  );
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
      <PageHeader title="Finance" subtitle="The accounting department of The Lab — accounts, profit, cash flow, suppliers and reports.">
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setMoney('income')}><ArrowDownLeft className="h-4 w-4" /> Income</Button>
          <Button onClick={() => setMoney('expense')}><ArrowUpRight className="h-4 w-4" /> Expense</Button>
        </div>
      </PageHeader>

      <div className="mb-6 flex flex-wrap gap-2">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`cursor-pointer rounded-full px-4 py-2 text-sm font-semibold ring-1 transition duration-200 ${tab === k
              ? 'bg-brand-500 text-slate-950 ring-brand-500'
              : 'bg-transparent text-muted ring-white/10 hover:bg-white/[0.05] hover:text-foreground'}`}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && <Overview onNavigate={setTab} onOwnerMoney={setOwnerMoney} />}
      {tab === 'profit' && <ProfitTab />}
      {tab === 'cashflow' && <CashFlowTab />}
      {tab === 'suppliers' && <SuppliersTab accounts={accounts} />}
      {tab === 'accounts' && <Accounts onQuick={setMoney} />}
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
