import { useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  LayoutDashboard, Package, Boxes, Truck, ShoppingCart, Users, HandCoins, Undo2,
  ClipboardCheck, UserCog, Repeat, BarChart3, ScrollText, ShieldCheck, Settings,
  Bell, Menu, X, LogOut, ChevronDown, User, Lock, Eye, EyeOff, Loader2,
  Ship, Globe, ClipboardList, Timer, Coins, NotebookPen, Activity, Flag, TrendingUp, Receipt, Wallet, Wrench,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { NAV, NAV_GROUPS, ROLE_LABELS, ROLES } from '@/lib/constants';
import { initials, fromNow } from '@/lib/format';
import api, { unwrap, apiError } from '@/lib/api';
import { Modal, Button, Field, Input } from '@/components/ui';

const ICONS = {
  LayoutDashboard, Package, Boxes, Truck, ShoppingCart, Users, HandCoins, Undo2,
  ClipboardCheck, UserCog, Repeat, BarChart3, ScrollText, ShieldCheck, Settings,
  Ship, Globe, ClipboardList, Timer, Coins, NotebookPen, Activity, Flag, TrendingUp, Receipt,
  Wrench,
};

// Small "action required" count pill (e.g. pending settlements/returns).
function CountPill({ count }) {
  if (!count) return null;
  return (
    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white shadow-[0_0_10px_-2px_rgba(244,63,94,0.7)]">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function NavItems({ items, counts = {}, onNavigate }) {
  const location = useLocation();
  const countFor = (item) => (item.badge ? counts[item.badge] || 0 : 0);

  const isItemActive = (item) => {
    const { pathname } = location;
    if (item.to === '/') return pathname === '/';
    return pathname === item.to || pathname.startsWith(`${item.to}/`);
  };

  const renderLink = (item, indent = false) => {
    const Icon = ICONS[item.icon] || Package;
    const active = isItemActive(item);
    return (
      <NavLink
        key={item.to}
        to={item.to}
        onClick={onNavigate}
        className={`flex items-center gap-2.5 rounded-lg py-2 pr-3 text-sm font-medium transition-all duration-200 ${indent ? 'pl-5' : 'pl-2.5'} ${
          active
            ? 'bg-brand-500/15 text-brand-300 ring-1 ring-inset ring-brand-500/30'
            : 'text-muted hover:bg-white/[0.06] hover:text-white'
        }`}
      >
        <Icon className="h-4 w-4 flex-shrink-0" />
        <span className="flex-1 truncate">{item.label}</span>
        <CountPill count={countFor(item)} />
      </NavLink>
    );
  };

  // Sections in daily-workflow order; a header only shows when the role can
  // see something inside it. Items sharing a `sub` label render as an indented
  // cluster (e.g. Operations → Stock Management).
  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
      {NAV_GROUPS.map(([key, label, groupIcon], gi) => {
        const groupItems = items.filter((i) => i.group === key);
        if (groupItems.length === 0) return null;
        const GroupIcon = ICONS[groupIcon] || Package;
        const rows = [];
        let lastSub = null;
        for (const item of groupItems) {
          if (item.sub && item.sub !== lastSub) {
            rows.push(
              <div key={`sub-${item.sub}`} className="pb-0.5 pl-3 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-faint/70">
                {item.sub}
              </div>,
            );
          }
          lastSub = item.sub || null;
          rows.push(renderLink(item, !!item.sub));
        }
        // Home belongs to no department — it is the way back to everything,
        // so it stands alone with no header and no rail above it.
        if (!label) {
          return <div key={key} className="space-y-0.5 pb-1">{rows}</div>;
        }
        return (
          <div key={key} className={gi > 0 ? 'pt-4' : ''}>
            {/* The section header carries its own icon, so a group reads as a
                department rather than grey text floating above a list. */}
            <div className="flex items-center gap-2 px-2 pb-1.5">
              <GroupIcon className="h-3.5 w-3.5 shrink-0 text-faint" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">{label}</span>
            </div>
            {/* A hairline rail down the left, with the items hanging off it —
                the group is visibly one thing instead of neighbours. */}
            <div className="ml-[15px] space-y-0.5 border-l border-white/[0.08] pl-2">{rows}</div>
          </div>
        );
      })}
    </nav>
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

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-5 py-5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-slate-950 shadow-[0_4px_16px_-4px_rgba(163,230,53,0.5)]">
        <Boxes className="h-5 w-5" />
      </div>
      <div className="text-sm font-bold uppercase tracking-wide text-white">The Lab</div>
    </div>
  );
}

export default function Layout() {
  const { user, logout, hasRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  // `exact: true` items show ONLY to the listed roles (hasRole always
  // admits admins, which is wrong for rep-only pages like Commissions).
  const items = NAV.filter((n) => (n.exact ? n.roles.includes(user?.role) : hasRole(...n.roles)));

  const { data: unread = 0 } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: async () => unwrap(await api.get('/notifications/unread-count')).data.unread,
    refetchInterval: 30_000,
  });

  // Pending-action counts for the sidebar badges (staff/admin only). Each item
  // stays counted until it's approved or rejected.
  const { data: pendingActions = {} } = useQuery({
    queryKey: ['dashboard', 'pending-actions'],
    queryFn: async () => unwrap(await api.get('/dashboard/pending-actions')).data,
    enabled: hasRole(ROLES.WAREHOUSE_STAFF),
    refetchInterval: 30_000,
  });

  const { data: recentNotes = [] } = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: async () => unwrap(await api.get('/notifications', { params: { limit: 6, page: 1 } })).data,
    enabled: bellOpen,
    refetchInterval: bellOpen ? 30_000 : false,
  });

  const markAllRead = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markOneRead = useMutation({
    mutationFn: (id) => api.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <div className="flex min-h-screen bg-elevated">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 flex-col border-r border-border bg-[#0c0c0e] md:sticky md:top-0 md:flex md:h-screen xl:w-64">
        <Brand />
        <NavItems items={items} counts={pendingActions} />
        {/* Who is signed in, then the way out — the two things a sidebar foot
            is for. The credit line stays, quietly, beneath them. */}
        <div className="border-t border-white/[0.07] p-3">
          <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.04] px-2.5 py-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-xs font-bold text-brand-300">
              {initials(user?.name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-white">{user?.name}</div>
              <div className="truncate text-[11px] text-faint">{ROLE_LABELS[user?.role] || user?.role}</div>
            </div>
          </div>
          <button
            onClick={logout}
            className="mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/[0.08] py-2 text-sm font-medium text-muted transition duration-200 hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-300"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
          <div className="mt-2.5 text-center text-[10px] text-faint/70">
            <span className="font-semibold uppercase tracking-wider">The Lab</span> · Developed by Nino
          </div>
        </div>
      </aside>

      {/* Sidebar (mobile drawer) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col border-r border-border bg-[#0c0c0e]">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-faint hover:bg-slate-800">
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavItems items={items} counts={pendingActions} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b px-4 lg:px-6">
          <button className="rounded-lg p-2 text-muted hover:bg-elevated md:hidden" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />

          <div className="relative">
            <button
              onClick={() => setBellOpen((v) => !v)}
              className="relative rounded-lg p-2 text-muted hover:bg-elevated"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
            {bellOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setBellOpen(false)} />
                <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-border bg-surface shadow-xl">
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <span className="text-sm font-semibold text-foreground">
                      Notifications
                      {unread > 0 && <span className="ml-1.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{unread}</span>}
                    </span>
                    {unread > 0 && (
                      <button onClick={() => markAllRead.mutate()} className="text-xs text-brand-500 hover:underline">
                        Mark all read
                      </button>
                    )}
                  </div>
                  {recentNotes.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted">You're all caught up!</div>
                  ) : (
                    <ul className="max-h-72 divide-y divide-border overflow-y-auto">
                      {recentNotes.map((n) => (
                        <li key={n.id} className={`flex items-start gap-3 px-4 py-3 ${!n.isRead ? 'bg-brand-500/5' : ''}`}>
                          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${!n.isRead ? 'bg-brand-500' : 'bg-transparent'}`} />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold text-foreground">{n.title}</div>
                            <div className="mt-0.5 line-clamp-2 text-xs text-muted">{n.message}</div>
                            <div className="mt-1 text-[10px] text-faint">{fromNow(n.createdAt)}</div>
                          </div>
                          {!n.isRead && (
                            <button onClick={() => markOneRead.mutate(n.id)} className="shrink-0 text-[10px] text-brand-500 hover:underline">
                              Read
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="border-t border-border p-2 text-center">
                    <button
                      onClick={() => { setBellOpen(false); navigate('/notifications'); }}
                      className="text-sm text-brand-500 hover:underline"
                    >
                      View all notifications →
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-elevated"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                {initials(user?.name)}
              </span>
              <span className="hidden text-left sm:block">
                <span className="block text-sm font-semibold leading-tight text-foreground">{user?.name}</span>
                <span className="block text-[11px] text-muted">{ROLE_LABELS[user?.role] || user?.role}</span>
              </span>
              <ChevronDown className="hidden h-4 w-4 text-faint sm:block" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-20 mt-2 w-52 rounded-xl border border-border bg-surface py-1 shadow-xl">
                  <div className="border-b border-border px-4 py-3">
                    <div className="truncate text-sm font-semibold text-foreground">{user?.name}</div>
                    <div className="truncate text-xs text-muted">{user?.email}</div>
                  </div>
                  <button
                    onClick={() => { setMenuOpen(false); navigate('/profile'); }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-muted hover:bg-elevated hover:text-foreground"
                  >
                    <User className="h-4 w-4" /> View Profile
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); navigate(user?.role === ROLES.ADMIN ? '/settings' : '/profile'); }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-muted hover:bg-elevated hover:text-foreground"
                  >
                    <Settings className="h-4 w-4" /> Account Settings
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); setShowPasswordModal(true); }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-muted hover:bg-elevated hover:text-foreground"
                  >
                    <Lock className="h-4 w-4" /> Change Password
                  </button>
                  <div className="my-1 border-t border-border" />
                  <button
                    onClick={logout}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-rose-500 hover:bg-rose-500/10"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-x-clip p-4 lg:p-6">
          {/* Cap width on ultra-wide monitors so content stays readable & centered. */}
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="mx-auto w-full max-w-[1400px]"
          >
            <Outlet />
          </motion.div>
        </main>
      </div>

      {showPasswordModal && <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />}
    </div>
  );
}
