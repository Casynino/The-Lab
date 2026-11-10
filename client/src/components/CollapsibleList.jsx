import { useState } from 'react';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';

// A list that opens and closes (Nino, 11 Nov 2026: "the list looks bad — we should be able to open it up
// and see them"). The heading is the button, with the count and a small arrow; the rows live in ONE soft
// glass card with a hairline between them. Callers open it by default only when nothing more urgent is on
// the page (no active orders / requests), so a long history never pushes the live items down.
export default function CollapsibleList({ title, count, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-1.5 text-left"
      >
        <h2 className="text-lg font-bold text-foreground">
          {title}
          {count > 0 && <span className="ml-2 text-sm font-medium text-muted">{count}</span>}
        </h2>
        <ChevronDown className={clsx('h-5 w-5 shrink-0 text-muted transition-transform duration-200', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && <div className="glass-list mt-3 divide-y divide-white/[0.07]">{children}</div>}
    </section>
  );
}
