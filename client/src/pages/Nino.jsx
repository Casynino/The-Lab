import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown, ArrowLeft, ArrowUpRight, Bot, CreditCard, Database, FolderGit2, Globe,
  LayoutDashboard, Lock, Mail, MapPin, MessageCircle, PenTool, Plug, Smartphone, TrendingUp, Workflow,
} from 'lucide-react';
import { CONTACT, EXPERTISE, LIVE, MORE, STACK } from './nino.work';
import './nino.css';

/**
 * DEVELOPED BY NINO.
 *
 * Nino, 2026-10-05, for the Vegas Luxury Hotel site: "a small button down the
 * website… click it and find a full page with all my projects"; 9 Nov 2026,
 * for this one: the same, from the sign-in page. Ported from
 * Vegas/src/app/nino/page.tsx — dark, editorial, the work first: every live
 * project with a screenshot of its real home page, then what's coming and the
 * code, what he does, what he builds with, and how to reach him.
 *
 * Public on purpose. It hangs off the sign-in screen, so a visitor who has not
 * signed in — which is everyone who would ever read it — has to be able to
 * open it. It shows nothing of the business: no stock, no money, no names.
 */

const ICONS = {
  Smartphone, Globe, PenTool, LayoutDashboard, Plug, CreditCard, MapPin, Bot, Database, Workflow, TrendingUp,
};

const HELLO = encodeURIComponent('Hi Nino, I found your work through the ZELab system. I have a project in mind —');
const wa = (digits) => `https://wa.me/${digits}?text=${HELLO}`;

const wrap = 'relative z-10 mx-auto w-full max-w-[1320px] px-4 sm:px-8';
const eyebrow = 'font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--n-faint)]';
const focus = 'outline-none focus-visible:ring-2 focus-visible:ring-[var(--n-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0b]';
const ext = { target: '_blank', rel: 'noopener noreferrer' };

