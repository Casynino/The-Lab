import { LIVE, STEADY } from '@/lib/polling';
import { InstallPrompt, InstallButton } from '@/components/InstallApp';
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
  Wallet, Wrench, QrCode, Search, Smartphone,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { NAV, NAV_GROUPS, ROLES } from '@/lib/constants';
import { repRegions, sayRegions } from '@/lib/repRegions';
import { tzDateLabel } from '@/lib/tz';
import { initials, fromNow } from '@/lib/format';
import api, { unwrap, apiError } from '@/lib/api';
import { Modal, Button, Field, Input } from '@/components/ui';

const ICONS = {
  LayoutDashboard, Package, Boxes, Truck, ShoppingCart, Users, HandCoins, Undo2,
  ClipboardCheck, UserCog, Repeat, BarChart3, ScrollText, ShieldCheck, Settings,
  Ship, Globe, ClipboardList, Timer, Coins, NotebookPen, Activity, Flag, TrendingUp, Receipt,
  Wrench, QrCode, Wallet,
};

/* The panel is folded to its rail when the system is first opened and stays
   however it was last left — the owner asked for it closed until he presses
   it open (8 Nov 2026), exactly as Target Express does it: a floating glass
   panel that folds to a rail of icons by the round button on its edge, the page
   making room for whichever it is. The key carries a version so that a panel
   somebody left open while it was being tried out starts on the rail again
   (10 Nov 2026); from then on it is remembered as before. */
const SIDEBAR_KEY = 'lab.sidebar.collapsed.v2';
const FOLD_KEY = 'lab.sidebar.folds';
const LABEL = 'pb-1 text-[10.5px] font-semibold uppercase tracking-[0.18em] g-dim';
const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60';

/** The room the page leaves for the floating panel, open and folded. */
const ROOM = { open: '15.5rem', rail: '5.9rem' };

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window */ }
}

