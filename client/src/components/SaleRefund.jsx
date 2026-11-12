import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { Minus, Plus, UserRound, Warehouse } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { pageQueries } from '@/lib/pageQueries';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/format';
import { planRefund, allBoxes, refundItems, refundable, REFUND_REASONS } from '@/lib/saleRefund';
import { Modal, Button, PageSpinner, LoadError } from '@/components/ui';
import { ReasonField } from '@/components/ProductPicker';

// ============================================================================
// THE CUSTOMER BROUGHT BOXES BACK — refund window (admin only, counter sales only).
//
// Owner, 12 Nov 2026: "Yes, refund: the sale and the money come out of Finance.
// Do this when the customer returns — the money returns too, so the sale is
// cancelled." Every line starts with ALL its boxes (the usual case: the whole
// sale comes back = the sale is cancelled); take boxes off a line for a part
// return and the sale becomes smaller. The window names the cash going back,
// the account it comes out of, and what happens to the sale; the server works
// it all out again under its own claim (POST /sales/:id/refund).
// Opened from Sales (a sale > Refund customer) and Returns (Customer return).
// ============================================================================

// Everything a refund changes: the sale and its list, stock, the accounts and the ledger, the profit
// figures, Home, and the Returns page.
export const REFUND_KEYS = ['sales', 'sale', 'inventory', 'finance', 'dashboard', 'reports', 'daily-reports', 'returns', 'products', 'customers'];

const stepBtn =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-foreground ring-1 ring-white/[0.12] ' +
  'transition hover:bg-white/[0.1] active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ' +
  'disabled:pointer-events-none disabled:opacity-30 sm:h-9 sm:w-9';
const linkBtn =
  'inline-flex min-w-[44px] shrink-0 items-center justify-center rounded-md px-2 py-1.5 text-xs font-medium text-muted underline-offset-2 transition hover:bg-white/[0.05] ' +
  'hover:text-foreground hover:underline max-sm:min-h-[44px]';
const boxWord = (n) => (n === 1 ? 'box' : 'boxes');