export default function Nino() {
  // This page is its own world, not the app's: its own title and its own
  // colour behind the phone's bars while it is open.
  useEffect(() => {
    const title = document.title;
    const meta = document.querySelector('meta[name="theme-color"]');
    const was = meta?.getAttribute('content');
    document.title = 'Nino — Systems scientist & developer';
    meta?.setAttribute('content', '#0a0a0b');
    return () => {
      document.title = title;
      if (was) meta?.setAttribute('content', was);
    };
  }, []);

  return (
    <div className="nino font-sans antialiased">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-30 border-b border-[var(--n-rule)] bg-[#0a0a0b]/75 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className={`${wrap} flex h-14 items-center justify-between gap-4`}>
          <a href="#top" className={`text-lg font-black tracking-[-0.06em] ${focus}`}>
            NINO<span className="text-[var(--n-accent)]">.</span>
          </a>
          <nav aria-label="Page" className="flex items-center gap-1 sm:gap-2">
            <Link to="/login" className={`hidden h-9 items-center gap-1.5 rounded-full px-3 text-[13px] text-[var(--n-muted)] transition-colors hover:text-[var(--n-ink)] sm:inline-flex ${focus}`}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />ZELab
            </Link>
            <a href="#work" className={`hidden h-9 items-center rounded-full px-3 text-[13px] text-[var(--n-muted)] transition-colors hover:text-[var(--n-ink)] md:inline-flex ${focus}`}>Work</a>
            <a href="#contact" className={`inline-flex h-9 items-center rounded-full bg-[var(--n-accent)] px-4 text-[13px] font-semibold text-[var(--n-accent-ink)] transition hover:brightness-110 ${focus}`}>Work with me</a>
          </nav>
        </div>
      </header>

      <main id="top">
        {/* ── Hero: the name, one line on what he does, and the way in. ── */}
        <section className={`${wrap} pb-10 pt-10 sm:pb-14 sm:pt-16`}>
          <div className="grid items-end gap-8 lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-16">
            <div>
              <p className={`${eyebrow} nino-rise`}>Systems scientist &amp; developer</p>
              <h1 className="nino-wordmark nino-rise nino-rise2 mt-4 select-none" aria-label="Nino">
                NINO<span className="text-[var(--n-accent)]">.</span>
              </h1>
            </div>
            <div className="nino-rise nino-rise3 lg:pb-3">
              <p className="max-w-xl text-pretty text-lg leading-snug text-[var(--n-ink)] sm:text-xl">
                Before I design a screen, I map how the business really works — who does what, where the money goes.
                <span className="text-[var(--n-muted)]"> Then I design the system and build it around that.</span>
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-2.5">
                <a href="#work" className={`inline-flex h-11 items-center gap-2 rounded-full bg-[var(--n-ink)] px-5 text-sm font-semibold text-[#0a0a0b] transition hover:bg-white ${focus}`}>
                  See the work<ArrowDown className="h-4 w-4" aria-hidden="true" />
                </a>
                <a href={wa(CONTACT.whatsapp[0].digits)} {...ext} className={`inline-flex h-11 items-center gap-2 rounded-full border border-[var(--n-rule)] px-5 text-sm font-semibold transition-colors hover:border-[var(--n-muted)] ${focus}`}>
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />WhatsApp me<span className="sr-only"> (opens WhatsApp)</span>
                </a>
                <span className="inline-flex items-center gap-2 px-1 text-[13px] text-[var(--n-muted)]">
                  <span className="nino-pulse h-2 w-2 rounded-full bg-[var(--n-accent)]" aria-hidden="true" />Available for select projects
                </span>
              </div>
            </div>
          </div>

          {/* The facts, as given — nothing rounded up. */}
          <dl className="nino-rise nino-rise3 mt-10 flex flex-wrap gap-x-8 gap-y-3 border-y border-[var(--n-rule)] py-4 sm:gap-x-12">
            {[{ big: '14+', small: 'platforms delivered' }, { big: String(LIVE.length), small: 'sites live right now' }].map((f) => (
              <div key={f.small} className="flex items-baseline gap-2.5">
                <dd className="text-xl font-black tracking-[-0.03em] sm:text-2xl">{f.big}</dd>
                <dt className="order-2 text-[13px] text-[var(--n-muted)]">{f.small}</dt>
              </div>
            ))}
          </dl>
        </section>

        {/* ── Live work ── */}
        <section id="work" aria-labelledby="work-title" className={`${wrap} scroll-mt-20 py-10 sm:py-16`}>
          <SectionHead id="work-title" index="01" title="Live work" note={`${LIVE.length} sites in production — tap one to visit it.`} />
          <ul className="mt-10 grid gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
            {LIVE.map((p, i) => <ProjectCard key={p.name} p={p} featured={i === 0} />)}
          </ul>
        </section>

        {/* ── Coming next & on GitHub ── */}
        <section aria-labelledby="more-title" className={`${wrap} py-10 sm:py-16`}>
          <SectionHead id="more-title" index="02" title="More work" note="Launching soon, code you can read, and private projects." />
          <ul className="mt-10 grid gap-4 sm:gap-5 md:grid-cols-2">
            {MORE.map((p) => <MoreCard key={p.name} p={p} />)}
          </ul>
        </section>

        {/* ── What he does & what he builds with ── */}
        <section aria-labelledby="do-title" className={`${wrap} py-10 sm:py-16`}>
          <SectionHead id="do-title" index="03" title="What I do" note="One person from the business question to the shipped product." />
          <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
            <ul className="grid grid-cols-2 gap-2">
              {EXPERTISE.map((e, i) => {
                const Icon = ICONS[e.icon];
                const last = i === EXPERTISE.length - 1 && EXPERTISE.length % 2 === 1;
                return (
                  <li key={e.label} className={`flex items-center gap-2.5 rounded-2xl border border-[var(--n-rule)] bg-[var(--n-card)] px-3 py-3 text-[13.5px] leading-tight sm:gap-3 sm:px-4 sm:py-3.5 sm:text-[15px] ${last ? 'col-span-2' : ''}`}>
                    <Icon className="h-[18px] w-[18px] shrink-0 text-[var(--n-accent)]" strokeWidth={1.6} aria-hidden="true" />{e.label}
                  </li>
                );
              })}
            </ul>
            <div>
              <p className={eyebrow}>Built with</p>
              <table className="mt-4 w-full border-collapse text-left">
                <caption className="sr-only">Technologies by area</caption>
                <tbody>
                  {STACK.map((r) => (
                    <tr key={r.area} className="border-t border-[var(--n-rule)] last:border-b">
                      <th scope="row" className="w-[38%] py-4 pr-4 align-top text-sm font-normal text-[var(--n-faint)]">{r.area}</th>
                      <td className="py-4 text-[15px] leading-relaxed">{r.tools.join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-6 text-sm leading-relaxed text-[var(--n-faint)]">
                Mobile money, maps, messaging and AI wired into real operations — not demos.
              </p>
            </div>
          </div>
        </section>

        {/* ── Work with me ── */}
        <section id="contact" aria-labelledby="contact-title" className={`${wrap} scroll-mt-20 pb-16 pt-10 sm:pb-24 sm:pt-16`}>
          <div className="relative overflow-hidden rounded-[2rem] border border-[var(--n-rule)] bg-[linear-gradient(140deg,rgb(198_244_50/0.10),rgb(255_255_255/0.02)_45%)] p-6 sm:p-12">
            <p className={eyebrow}>04 — Work with me</p>
            <h2 id="contact-title" className="mt-4 max-w-3xl text-balance text-4xl font-black leading-[0.95] tracking-[-0.045em] sm:text-6xl">
              Have something to build? Let&apos;s talk<span className="text-[var(--n-accent)]">.</span>
            </h2>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-[var(--n-muted)]">
              Tell me what the business needs. I&apos;ll come back with how I&apos;d build it, how long it takes and what it costs.
              Available for select projects.
            </p>
            <ul className="mt-9 grid gap-3 md:grid-cols-3">
              <li>
                <a href={`mailto:${CONTACT.email}?subject=${encodeURIComponent('A project for Nino')}`} className={`nino-card group flex h-full items-center gap-4 rounded-2xl border border-[var(--n-rule)] bg-[#0a0a0b]/60 p-4 sm:p-5 ${focus}`}>
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--n-ink)] text-[#0a0a0b]"><Mail className="h-[18px] w-[18px]" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-[var(--n-faint)]">Email</span>
                    <span className="block truncate text-[15px] font-semibold">{CONTACT.email}</span>
                  </span>
                  <ArrowUpRight className="nino-arrow h-4 w-4 shrink-0 text-[var(--n-faint)]" aria-hidden="true" />
                </a>
              </li>
              {CONTACT.whatsapp.map((w) => (
                <li key={w.place}>
                  <a href={wa(w.digits)} {...ext} className={`nino-card group flex h-full items-center gap-4 rounded-2xl border border-[var(--n-rule)] bg-[#0a0a0b]/60 p-4 sm:p-5 ${focus}`}>
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#25D366] text-[#06351b]"><MessageCircle className="h-[18px] w-[18px]" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-[var(--n-faint)]">WhatsApp · {w.place}</span>
                      <span className="block truncate text-[15px] font-semibold tabular-nums">{w.shown}</span>
                    </span>
                    <ArrowUpRight className="nino-arrow h-4 w-4 shrink-0 text-[var(--n-faint)]" aria-hidden="true" />
                    <span className="sr-only"> (opens WhatsApp)</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-[var(--n-rule)]">
        <div className={`${wrap} flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-[13px] text-[var(--n-faint)]`}>
          <p>
            <span className="font-black tracking-[-0.06em] text-[var(--n-ink)]">NINO<span className="text-[var(--n-accent)]">.</span></span>
            {' · © '}{new Date().getFullYear()}{' · Designed & built by Nino'}
          </p>
          <Link to="/login" className={`inline-flex min-h-11 items-center gap-1.5 transition-colors hover:text-[var(--n-ink)] ${focus}`}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Back to ZELab
          </Link>
        </div>
      </footer>
    </div>
  );
}

function SectionHead({ id, index, title, note }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-[var(--n-rule)] pb-5">
      <h2 id={id} className="flex items-baseline gap-4 text-3xl font-black tracking-[-0.045em] sm:text-5xl">
        <span className="font-mono text-xs font-normal tracking-[0.2em] text-[var(--n-faint)]">{index}</span>{title}
      </h2>
      <p className="text-sm text-[var(--n-muted)]">{note}</p>
    </div>
  );
}

/** A browser window around the live site's home page. */
function Shot({ p, eager }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--n-rule)] bg-[#141416]">
      <div className="flex h-7 items-center gap-1.5 border-b border-[var(--n-rule)] px-3">
        <span className="h-2 w-2 rounded-full bg-white/15" />
        <span className="h-2 w-2 rounded-full bg-white/15" />
        <span className="h-2 w-2 rounded-full bg-white/15" />
        <span className="ml-2 min-w-0 flex-1 truncate rounded-md bg-white/[0.05] px-2 py-0.5 text-center font-mono text-[10px] text-[var(--n-faint)]">{p.domain}</span>
      </div>
      <div className="nino-shot relative aspect-[16/10] overflow-hidden">
        <img src={p.shot} alt={`${p.name} — the live home page`} loading={eager ? 'eager' : 'lazy'}
          className="absolute inset-0 h-full w-full object-cover object-top" />
      </div>
    </div>
  );
}

function ProjectCard({ p, featured }) {
  return (
    <li className={featured ? 'md:col-span-2' : undefined}>
      <a href={p.url} {...ext} className={`nino-card group flex h-full flex-col gap-5 rounded-3xl border border-[var(--n-rule)] bg-[var(--n-card)] p-3 sm:p-4 ${featured ? 'xl:flex-row xl:items-stretch' : ''} ${focus}`}>
        <div className={featured ? 'xl:w-[62%] xl:shrink-0' : undefined}>
          <Shot p={p} eager={featured} />
        </div>
        <div className={`flex flex-1 flex-col px-1.5 pb-1.5 ${featured ? 'xl:justify-between xl:py-2 xl:pr-3' : ''}`}>
          <div>
            {featured && (
              <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-[var(--n-accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--n-accent-ink)]">
                <MapPin className="h-3 w-3" aria-hidden="true" />You are here
              </p>
            )}
            <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--n-faint)]">{p.kind}</p>
            <h3 className={`mt-2 flex items-start justify-between gap-3 font-bold tracking-[-0.03em] ${featured ? 'text-3xl sm:text-4xl' : 'text-xl'}`}>
              {p.name}
              <ArrowUpRight className="nino-arrow mt-1 h-5 w-5 shrink-0 text-[var(--n-faint)] group-hover:text-[var(--n-accent)]" aria-hidden="true" />
            </h3>
            <p className={`mt-2.5 text-pretty leading-relaxed text-[var(--n-muted)] ${featured ? 'text-base sm:text-[17px]' : 'text-[14.5px]'}`}>{p.line}</p>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {p.tags.map((t) => <span key={t} className="rounded-full border border-[var(--n-rule)] px-2.5 py-1 text-[11.5px] text-[var(--n-muted)]">{t}</span>)}
          </div>
        </div>
        <span className="sr-only"> — visit {p.domain} (opens in a new tab)</span>
      </a>
    </li>
  );
}

function MoreCard({ p }) {
  const soon = p.status === 'soon';
  const priv = !p.url;
  const inner = (
    <>
      {p.shot ? (
        <div className="sm:w-[44%] sm:shrink-0"><Shot p={p} /></div>
      ) : (
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[var(--n-rule)] bg-white/[0.04]">
          {priv ? <Lock className="h-5 w-5 text-[var(--n-accent)]" strokeWidth={1.6} aria-hidden="true" /> : <FolderGit2 className="h-5 w-5 text-[var(--n-accent)]" strokeWidth={1.6} aria-hidden="true" />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--n-faint)]">
          {soon && <span className="rounded-full bg-[var(--n-accent)] px-2 py-0.5 font-sans text-[10.5px] font-semibold normal-case tracking-normal text-[var(--n-accent-ink)]">Launching soon</span>}
          {p.kind}
        </p>
        <h3 className="mt-2 flex items-start justify-between gap-3 text-xl font-bold tracking-[-0.03em]">
          {p.name}
          {!priv && <ArrowUpRight className="nino-arrow mt-1 h-5 w-5 shrink-0 text-[var(--n-faint)] group-hover:text-[var(--n-accent)]" aria-hidden="true" />}
        </h3>
        <p className="mt-2 text-pretty text-[14.5px] leading-relaxed text-[var(--n-muted)]">{p.line}</p>
        {priv && p.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {p.tags.map((t) => <span key={t} className="rounded-full border border-[var(--n-rule)] px-2.5 py-1 text-[11.5px] text-[var(--n-muted)]">{t}</span>)}
          </div>
        )}
        <p className="mt-3 truncate font-mono text-[11px] text-[var(--n-faint)]">{priv ? 'Private project' : soon ? `Preview · ${p.domain}` : p.domain}</p>
      </div>
    </>
  );
  const box = `group flex h-full gap-4 rounded-3xl border border-[var(--n-rule)] bg-[var(--n-card)] p-5 sm:items-center sm:gap-5 sm:p-6 ${p.shot ? 'flex-col sm:flex-row' : 'flex-row items-start'}`;
  return (
    <li>
      {priv ? (
        <div className={box}>{inner}</div>
      ) : (
        <a href={p.url} {...ext} className={`nino-card ${box} ${focus}`}>
          {inner}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
    </li>
  );
}
