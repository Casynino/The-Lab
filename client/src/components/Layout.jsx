import { LIVE, STEADY } from '@/lib/polling';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import {
  LayoutDashboard, Package, Boxes, Truck, ShoppingCart, Users, HandCoins, Undo2,
  ClipboardCheck, UserCog, Repeat, BarChart3, ScrollText, ShieldCheck, Settings,
  Bell, Menu, X, LogOut, ChevronDown, ChevronLeft, ChevronRight, User, Lock, Eye, EyeOff, Loader2,
  Ship, Globe, ClipboardList, Timer, Coins, NotebookPen, Activity, Flag, TrendingUp, Receipt,
  Wallet, Wrench, QrCode, Search, CornerDownLeft,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { NAV, NAV_GROUPS, ROLE_LABELS, ROLES } from '@/lib/constants';
import { initials, fromNow } from '@/lib/format';
import { tzDateLabel } from '@/lib/tz';
import api, { unwrap, apiError } from '@/lib/api';
import { Modal, Button, Field, Input } from '@/components/ui';

const ICONS = {
  LayoutDashboard, Package, Boxes, Truck, ShoppingCart, Users, HandCoins, Undo2,
  ClipboardCheck, UserCog, Repeat, BarChart3, ScrollText, ShieldCheck, Settings,
  Ship, Globe, ClipboardList, Timer, Coins, NotebookPen, Activity, Flag, TrendingUp, Receipt,
  Wrench, QrCode,
};

// The first group has no header — it is the way back to everything — so it
// sits under MAIN on its own. Every department below it is the workspace.
const MAIN_KEYS = ['home'];

const SIDEBAR_KEY = 'lab.sidebar.collapsed';
const GROUPS_KEY = 'lab.sidebar.groups';

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

// Small "action required" count pill (e.g. pending settlements/returns).
function CountPill({ count, className }) {
  if (!count) return null;
  return (
    <span className={clsx(
      'flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white shadow-[0_0_10px_-2px_rgba(244,63,94,0.7)]',
      className,
    )}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

function useActiveMatcher() {
  const location = useLocation();
  return (item) => {
    const { pathname } = location;
    if (item.to === '/') return pathname === '/';
    return pathname === item.to || pathname.startsWith(`${item.to}/`);
  };
}

// Groups the visible NAV items into their sections, in the declared order,
// dropping any section the signed-in role cannot see anything in.
function useSections(items) {
  return useMemo(() => {
    const built = NAV_GROUPS.map(([key, label, icon]) => ({
      key, label, icon,
      items: items.filter((i) => i.group === key),
    })).filter((g) => g.items.length > 0);
    return {
      main: built.filter((g) => MAIN_KEYS.includes(g.key)),
      workspace: built.filter((g) => !MAIN_KEYS.includes(g.key)),
    };
  }, [items]);
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

function Brand({ collapsed }) {
  return (
    <div className={clsx('flex items-center gap-3', collapsed && 'justify-center')}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-slate-950 shadow-[0_6px_18px_-6px_rgba(163,230,53,0.65)]">
        <Boxes className="h-5 w-5" />
      </div>
      {!collapsed && (
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-white">The Lab</div>
          <div className="truncate text-[11px] text-faint">Hao Stock</div>
        </div>
      )}
    </div>
  );
}

function NavRow({ item, count, active, collapsed, onNavigate, indent }) {
  const Icon = ICONS[item.icon] || Package;
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={clsx(
        'group relative flex items-center rounded-lg text-sm transition-colors duration-150',
        collapsed ? 'h-10 w-10 justify-center' : indent ? 'gap-2.5 py-[7px] pl-8 pr-2.5' : 'gap-2.5 px-2.5 py-[7px]',
        active ? 'bg-white/[0.07] font-semibold text-white' : 'font-medium text-muted hover:bg-white/[0.05] hover:text-white',
      )}
    >
      {/* The accent bar is the only thing that says "you are here" — it reads
          from the corner of the eye without colouring the whole row. */}
      {active && (
        <span className={clsx(
          'absolute rounded-full bg-brand-400',
          collapsed ? '-left-2 top-1/2 h-5 w-[3px] -translate-y-1/2' : 'left-0 top-1/2 h-4 w-[3px] -translate-y-1/2',
        )} />
      )}
      <Icon className={clsx('h-4 w-4 shrink-0', active ? 'text-brand-400' : 'text-faint group-hover:text-muted')} />
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {!collapsed && <CountPill count={count} />}
      {collapsed && count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-[#0b0b0d]" />
      )}
    </NavLink>
  );
}

function Section({ title, groups, counts, collapsed, open, toggle, onNavigate }) {
  const isActive = useActiveMatcher();
  if (groups.length === 0) return null;

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 border-t border-white/[0.06] py-2 first:border-0">
        {groups.flatMap((g) => g.items).map((item) => (
          <NavRow key={item.to} item={item} count={counts[item.badge] || 0}
            active={isActive(item)} collapsed onNavigate={onNavigate} />
        ))}
      </div>
    );
  }

  return (
    <div className="px-3">
      <div className="px-2.5 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-faint/80">{title}</div>
      <div className="space-y-0.5">
        {groups.map((g) => {
          // A section with no header of its own (Home) is just its rows.
          if (!g.label) {
            return g.items.map((item) => (
              <NavRow key={item.to} item={item} count={counts[item.badge] || 0}
                active={isActive(item)} onNavigate={onNavigate} />
            ));
          }
          const GroupIcon = ICONS[g.icon] || Package;
          const anyActive = g.items.some(isActive);
          const pending = g.items.reduce((n, i) => n + (counts[i.badge] || 0), 0);
          const expanded = open[g.key] !== false || anyActive;
          return (
            <div key={g.key}>
              <button
                type="button"
                onClick={() => toggle(g.key)}
                className={clsx(
                  'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-sm font-medium transition-colors duration-150',
                  anyActive ? 'text-white' : 'text-zinc-300 hover:bg-white/[0.05] hover:text-white',
                )}
              >
                <GroupIcon className={clsx('h-4 w-4 shrink-0', anyActive ? 'text-brand-400' : 'text-faint')} />
                <span className="flex-1 truncate text-left">{g.label}</span>
                {!expanded && <CountPill count={pending} className="h-4 min-w-[16px] px-1 text-[10px]" />}
                <ChevronDown className={clsx('h-3.5 w-3.5 shrink-0 text-faint transition-transform duration-200', !expanded && '-rotate-90')} />
              </button>
              {expanded && (
                <div className="relative space-y-0.5 pb-1">
                  {/* A hairline runs behind the children so a department reads
                      as one thing instead of four neighbours. */}
                  <span className="absolute bottom-1 left-[17px] top-0 w-px bg-white/[0.07]" aria-hidden="true" />
                  {g.items.map((item) => (
                    <NavRow key={item.to} item={item} count={counts[item.badge] || 0}
                      active={isActive(item)} indent onNavigate={onNavigate} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UserCard({ user, collapsed, onProfile, onPassword, onNotifications, onSignOut, unread }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative border-t border-white/[0.06] p-3">
      {open && <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />}
      {open && (
        <div className={clsx(
          'absolute bottom-[calc(100%-0.25rem)] z-20 overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl',
          // In the rail there is no width to borrow, so the menu stands out
          // from it rather than trying to fit inside 72px.
          collapsed ? 'left-2 w-56' : 'left-3 right-3',
        )}>
          <div className="border-b border-border px-4 py-3">
            <div className="truncate text-sm font-semibold text-foreground">{user?.name}</div>
            <div className="truncate text-[11px] text-faint">{ROLE_LABELS[user?.role] || user?.role}</div>
          </div>
          <button onClick={() => { setOpen(false); onProfile(); }}
            className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left text-sm text-muted transition hover:bg-elevated hover:text-foreground">
            <User className="h-4 w-4" /> My profile
          </button>
          <button onClick={() => { setOpen(false); onNotifications(); }}
            className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left text-sm text-muted transition hover:bg-elevated hover:text-foreground">
            <Bell className="h-4 w-4" /> Notifications
            <CountPill count={unread} className="ml-auto h-4 min-w-[16px] px-1 text-[10px]" />
          </button>
          <button onClick={() => { setOpen(false); onPassword(); }}
            className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left text-sm text-muted transition hover:bg-elevated hover:text-foreground">
            <Lock className="h-4 w-4" /> Change password
          </button>
          <div className="border-t border-border" />
          <button onClick={onSignOut}
            className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left text-sm text-rose-400 transition hover:bg-rose-500/10">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={collapsed ? user?.name : undefined}
        className={clsx(
          'flex w-full cursor-pointer items-center rounded-xl py-2 transition hover:bg-white/[0.05]',
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-2',
        )}
      >
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-xs font-bold text-brand-300 ring-1 ring-brand-500/25">
          {initials(user?.name)}
          {unread > 0 && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-[#0b0b0d]" />}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-semibold text-white">{user?.name}</span>
              <span className="block truncate text-[11px] text-faint">{ROLE_LABELS[user?.role] || user?.role}</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-faint" />
          </>
        )}
      </button>
    </div>
  );
}

function SidebarBody({ items, counts, collapsed, onNavigate, user, unread, onSearch, onProfile, onPassword, onNotifications, onSignOut }) {
  const { main, workspace } = useSections(items);
  const [open, setOpen] = useState(() => readStore(GROUPS_KEY, {}));
  const toggle = (key) => setOpen((prev) => {
    const next = { ...prev, [key]: prev[key] === false };
    writeStore(GROUPS_KEY, next);
    return next;
  });

  return (
    <>
      <div className={clsx('pt-4', collapsed ? 'px-3' : 'px-4')}>
        <Brand collapsed={collapsed} />
      </div>

      {/* Every page by name, one keystroke away. A system this size stops
          being navigable by menu alone once you know where you are going. */}
      <button
        type="button"
        onClick={onSearch}
        title={collapsed ? 'Search pages' : undefined}
        className={clsx(
          'mt-4 flex cursor-pointer items-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-sm text-faint transition hover:border-white/15 hover:text-muted',
          collapsed ? 'mx-3 h-10 w-10 justify-center' : 'mx-4 gap-2.5 px-3 py-2',
        )}
      >
        <Search className="h-4 w-4 shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 text-left">Search pages</span>
            <kbd className="hidden rounded border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-semibold text-faint md:inline-block">⌘K</kbd>
          </>
        )}
      </button>

      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-4">
        <Section title="Main" groups={main} counts={counts} collapsed={collapsed} open={open} toggle={toggle} onNavigate={onNavigate} />
        <Section title="Workspace" groups={workspace} counts={counts} collapsed={collapsed} open={open} toggle={toggle} onNavigate={onNavigate} />
      </div>

      <UserCard user={user} collapsed={collapsed} unread={unread}
        onProfile={onProfile} onPassword={onPassword} onNotifications={onNotifications} onSignOut={onSignOut} />
    </>
  );
}

// ── Search every page ────────────────────────────────────────────────────────

function PagePalette({ items, onClose }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);

  const groupLabel = Object.fromEntries(NAV_GROUPS.map(([key, label]) => [key, label || 'Main']));
  const term = q.trim().toLowerCase();
  const results = items
    .filter((i) => !term || i.label.toLowerCase().includes(term) || (groupLabel[i.group] || '').toLowerCase().includes(term))
    .slice(0, 9);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setCursor(0); }, [q]);

  const go = (item) => { if (item) { onClose(); navigate(item.to); } };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[cursor]); }
    else if (e.key === 'Escape') { onClose(); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: -12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Go to a page…"
            className="w-full bg-transparent py-3.5 text-sm text-foreground outline-none placeholder:text-faint"
          />
          <kbd className="shrink-0 rounded border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-semibold text-faint">Esc</kbd>
        </div>
        {results.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted">No page by that name.</div>
        ) : (
          <ul className="max-h-[52vh] overflow-y-auto p-2">
            {results.map((item, i) => {
              const Icon = ICONS[item.icon] || Package;
              return (
                <li key={item.to}>
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => go(item)}
                    className={clsx(
                      'flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition',
                      i === cursor ? 'bg-brand-500/15 text-white' : 'text-muted hover:bg-white/[0.04]',
                    )}
                  >
                    <Icon className={clsx('h-4 w-4 shrink-0', i === cursor ? 'text-brand-400' : 'text-faint')} />
                    <span className="flex-1 truncate font-medium">{item.label}</span>
                    <span className="shrink-0 text-[11px] text-faint">{groupLabel[item.group]}</span>
                    {i === cursor && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-faint" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </motion.div>
    </div>
  );
}

// ── The banner ───────────────────────────────────────────────────────────────

function Banner({ user, unread, onBell }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.2, 0.7, 0.3, 1] }}
      className="relative mb-4 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a1210] shadow-[0_18px_50px_-30px_rgba(0,0,0,0.9)] sm:mb-5"
    >
      <img
        src="/banner.webp"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover object-right"
      />
      {/* The photograph is a backdrop, not a picture: it has to give way under
          the words however narrow the window gets. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#0a1210] via-[#0a1210]/85 to-[#0a1210]/10" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" aria-hidden="true" />

      <button
        type="button"
        onClick={onBell}
        aria-label="Notifications"
        className="absolute left-3 top-3 z-10 hidden cursor-pointer rounded-full border border-white/10 bg-black/30 p-2 text-white/70 backdrop-blur transition hover:border-white/20 hover:text-white sm:block"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      <div className="relative flex flex-col items-center justify-center px-4 py-5 text-center sm:px-12 sm:py-9">
        <div className="flex w-full items-center justify-center gap-3 sm:gap-4">
          <span className="hidden h-px w-8 bg-gradient-to-r from-transparent to-brand-400/70 sm:block" aria-hidden="true" />
          <h1 className="min-w-0 truncate text-[15px] font-semibold uppercase tracking-[0.16em] text-white sm:text-3xl sm:tracking-[0.3em]">
            {user?.name || 'The Lab'}
          </h1>
          <span className="hidden h-px w-8 bg-gradient-to-l from-transparent to-brand-400/70 sm:block" aria-hidden="true" />
        </div>
        <p className="mt-1.5 text-[9px] font-semibold uppercase tracking-[0.3em] text-brand-400 sm:mt-2 sm:text-[11px]">
          {ROLE_LABELS[user?.role] || user?.role}
        </p>
        <p className="mt-1 text-[11px] text-white/50 sm:mt-1.5 sm:text-sm">
          {tzDateLabel({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>
    </motion.div>
  );
}

// ── Notifications ────────────────────────────────────────────────────────────

function BellPanel({ unread, notes, onClose, onReadAll, onReadOne, onViewAll, position }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className={clsx('absolute z-50 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl', position)}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-foreground">
            Notifications
            {unread > 0 && <span className="ml-1.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{unread}</span>}
          </span>
          {unread > 0 && (
            <button onClick={onReadAll} className="cursor-pointer text-xs text-brand-400 hover:underline">Mark all read</button>
          )}
        </div>
        {notes.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted">You're all caught up.</div>
        ) : (
          <ul className="max-h-72 divide-y divide-border overflow-y-auto">
            {notes.map((n) => (
              <li key={n.id} className={clsx('flex items-start gap-3 px-4 py-3', !n.isRead && 'bg-brand-500/5')}>
                <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', !n.isRead ? 'bg-brand-500' : 'bg-transparent')} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-foreground">{n.title}</div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-muted">{n.message}</div>
                  <div className="mt-1 text-[10px] text-faint">{fromNow(n.createdAt)}</div>
                </div>
                {!n.isRead && (
                  <button onClick={() => onReadOne(n.id)} className="shrink-0 cursor-pointer text-[10px] text-brand-400 hover:underline">Read</button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-border p-2 text-center">
          <button onClick={onViewAll} className="cursor-pointer text-sm text-brand-400 hover:underline">View all notifications →</button>
        </div>
      </div>
    </>
  );
}

function ChangePasswordModal({ onClose }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);

  const change = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword: current, newPassword: next }),
    onSuccess: () => { toast.success('Password updated'); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const mismatch = next && confirm && next !== confirm;
  const valid = current.length > 0 && next.length >= 6 && next === confirm;

  return (
    <Modal open onClose={onClose} title="Change password"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={!valid || change.isPending} onClick={() => change.mutate()}>
          {change.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
          Update password
        </Button>
      </>}>
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
      </div>
    </Modal>
  );
}

// ── Layout ───────────────────────────────────────────────────────────────────

export default function Layout() {
  const { user, logout, hasRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => readStore(SIDEBAR_KEY, false));
  const [bellOpen, setBellOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  // `exact: true` items show ONLY to the listed roles (hasRole always
  // admits admins, which is wrong for rep-only pages like Commissions).
  const items = NAV.filter((n) => (n.exact ? n.roles.includes(user?.role) : hasRole(...n.roles)));

  const toggleCollapsed = () => setCollapsed((v) => { writeStore(SIDEBAR_KEY, !v); return !v; });

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { data: unread = 0 } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: async () => unwrap(await api.get('/notifications/unread-count')).data.unread,
    refetchInterval: STEADY,
  });

  // Pending-action counts for the sidebar badges (staff/admin only). Each item
  // stays counted until it's approved or rejected.
  const { data: pendingActions = {} } = useQuery({
    queryKey: ['dashboard', 'pending-actions'],
    queryFn: async () => unwrap(await api.get('/dashboard/pending-actions')).data,
    enabled: hasRole(ROLES.WAREHOUSE_STAFF),
    refetchInterval: STEADY,
  });

  const { data: recentNotes = [] } = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: async () => unwrap(await api.get('/notifications', { params: { limit: 6, page: 1 } })).data,
    enabled: bellOpen,
    refetchInterval: bellOpen ? LIVE : false,
  });

  const markAllRead = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markOneRead = useMutation({
    mutationFn: (id) => api.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const sidebarProps = {
    items,
    counts: pendingActions,
    user,
    unread,
    onSearch: () => { setMobileOpen(false); setPaletteOpen(true); },
    onProfile: () => { setMobileOpen(false); navigate('/profile'); },
    onPassword: () => { setMobileOpen(false); setShowPasswordModal(true); },
    onNotifications: () => { setMobileOpen(false); navigate('/notifications'); },
    onSignOut: logout,
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar (desktop) */}
      <aside className={clsx(
        'relative hidden shrink-0 flex-col border-r border-white/[0.07] bg-[#0b0b0d] transition-[width] duration-200 md:sticky md:top-0 md:flex md:h-screen',
        collapsed ? 'w-[72px]' : 'w-[248px] xl:w-[264px]',
      )}>
        <SidebarBody {...sidebarProps} collapsed={collapsed} />
        {/* The handle sits on the seam, the way a drawer pull does. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute -right-3 top-7 z-20 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-elevated text-faint shadow-lg transition hover:border-brand-500/40 hover:text-brand-300"
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </aside>

      {/* Sidebar (mobile drawer) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <motion.aside
            initial={{ x: -24, opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="absolute left-0 top-0 flex h-full w-[82vw] max-w-[300px] flex-col border-r border-white/[0.07] bg-[#0b0b0d]"
          >
            <button onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 z-10 cursor-pointer rounded-lg p-2 text-faint hover:bg-white/[0.06] hover:text-white">
              <X className="h-5 w-5" />
            </button>
            <SidebarBody {...sidebarProps} collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </motion.aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* On a phone the menu and the bell have to stay reachable, so they sit
            in a thin bar of their own above everything. */}
        <div className="glass sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 md:hidden">
          <button className="cursor-pointer rounded-lg p-2 text-muted hover:bg-elevated hover:text-white" onClick={() => setMobileOpen(true)} aria-label="Menu">
            <Menu className="h-5 w-5" />
          </button>
          <span className="flex-1 truncate text-sm font-semibold text-white/80">
            {tzDateLabel({ weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
          <button onClick={() => setPaletteOpen(true)} className="cursor-pointer rounded-lg p-2 text-muted hover:bg-elevated hover:text-white" aria-label="Search pages">
            <Search className="h-5 w-5" />
          </button>
          <div className="relative">
            <button onClick={() => setBellOpen((v) => !v)} className="relative cursor-pointer rounded-lg p-2 text-muted hover:bg-elevated hover:text-white" aria-label="Notifications">
              <Bell className="h-5 w-5" />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
          </div>
        </div>

        <main className="flex-1 overflow-x-clip p-3 sm:p-4 lg:p-6">
          <div className="mx-auto w-full max-w-[1400px]">
            <div className="relative">
              <Banner user={user} unread={unread} onBell={() => setBellOpen((v) => !v)} />
              {/* One panel for both: pinned under the phone's top bar wherever
                  the page is scrolled to, hung off the banner's bell above it. */}
              {bellOpen && (
                <BellPanel position="max-sm:fixed max-sm:inset-x-3 max-sm:top-[4.25rem] max-sm:w-auto sm:left-3 sm:top-14" unread={unread} notes={recentNotes} onClose={() => setBellOpen(false)}
                  onReadAll={() => markAllRead.mutate()} onReadOne={(id) => markOneRead.mutate(id)}
                  onViewAll={() => { setBellOpen(false); navigate('/notifications'); }} />
              )}
            </div>
            {/* Cap width on ultra-wide monitors so content stays readable & centered. */}
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            >
              <Outlet />
            </motion.div>
          </div>
        </main>
      </div>

      {paletteOpen && <PagePalette items={items} onClose={() => setPaletteOpen(false)} />}
      {showPasswordModal && <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />}
    </div>
  );
}