function CountPill({ count, className }) {
  if (!count) return null;
  return (
    <span className={clsx(
      'flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white',
      className,
    )}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

/* Longest match wins, across the whole menu rather than row by row: rows can
   nest, and matching each one on its own lights two at once. */
function activeTo(items, pathname) {
  return items
    .filter((i) => (i.to === '/' ? pathname === '/' : pathname === i.to || pathname.startsWith(`${i.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0]?.to;
}

function useSections(items) {
  return useMemo(
    () => NAV_GROUPS
      .map(([key, label, icon]) => ({ key, label, icon, items: items.filter((i) => i.group === key) }))
      .filter((g) => g.items.length > 0),
    [items],
  );
}

/* Until the reader decides, the group holding the page they are on is open and
   the rest are folded, so a long menu reads as its headings. What they open or
   fold is remembered on this device. */
function useFolds(sections, current) {
  const [opened, setOpened] = useState(() => readStore(FOLD_KEY, {}));
  const activeGroup = sections.find((s) => s.label && s.items.some((i) => i.to === current))?.key;
  useEffect(() => {
    if (activeGroup && opened[activeGroup] === false) {
      setOpened((o) => ({ ...o, [activeGroup]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup]);
  const set = (key, open) => setOpened((o) => {
    const next = { ...o, [key]: open };
    writeStore(FOLD_KEY, next);
    return next;
  });
  return { opened, set, activeGroup };
}

// ── The panel ────────────────────────────────────────────────────────────────

function GlassSidebar({
  mode, items, counts, user, unread, collapsed = false, onCollapsedChange, onNavigate,
  onProfile, onPassword, onNotifications, onSignOut,
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const sections = useSections(items);
  const current = activeTo(items, pathname);
  const folds = useFolds(sections, current);
  const rail = mode === 'desktop' && collapsed;
  // The phone's drawer is read close up and has no room to spare, so it runs
  // tighter than the panel on a desk — smaller rows, smaller glyphs, less air
  // around everything. The desk panel is untouched by any of this.
  const sheet = mode === 'sheet';

  const [query, setQuery] = useState('');
  const searchRef = useRef(null);
  const focusAfterOpen = useRef(false);
  useEffect(() => setQuery(''), [pathname]);

  // ⌘K reaches the search from anywhere; [ folds and unfolds the panel.
  useEffect(() => {
    if (mode !== 'desktop') return undefined;
    const onKey = (e) => {
      const el = e.target;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (collapsed) { focusAfterOpen.current = true; onCollapsedChange?.(false); }
        else { searchRef.current?.focus(); searchRef.current?.select(); }
      } else if (e.key === '[' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        onCollapsedChange?.(!collapsed);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, collapsed, onCollapsedChange]);
  useEffect(() => {
    if (!collapsed && focusAfterOpen.current) {
      focusAfterOpen.current = false;
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [collapsed]);

  // The search runs over every page this person can open; a group's name finds
  // its pages too, so "money" finds Finance and Commissions.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const out = [];
    for (const s of sections) {
      for (const item of s.items) {
        const words = [item.label, s.label || 'Main'];
        if (!words.some((w) => w.toLowerCase().includes(q))) continue;
        out.push({ item, where: s.label || null });
      }
    }
    return out;
  }, [query, sections]);

  /* The name beside a rail icon, fixed to the window and drawn outside the
     panel: the frosted glass would otherwise trap it and the scrolling list
     would cut it off at the edge. */
  const [hint, setHint] = useState(null);
  const showHint = (target) => {
    const el = rail ? target?.closest?.('[data-hint]') : null;
    if (!el) return setHint(null);
    const box = el.getBoundingClientRect();
    return setHint({ label: el.dataset.hint, x: box.right + 12, y: box.top + box.height / 2 });
  };

  const brand = (compact) => (
    <NavLink to="/" onClick={onNavigate} data-hint="ZELab"
      className={clsx('flex min-w-0 items-center rounded-full', sheet ? 'gap-2.5' : 'gap-3', FOCUS)}>
      {/* Just "Lab" — the letters of the OFFICIAL logo, white. Nino, 10 Nov 2026, looking at
          this panel: "it should just say Lab, no need for ZELab up there" (the whole logo
          is on the sign-in page, the tab and the home-screen icon). The same word in the
          folded rail, smaller. The name is still here for a screen reader and for the
          rail's tooltip. Artwork: docs/mockups/official_logo.py. */}
      <img src="/brand/lab-dark.svg" alt="ZELab" width="330" height="194"
        className={clsx('w-auto shrink-0', compact ? 'h-6' : sheet ? 'h-7' : 'h-8')} />
    </NavLink>
  );

  const row = (item, child = false, where = null) => {
    const Icon = ICONS[item.icon] || Package;
    const active = item.to === current;
    const count = counts[item.badge] || 0;
    return (
      <li key={item.to}>
        <NavLink
          to={item.to}
          onClick={onNavigate}
          aria-current={active ? 'page' : undefined}
          className={clsx(
            'relative flex items-center rounded-lg',
            FOCUS,
            sheet
              ? clsx('px-2 text-[12px]', child ? 'min-h-7 gap-2 py-1' : 'min-h-8 gap-2.5 py-1.5')
              : clsx('gap-3 text-[13px]', child ? 'px-3 py-1.5' : 'px-3 py-2'),
            active ? 'glass-active font-medium g-strong' : 'glass-row g-text g-hover',
          )}
        >
          <Icon className={clsx('shrink-0', child ? (sheet ? 'size-[15px]' : 'size-4') : (sheet ? 'size-4' : 'h-[18px] w-[18px]'), active ? 'g-lime' : 'g-icon')} />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {where ? <span className="shrink-0 text-[11px] g-soft">{where}</span> : <CountPill count={count} />}
        </NavLink>
      </li>
    );
  };

  const footer = (
    <Footer rail={rail} mode={mode} user={user} unread={unread}
      onProfile={onProfile} onPassword={onPassword} onNotifications={onNotifications} onSignOut={onSignOut} />
  );

  const full = (
    <div className="flex h-full min-h-0 flex-col">
      <div className={clsx('flex items-center justify-between gap-2', sheet ? 'px-3 pb-2 pr-6 pt-3' : 'px-4 pb-2.5 pr-7 pt-3.5')}>
        {brand(false)}
        {mode === 'sheet' ? (
          <button type="button" onClick={onNavigate}
            className={clsx('glass-row grid size-9 shrink-0 place-items-center rounded-full g-text g-hover', FOCUS)}>
            <X className="h-[17px] w-[17px]" />
            <span className="sr-only">Close</span>
          </button>
        ) : null}
      </div>

      <div className={clsx('pb-1.5', sheet ? 'px-2.5' : 'px-3')}>
        <label className={clsx('glass-field flex items-center gap-2.5 g-soft', sheet ? 'px-2.5 py-1.5 text-[13px]' : 'px-3.5 py-2 text-sm')}>
          <Search className={clsx('shrink-0', sheet ? 'size-[15px]' : 'size-4')} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results?.[0]) {
                e.preventDefault();
                setQuery('');
                onNavigate?.();
                navigate(results[0].item.to);
              } else if (e.key === 'Escape') {
                if (query) setQuery(''); else e.currentTarget.blur();
              }
            }}
            placeholder="Search pages"
            aria-label="Search pages"
            /* 16px on the phone, always. An iPhone zooms the whole page into
               any field under that and never zooms back out — which is the
               "it zooms out and bounces big" the owner kept hitting when he
               opened this drawer (9 Nov 2026). The stylesheet has a net under
               this too, but the field should be right on its own. */
            className={clsx('g-input g-strong min-w-0 flex-1 bg-transparent outline-none', sheet ? 'text-[16px]' : 'text-sm')}
          />
          {query ? (
            <button type="button" onClick={() => { setQuery(''); searchRef.current?.focus(); }}
              className="g-soft g-hover grid size-5 shrink-0 place-items-center rounded-full">
              <X className="h-3.5 w-3.5" />
              <span className="sr-only">Clear search</span>
            </button>
          ) : (
            <kbd className="glass-kbd g-soft hidden shrink-0 rounded-md px-1.5 py-0.5 font-sans text-[10px] font-semibold lg:block">⌘K</kbd>
          )}
        </label>
      </div>

      <nav aria-label="Navigation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2 [scrollbar-width:thin]">
        {results ? (
          results.length ? (
            <ul className="mt-2 space-y-0.5">{results.map(({ item, where }) => row(item, false, where))}</ul>
          ) : (
            <p className="g-soft px-4 py-6 text-center text-sm">No page matches that.</p>
          )
        ) : (
          sections.map((s, i) => {
            const heading = i === 0 ? 'Main' : s.label && !sections[i - 1].label ? 'Workspace' : null;
            if (!s.label) {
              return (
                <div key={s.key} className={clsx(i > 0 && 'mt-2')}>
                  {heading ? <p className={clsx(LABEL, sheet ? 'px-3 pt-2.5' : 'px-4 pt-3')}>{heading}</p> : null}
                  <ul className="space-y-0.5">{s.items.map((item) => row(item))}</ul>
                </div>
              );
            }
            const GroupIcon = ICONS[s.icon] || Package;
            const here = s.items.some((item) => item.to === current);
            // On a phone the drawer is opened because somebody wants to GO
            // somewhere, so it shows the pages rather than the headings above
            // them. Folded, seven headings left two thirds of a full-height
            // panel empty and it read as a short card stranded at the top.
            // Open, the list fills the panel and scrolls — which is what a
            // menu is for. Folding one by hand still sticks, per device.
            const isOpen = folds.opened[s.key] ?? (sheet || here);
            const pending = s.items.reduce((n, item) => n + (counts[item.badge] || 0), 0);
            return (
              <div key={s.key} className="mt-0.5">
                {heading ? <p className={clsx(LABEL, sheet ? 'px-3 pt-3' : 'px-4 pt-4')}>{heading}</p> : null}
                <button
                  type="button"
                  onClick={() => folds.set(s.key, !isOpen)}
                  aria-expanded={isOpen}
                  className={clsx(
                    'glass-row g-hover flex w-full items-center rounded-lg text-left font-medium',
                    FOCUS,
                    sheet ? 'min-h-8 gap-2.5 px-2.5 py-1.5 text-[12.5px]' : 'gap-3 px-3 py-2 text-[13px]',
                    here ? 'g-strong' : 'g-text',
                  )}
                >
                  <GroupIcon className={clsx('shrink-0', sheet ? 'size-4' : 'h-[18px] w-[18px]', here ? 'g-lime' : 'g-icon')} />
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  {!isOpen && <CountPill count={pending} />}
                  <ChevronDown className={clsx('g-icon h-[15px] w-[15px] shrink-0 transition-transform duration-200', isOpen && 'rotate-180')} />
                </button>
                <div className={clsx('grid transition-[grid-template-rows] duration-200 ease-out', isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                  <div className="overflow-hidden">
                    {/* The phone's drawer is narrower than the desk panel, so
                        the branch gives back some of its indent, so even the
                        longest word in the menu never meets an ellipsis. */}
                    <ul className={clsx('glass-tree mt-1 space-y-0.5 pb-1', sheet ? 'ml-[1.15rem] pl-2.5' : 'ml-[1.7rem] pl-3.5')}>
                      {s.items.map((item) => row(item, true))}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </nav>

      {footer}
    </div>
  );

  const railView = (
    <div className="flex min-h-0 flex-1 flex-col items-center">
      <div className="pb-2 pt-4">{brand(true)}</div>
      <button
        type="button"
        data-hint="Search pages"
        onClick={() => { focusAfterOpen.current = true; onCollapsedChange?.(false); }}
        className={clsx('glass-row g-text g-hover mb-1 grid size-11 shrink-0 place-items-center rounded-full', FOCUS)}
      >
        <Search className="h-[18px] w-[18px]" />
        <span className="sr-only">Search pages</span>
      </button>
      <nav aria-label="Navigation" className="flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((s) => (
          <div key={s.key} className="flex w-full flex-col items-center">
            <div aria-hidden className="glass-divider my-1.5 w-7" />
            {s.items.map((item) => {
              const Icon = ICONS[item.icon] || Package;
              const active = item.to === current;
              const count = counts[item.badge] || 0;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  data-hint={item.label}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(
                    'relative mb-0.5 grid size-10 shrink-0 place-items-center rounded-full',
                    FOCUS,
                    active ? 'glass-active g-strong' : 'glass-row g-soft g-hover',
                  )}
                >
                  <Icon className={clsx('h-[17px] w-[17px]', active && 'g-lime')} />
                  {count > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-rose-500" />}
                  <span className="sr-only">{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>
      {footer}
    </div>
  );

  if (mode === 'sheet') return <div className="glass-panel glass-drawer flex h-full flex-col">{full}</div>;

  return (
    <aside
      aria-label="Navigation"
      onPointerOver={(e) => showHint(e.target)}
      onPointerLeave={() => setHint(null)}
      onFocusCapture={(e) => showHint(e.target)}
      onBlurCapture={() => setHint(null)}
      className={clsx('fixed left-3 top-3 z-30 hidden lg:block', rail ? 'w-[4.5rem]' : 'bottom-3 w-56')}
    >
      <div className={clsx('glass-panel flex flex-col', rail ? 'max-h-[calc(100dvh-1.5rem)]' : 'h-full')}>
        {rail ? railView : full}
      </div>

      {/* Fold and unfold, on the panel's own edge. */}
      <div className="group absolute -right-3.5 top-[1.65rem] z-10">
        <button
          type="button"
          onClick={() => onCollapsedChange?.(!collapsed)}
          aria-expanded={!collapsed}
          className="glass-chip grid size-7 cursor-pointer place-items-center rounded-full shadow-[0_4px_14px_rgba(0,0,0,0.45)] ring-1 ring-white/10 outline-none transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {collapsed ? <ChevronRight className="h-[15px] w-[15px]" strokeWidth={2.5} /> : <ChevronLeft className="h-[15px] w-[15px]" strokeWidth={2.5} />}
          <span className="sr-only">{collapsed ? 'Expand' : 'Collapse'}</span>
        </button>
        <span className="glass-chip pointer-events-none absolute left-9 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold opacity-0 shadow-lg transition group-hover:opacity-100">
          {collapsed ? 'Expand' : 'Collapse'}
          <kbd className="ml-1 rounded bg-white/10 px-1 font-sans text-[10px] opacity-70">[</kbd>
        </span>
      </div>

      {hint ? (
        <span role="tooltip" style={{ left: hint.x, top: hint.y }}
          className="glass-chip pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold shadow-lg">
          {hint.label}
        </span>
      ) : null}
    </aside>
  );
}

/* The foot of the panel: only the signed-in person, as initials and a first
   name — and the menu that opens from it says the same single name, no full
   name and no role line, for every role including the administrator (Nino,
   10 Nov 2026: "keep the name simple, just one name, not too many words").
   The full name and the role are on My profile. In the rail only the initials
   show. */
function Footer({ rail, mode, user, unread, onProfile, onPassword, onNotifications, onSignOut }) {
  const [open, setOpen] = useState(false);
  const firstName = (user?.name || '').trim().split(/\s+/)[0] || user?.name;
  const item = 'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-muted transition hover:bg-white/[0.06] hover:text-foreground';

  return (
    <div className={clsx('relative shrink-0', rail ? 'flex flex-col items-center pb-3' : 'px-3 pb-3', mode === 'sheet' && 'pb-[max(0.75rem,env(safe-area-inset-bottom))]')}>
      <div aria-hidden className="glass-divider mb-2 w-full" />
      {open && <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />}
      {open && (
        <div className={clsx(
          'absolute z-30 w-48 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-[0_12px_30px_-12px_rgba(0,0,0,0.75)]',
          rail ? 'bottom-2 left-[calc(100%+0.75rem)]' : 'bottom-[calc(100%-0.5rem)] left-3',
        )}>
          <div className="px-2.5 pb-1.5 pt-1">
            <span className="block truncate text-[13px] font-semibold leading-snug text-foreground">{firstName}</span>
          </div>
          <button className={item} onClick={() => { setOpen(false); onProfile(); }}><User className="h-3.5 w-3.5" /> My profile</button>
          <button className={item} onClick={() => { setOpen(false); onNotifications(); }}>
            <Bell className="h-3.5 w-3.5" /><span className="flex-1">Notifications</span><CountPill count={unread} />
          </button>
          <button className={item} onClick={() => { setOpen(false); onPassword(); }}><Lock className="h-3.5 w-3.5" /> Change password</button>
          {/* Draws nothing on a computer, or once it is on the home screen. */}
          <InstallButton render={(openSheet) => (
            <button className={item} onClick={() => { setOpen(false); openSheet(); }}>
              <Smartphone className="h-3.5 w-3.5" /> Get the app
            </button>
          )} />
          <div className="my-1 border-t border-border" />
          <button className={clsx(item, 'text-rose-400 hover:bg-rose-500/10 hover:text-rose-300')} onClick={onSignOut}>
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      )}
      <button
        type="button"
        title={firstName}
        data-hint={firstName}
        onClick={() => setOpen((v) => !v)}
        className={clsx('glass-row flex w-full cursor-pointer items-center gap-3 rounded-full text-left', FOCUS, rail ? 'justify-center p-1' : 'px-2 py-2')}
      >
        <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#2b3b20] to-[#141d0e] text-xs font-semibold text-brand-200 ring-1 ring-white/20">
          {initials(user?.name)}
          {unread > 0 && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-[#12150f]" />}
        </span>
        {rail ? <span className="sr-only">{firstName}</span>
          : <span className="g-strong min-w-0 flex-1 truncate text-sm font-semibold">{firstName}</span>}
      </button>
    </div>
  );
}

// ── The banner ───────────────────────────────────────────────────────────────

/* The banner is one short greeting, the same for everybody (Nino, 10 Nov 2026:
   "Mambo vipi? KP … Keep the stores stocked … the admin is the Director, no need
   to say Director"). First name only, in Swahili; no job title for anybody; a
   line that says what the person is here to do — and for a rep that line names
   THEIR region or regions ("Keep Arusha and Mwanza stocked."), which the owner
   sets when he adds the rep. Everyone else keeps the stores stocked.

   Left, where the eye starts, with the cartons on the right. The lines rise in
   one after another (hello-in, index.css): small, quick, and still for
   anybody who has asked their phone for less motion. */
function Banner({ user, unread, onBell }) {
  const name = (user?.name || 'ZELab').trim().split(/\s+/)[0] || user?.name;
  const regions = user?.role === ROLES.SALES_REP ? sayRegions(repRegions(user?.salesRep)) : '';
  const line = regions ? `Keep ${regions} stocked.` : 'Keep the stores stocked.';
  // "Mambo vipi? " is already twelve letters, so a long name would be cut off
  // ("Mambo vipi? …") on a phone. The type steps down a size as the whole
  // greeting gets longer, so every name is read in full; a computer has the
  // room and keeps one size.
  const greetLength = 'Mambo vipi? '.length + name.length;
  const greetSize = greetLength <= 18 ? 'text-[1.65rem]' : greetLength <= 22 ? 'text-[1.45rem]' : greetLength <= 26 ? 'text-[1.3rem]' : 'text-[1.15rem]';

  return (
    <section className="relative mb-4 overflow-hidden rounded-2xl text-white ring-1 ring-white/10 shadow-[0_12px_30px_-14px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.10)]"
      style={{ background: 'linear-gradient(120deg,#140807 0%,#2a0f0b 42%,#4a1711 72%,#6e2419 100%)' }}>
      {/* Depth, painted in: a light from the right, a little red from the top,
          and a fine sheen along the top edge. */}
      <div aria-hidden className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(600px 220px at 92% 60%, rgba(255,95,75,0.34), transparent 62%)' }} />
      <div aria-hidden className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(420px 150px at 50% -10%, rgba(238,49,36,0.20), transparent 70%)' }} />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />

      {/* The cartons at the side: softly on a phone, clearer on a computer. */}
      <div
        aria-hidden
        /* A phone has room for the words or for the cartons, not both: the
           window is narrower there and the picture quieter, so the second
           carton never cuts through the words. A desk shows the shelf. */
        className="pointer-events-none absolute inset-y-0 right-0 w-[40%] opacity-40 sm:w-[38%] sm:opacity-75 lg:w-[34%] lg:opacity-95"
        style={{ WebkitMaskImage: 'linear-gradient(to left,#000 20%,transparent)', maskImage: 'linear-gradient(to left,#000 20%,transparent)' }}
      >
        <img src="/banner.webp" alt="" className="h-full w-full object-cover" />
      </div>

      {/* The bell, on the RIGHT, as its own small glass button — over the
          cartons, which are only a picture. It used to hang at the left edge,
          where its badge sat on top of the greeting (Nino, 10 Nov 2026: "the
          notification is in the way, move it to the other side"). A phone has
          its bell in the top bar, so this is the computer's. */}
      <button
        type="button"
        onClick={onBell}
        aria-label="Notifications"
        className="focus-ring absolute right-4 top-4 z-10 hidden size-9 cursor-pointer place-items-center rounded-full bg-black/25 text-white/80 ring-1 ring-white/15 backdrop-blur-sm transition hover:bg-black/40 hover:text-white lg:grid"
      >
        <Bell className="h-[16px] w-[16px]" />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-[#2a0f0b]">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <div className="relative flex min-h-[5.5rem] min-w-0 flex-col justify-center px-5 py-4 text-left sm:min-h-[7rem] sm:px-7">
        <h1 className={clsx('hello-in max-w-full truncate leading-tight tracking-tight text-white sm:max-w-[60%] sm:text-3xl', greetSize)} style={{ '--i': 0 }}>
          <span className="font-normal text-white/70">Mambo vipi?</span>{' '}
          <span className="font-semibold">{name}</span>
        </h1>
        <p className="hello-in mt-1 max-w-[68%] text-[12.5px] leading-snug text-white/60 sm:max-w-[60%] sm:text-sm" style={{ '--i': 1 }}>
          {line}
        </p>
      </div>
    </section>
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
          {unread > 0 && <button onClick={onReadAll} className="cursor-pointer text-xs text-brand-600 hover:underline">Mark all read</button>}
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
                {!n.isRead && <button onClick={() => onReadOne(n.id)} className="shrink-0 cursor-pointer text-[10px] text-brand-600 hover:underline">Read</button>}
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-border p-2 text-center">
          <button onClick={onViewAll} className="cursor-pointer text-sm text-brand-600 hover:underline">View all notifications →</button>
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
  const [drawer, setDrawer] = useState(null); // null | 'menu' | 'search'
  const [collapsed, setCollapsed] = useState(() => readStore(SIDEBAR_KEY, true));
  const [bellOpen, setBellOpen] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  // A rep's money page is their wallet — the same page, the owner's word is "Commissions".
  const isRep = user?.role === ROLES.SALES_REP;
  const items = NAV
    .filter((n) => (n.exact ? n.roles.includes(user?.role) : hasRole(...n.roles)))
    .map((n) => (isRep && n.repLabel ? { ...n, label: n.repLabel, icon: n.repIcon || n.icon } : n));

  /* The banner belongs to the home page, not to the shell. Target Express puts
     it inside each desk's hero (components/app/desk-hero, warehouse-hero, the
     executive dashboard) and gives every other page a plain title instead — a
     name, a job title and today's date say nothing useful above a table of
     orders, and they cost a hundred and fifty pixels of the screen on every
     one of them. Every page in here already carries its own PageHeader. */
  const atHome = location.pathname === '/';

  // The bell hangs off the banner, so leaving home takes its anchor with it.
  useEffect(() => { setBellOpen(false); }, [location.pathname]);

  /* While the drawer is open the page behind it must not move.
     Without this the page keeps scrolling under the panel, and on a phone
     that scroll collapses the browser's address bar — which the page sees as
     the viewport changing height, so it reflows mid-animation and the whole
     screen jumps. The position is held and put back exactly. */
  useEffect(() => {
    if (!drawer) return undefined;
    const y = window.scrollY;
    const { body } = document;
    const was = {
      position: body.style.position, top: body.style.top,
      width: body.style.width, overflow: body.style.overflow,
    };
    body.style.position = 'fixed';
    body.style.top = `-${y}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    return () => {
      Object.assign(body.style, was);
      window.scrollTo(0, y);
    };
  }, [drawer]);

  const setFold = (next) => { writeStore(SIDEBAR_KEY, next); setCollapsed(next); };

  const { data: unread = 0 } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: async () => unwrap(await api.get('/notifications/unread-count')).data.unread,
    refetchInterval: STEADY,
  });

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

  const shared = {
    items,
    counts: pendingActions,
    user,
    unread,
    onProfile: () => { setDrawer(null); navigate('/profile'); },
    onPassword: () => { setDrawer(null); setShowPasswordModal(true); },
    onNotifications: () => { setDrawer(null); navigate('/notifications'); },
    onSignOut: logout,
  };

  // The phone's own bar along the bottom: the five places a day is spent.
  const TABS = [
    { to: '/', label: 'Home', icon: LayoutDashboard },
    { to: '/stock-requests', label: 'Requests', icon: ClipboardList, badge: pendingActions.stockRequests },
    { to: '/settlements', label: 'Settle', icon: Timer, badge: pendingActions.settlements },
    { to: '/finance', label: 'Money', icon: Wallet },
  ].filter((t) => items.some((i) => i.to === t.to));

  return (
    <div className="min-h-dvh bg-background">
      <GlassSidebar mode="desktop" {...shared} collapsed={collapsed} onCollapsedChange={setFold} />

      {/* The phone's drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Solid, not blurred: a full-screen backdrop-filter fading in over a
              sliding panel is two re-samples of the whole page per frame, and
              a phone shows that as a shudder. */}
          <div className="absolute inset-0 bg-[#050605]/80" onClick={() => setDrawer(null)} />
          <motion.div
            initial={{ x: -24, opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            /* Narrower than it was, and the menu words are one simple word each
               now (owner, 9 and 10 Nov 2026) — nothing wraps at this width, and
               a wider panel would just be taking a phone for no reason. */
            className="absolute bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-3 top-[calc(0.75rem+env(safe-area-inset-top))] w-[12.75rem] max-w-[62vw]"
          >
            <GlassSidebar mode="sheet" {...shared} onNavigate={() => setDrawer(null)} />
          </motion.div>
        </div>
      )}

      <div
        className="transition-[padding] duration-200"
        style={{ '--sidebar-room': collapsed ? ROOM.rail : ROOM.open }}
      >
        <div className="lg:pl-[var(--sidebar-room)]">
          {/* On a phone the menu and the bell have to stay reachable, so they
              sit in a small bar of their own above everything. */}
          {/* calc, not max: on a phone with a camera hole the inset IS the
              clock's height, so max() parks the bar against the clock. Adding
              to it leaves the same 12px of air there as everywhere else.
              The gradient is the app's own ground painted solid behind the bar
              and faded out under it, so a page scrolls AWAY rather than
              sliding visibly past a floating pill. */}
          <div
            className="pointer-events-none sticky top-0 z-30 px-3 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:hidden"
            style={{ background: 'linear-gradient(to bottom, #0a0a0b 62%, rgba(10,10,11,0))' }}
          >
            <div className="glass pointer-events-auto flex h-12 items-center gap-1 rounded-2xl border px-2">
              <button className="cursor-pointer rounded-xl p-2 text-muted hover:bg-white/[0.06] hover:text-white" onClick={() => setDrawer('menu')} aria-label="Menu">
                <Menu className="h-5 w-5" />
              </button>
              <span className="flex-1 truncate text-sm font-semibold text-white/80">
                {tzDateLabel({ weekday: 'short', day: 'numeric', month: 'short' })}
              </span>
              <button onClick={() => setBellOpen((v) => !v)} className="relative cursor-pointer rounded-xl p-2 text-muted hover:bg-white/[0.06] hover:text-white" aria-label="Notifications">
                <Bell className="h-5 w-5" />
                {unread > 0 && (
                  <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Each side named on its own. `p-3 sm:p-4` sets padding-bottom
              twice over, and a responsive variant beats an unprefixed pb-*,
              so a single pb-[...] for the tab bar silently vanished on every
              screen past 640px — which is most phones held sideways and every
              tablet. The room under the page is a spacer now, below. */}
          <main className="overflow-x-clip px-3 pb-3 pt-1 sm:px-4 sm:pb-4 lg:px-6 lg:pb-8 lg:pt-6">
            {/* 1400px was a cap for a laptop. On the owner's own screen it
                left a hand's width of empty page between the rail and the
                banner, and the same again on the right — the panel looked
                marooned. Target Express caps at 1920, which fills a wide
                screen and still stops text running away on an ultra-wide. */}
            <div className="mx-auto w-full max-w-[1920px]">
              <div className="relative">
                {atHome && <Banner user={user} unread={unread} onBell={() => setBellOpen((v) => !v)} />}
                {bellOpen && (
                  <BellPanel
                    position="max-lg:fixed max-lg:inset-x-3 max-lg:top-[calc(4.25rem+env(safe-area-inset-top))] max-lg:w-auto lg:right-3 lg:top-16"
                    unread={unread} notes={recentNotes} onClose={() => setBellOpen(false)}
                    onReadAll={() => markAllRead.mutate()} onReadOne={(id) => markOneRead.mutate(id)}
                    onViewAll={() => { setBellOpen(false); navigate('/notifications'); }} />
                )}
              </div>
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
          {/* The room the tab bar stands in. Without it the bar is a lid: the
              last row of every list — the oldest order, the last box — sits
              under it, and on a list that ends exactly at the fold there is
              nothing left to scroll to uncover it. */}
          <div aria-hidden className="h-[calc(3.5rem+env(safe-area-inset-bottom))] lg:hidden" />
        </div>
      </div>

      {/* The phone's tab bar */}
      {/* The left/right insets too: body padding cannot move a fixed element,
          so sideways on a notched phone the first tab would sit under it. */}
      <nav className="glass fixed inset-x-0 bottom-0 z-40 flex border-t pb-[max(0.25rem,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:hidden">
        {TABS.map((tab) => {
          const active = tab.to === '/' ? location.pathname === '/' : location.pathname.startsWith(tab.to);
          return (
            <NavLink key={tab.to} to={tab.to}
              className={clsx('relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition',
                active ? 'text-brand-600' : 'text-faint')}>
              {active && <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-brand-400" />}
              <span className="relative">
                <tab.icon className="h-[19px] w-[19px]" />
                {tab.badge > 0 && <span className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-rose-500" />}
              </span>
              {tab.label}
            </NavLink>
          );
        })}
        {/* Opens the menu, and nothing else. It used to open ON the search box
            with the field already focused, so a phone threw the keyboard up
            over half the menu before anyone had asked to type (owner, 9 Nov
            2026: "when I open it, it pushes me to search — when I want to
            search I will click search"). */}
        <button type="button" onClick={() => setDrawer('menu')}
          className="flex flex-1 cursor-pointer flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-faint transition">
          <Menu className="h-[19px] w-[19px]" /> Menu
        </button>
      </nav>

      {showPasswordModal && <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />}

      {/* Offered once, a moment after a phone's browser reaches the app: a tab
          keeps its address bar, and only an installed app is full screen. */}
      <InstallPrompt />
    </div>
  );
}