export default function SaleRefund({ saleId, onClose, onDone }) {
  const qc = useQueryClient();
  const sending = useRef(false);
  const sale = useQuery({
    ...pageQueries.sale(saleId),
    enabled: !!saleId,
    staleTime: 0,
    refetchOnMount: 'always', // the version sent back must be the sale as it is now
  });
  const data = sale.data;
  const [picks, setPicks] = useState(null); // null = every box (until somebody changes a line)
  const [reason, setReason] = useState('');
  const chosen = useMemo(() => picks || allBoxes(data), [picks, data]);
  const plan = useMemo(() => planRefund(data, chosen), [data, chosen]);
  const lines = (data?.items || []).filter((i) => Number(i.quantity) > 0);

  const paidInto = data?.paidInto || [];
  const accountName = [...new Set(paidInto.map((p) => p.account).filter(Boolean))].join(' + ') || null;
  const inLedger = paidInto.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const isCredit = data?.type === 'CREDIT' || !!data?.creditSale;
  const blockedCredit = isCredit && !plan.everything && plan.boxesBack > 0;
  const placeName = data?.warehouse?.name || 'the warehouse';
  const refunds = data?.refunds || [];

  const set = (item, n) => {
    const q = Number(item.quantity) || 0;
    const v = Math.max(0, Math.min(q, Math.floor(Number(n) || 0)));
    setPicks((prev) => ({ ...(prev || allBoxes(data)), [item.id]: v }));
  };

  const refund = useMutation({
    mutationFn: async () => unwrap(await api.post(`/sales/${saleId}/refund`, {
      items: refundItems(chosen),
      reason: reason.trim() || undefined,
      version: data.updatedAt,
    })).data,
    onSuccess: (res) => {
      const r = res?.refund || {};
      const n = r.boxes ?? plan.boxesBack;
      const from = r.ledger?.[0]?.account || accountName;
      // Money the sale's accounts never held (a credit sale's payments, an old sale) moves no account: said so.
      const fromLedger = (r.ledger || []).reduce((s, l) => s + (Number(l.taken) || 0), 0);
      const money = !(r.cashBack > 0)
        ? 'no cash back (it came off what is owed)'
        : fromLedger > 0
          ? `${formatCurrency(r.cashBack)} refunded${from ? ` from ${from}` : ''}`
          : `${formatCurrency(r.cashBack)} to give back — no account changed`;
      toast.success(r.everything
        ? `${res.saleNumber} cancelled — ${money}, ${formatNumber(n)} ${boxWord(n)} back in stock`
        : `${formatNumber(n)} ${boxWord(n)} back in stock — ${money}`);
      REFUND_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      (onDone || onClose)(res);
    },
    onError: (e) => {
      toast.error(apiError(e));
      // Somebody else changed the sale (a refund, a cancel): show it as it is now, from every box again.
      if (e?.response?.status === 409) { setPicks(null); sale.refetch(); qc.invalidateQueries({ queryKey: ['sales'] }); }
    },
    onSettled: () => { sending.current = false; },
  });

  const canSend = !!data && refundable(data) && plan.boxesBack > 0 && !blockedCredit && !sale.isFetching;
  const send = () => {
    if (sending.current || refund.isPending || !canSend) return;
    sending.current = true;
    refund.mutate();
  };

  // The button says what will happen.
  const label = plan.boxesBack === 0
    ? 'Pick the boxes that came back'
    : plan.cashBack > 0
      ? plan.everything
        ? <span className="tabular-nums">Refund {formatCurrency(plan.cashBack)} · cancel sale</span>
        : <span className="tabular-nums">Refund {formatCurrency(plan.cashBack)}</span>
      : `Take back ${formatNumber(plan.boxesBack)} ${boxWord(plan.boxesBack)}`;

  const footer = (
    <>
      <div className="min-w-0 text-sm max-sm:w-full sm:mr-auto">
        {data && plan.boxesBack > 0 ? (
          <div className="truncate text-muted">
            <span className="font-semibold tabular-nums text-foreground">{formatNumber(plan.boxesBack)}</span> {boxWord(plan.boxesBack)} back
            {plan.cashBack > 0 && accountName && <> · from <span className="font-medium text-foreground">{accountName}</span></>}
          </div>
        ) : <span className="text-muted">Nothing picked yet</span>}
      </div>
      {/* Goes back a step: to the sale (Sales) or to the list of sales (Returns). */}
      <Button variant="secondary" className="hidden sm:inline-flex" onClick={onClose} disabled={refund.isPending}>Back</Button>
      <Button className="h-12 w-full text-base sm:h-auto sm:w-auto sm:text-sm" loading={refund.isPending} disabled={!canSend} onClick={send}>
        {label}
      </Button>
    </>
  );

  // Phone: the sale number on its own small line, never broken in the middle.
  const title = data ? (
    <>
      Refund customer
      <span className="hidden sm:inline"> · </span>
      <span className="block whitespace-nowrap text-xs font-medium text-muted sm:inline sm:text-base sm:font-semibold sm:text-foreground">{data.saleNumber}</span>
    </>
  ) : 'Refund customer';
  return (
    <Modal open={!!saleId} onClose={() => { if (!refund.isPending) onClose(); }} size="lg" title={title} footer={data && refundable(data) ? footer : null}>
      {sale.isLoading ? <PageSpinner /> : sale.isError || !data ? <LoadError what="this sale" onRetry={() => sale.refetch()} /> : !refundable(data) ? (
        <p className="py-6 text-center text-sm text-muted">
          {data.status === 'CANCELLED'
            ? 'This sale is already cancelled — its boxes and money went back then.'
            : "Rep sales are returned through the rep's order."}
        </p>
      ) : (
        <div className="space-y-4 text-sm">
          {/* Who bought, when, and where the boxes go back to — one quiet line. */}
          <div className="flex min-h-[44px] items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-1.5 ring-1 ring-white/[0.08] sm:gap-3">
            <UserRound className="hidden h-4 w-4 shrink-0 text-faint sm:block" aria-hidden="true" />
            <div className="min-w-0 max-w-[45%] shrink-0">
              <div className="truncate font-medium text-foreground">{data.customer?.name || 'Walk-in'}</div>
              <div className="truncate text-[11px] text-faint">{formatDateTime(data.soldAt)}</div>
            </div>
            <div className="h-7 w-px shrink-0 bg-white/[0.08]" aria-hidden="true" />
            <Warehouse className="hidden h-4 w-4 shrink-0 text-faint sm:block" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-foreground">{placeName}</div>
              <div className="truncate text-[11px] text-faint">Boxes go back here</div>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between px-1">
              <span className="text-xs text-muted">Boxes the customer brought back</span>
              <span className="flex gap-1">
                <button type="button" className={linkBtn} onClick={() => setPicks(null)}>All</button>
                <button type="button" className={linkBtn} onClick={() => setPicks(Object.fromEntries(lines.map((i) => [i.id, 0])))}>None</button>
              </span>
            </div>
            <ul className="-mx-5 divide-y divide-white/[0.06] border-y border-white/[0.08] bg-white/[0.025] sm:mx-0 sm:overflow-hidden sm:rounded-xl sm:border-0 sm:ring-1 sm:ring-white/[0.08]">
              {lines.map((it) => {
                const q = Number(it.quantity) || 0;
                const k = Math.min(q, Math.floor(Number(chosen[it.id]) || 0));
                const per = q > 0 ? Number(it.lineTotal) / q : 0;
                const value = plan.lines.find((l) => l.saleItemId === it.id)?.value || 0;
                const unit = it.packagingUnit?.name?.toLowerCase() || 'box';
                // A line with boxes already brought back shows what is left on it, not what was first sold.
                const touched = refunds.some((r) => (r.lines || []).some((l) => l.saleItemId === it.id));
                return (
                  <li key={it.id} className={clsx('flex items-center gap-2 px-4 py-2 sm:gap-3 sm:px-3 sm:py-2.5', k > 0 && 'bg-white/[0.04]')}>
                    <div className="min-w-0 flex-1">
                      {/* Phone: the name may take two lines rather than lose its filter / colour words. */}
                      <div className="font-medium leading-snug text-foreground sm:truncate" title={it.product?.name}>{it.product?.name}</div>
                      <div className="mt-0.5 truncate text-xs tabular-nums text-muted">
                        {formatNumber(q)} {touched ? 'on the sale' : 'sold'}
                        <span className="hidden sm:inline"> · {formatCurrency(per)} / {unit}</span>
                        {/* Phone has no value column: the value of what comes back, else the price. */}
                        <span className="sm:hidden">
                          {k > 0 ? <> · <span className="text-foreground">{formatNumber(value)}</span> back</> : <> · {formatNumber(per)} / {unit}</>}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 sm:gap-1">
                      <button type="button" className={stepBtn} onClick={() => set(it, k - 1)} disabled={k <= 0} aria-label={`One ${unit} fewer of ${it.product?.name}`}>
                        <Minus className="h-4 w-4" />
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="off"
                        value={k ? String(k) : ''}
                        placeholder="0"
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          if (!/^\d*$/.test(raw)) return; // whole boxes only
                          set(it, raw === '' ? 0 : parseInt(raw, 10));
                        }}
                        aria-label={`Boxes of ${it.product?.name} back`}
                        className="h-11 w-10 min-w-0 rounded-lg bg-elevated text-center text-base font-bold tabular-nums text-foreground ring-1 ring-white/[0.08] placeholder:font-normal placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-white/40 sm:h-9 sm:w-11 sm:text-sm"
                      />
                      <button type="button" className={stepBtn} onClick={() => set(it, k + 1)} disabled={k >= q} aria-label={`One ${unit} more of ${it.product?.name}`}>
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="hidden w-24 text-right text-sm font-semibold tabular-nums sm:block">
                      {k > 0 ? <span className="text-foreground">{formatCurrency(value)}</span> : <span className="text-faint">—</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* What will happen, in money and in words: the figure first, then how it is made up (each row
              is taken from the one above), then the account, then what becomes of the sale. */}
          {plan.boxesBack > 0 && (
            <div className="space-y-1.5 rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/[0.08]">
              {plan.cashBack > 0 ? (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-muted">Refund to the customer</span>
                  <span className="text-lg font-bold tabular-nums text-foreground">{formatCurrency(plan.cashBack)}</span>
                </div>
              ) : (
                // The boxes are worth no more than he still owes: nothing is handed back, his debt comes down.
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-muted">Off what he owes</span>
                    <span className="block text-xs text-faint">No cash back</span>
                  </span>
                  <span className="text-lg font-bold tabular-nums text-foreground">{formatCurrency(plan.owedCleared)}</span>
                </div>
              )}
              {(plan.discountBack > 0 || (plan.cashBack > 0 && plan.owedCleared > 0)) && (
                <div className="flex justify-between gap-3 text-xs text-muted">
                  <span>Boxes</span>
                  <span className="tabular-nums">{formatCurrency(plan.valueBack)}</span>
                </div>
              )}
              {plan.discountBack > 0 && (
                <div className="flex justify-between gap-3 text-xs text-muted">
                  <span>Discount on these boxes</span>
                  <span className="tabular-nums">−{formatCurrency(plan.discountBack)}</span>
                </div>
              )}
              {plan.cashBack > 0 && plan.owedCleared > 0 && (
                <div className="flex justify-between gap-3 text-xs text-amber-300">
                  <span>Off what he owes</span>
                  <span className="tabular-nums">−{formatCurrency(plan.owedCleared)}</span>
                </div>
              )}
              {plan.cashBack > 0 && (
                <div className="flex justify-between gap-3 text-xs text-muted">
                  <span>Comes out of</span>
                  <span className="truncate font-medium text-foreground">{accountName || 'no account (see below)'}</span>
                </div>
              )}
              <div className="border-t border-white/[0.06] pt-1.5 text-sm text-foreground">
                {plan.everything
                  ? <>The sale is cancelled — every box goes back into {placeName}.</>
                  : <>The sale becomes <span className="font-semibold tabular-nums">{formatCurrency(plan.newTotal)}</span>
                      {plan.newBalance > 0 && <span className="text-amber-300"> (still owes {formatCurrency(plan.newBalance)})</span>}
                      {' '}— {formatNumber(plan.boxesBack)} {boxWord(plan.boxesBack)} {plan.boxesBack === 1 ? 'goes' : 'go'} back into {placeName}.</>}
              </div>
            </div>
          )}

          {blockedCredit && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              A credit sale comes back whole: tap All to return every box, or cancel it.
            </div>
          )}
          {plan.cashBack > 0 && inLedger + 0.005 < plan.cashBack && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
              Only {formatCurrency(inLedger)} of this sale is in the accounts, so no more than that comes out of them.
            </div>
          )}

          <ReasonField optional value={reason} onChange={setReason} chips={REFUND_REASONS} />
        </div>
      )}
    </Modal>
  );
}
