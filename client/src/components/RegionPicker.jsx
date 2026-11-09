import { X } from 'lucide-react';
import { Select } from '@/components/ui';
import { TZ_REGIONS } from '@/lib/regions';

/**
 * Pick one region, or two, or a few, for a rep (owner, 10 Nov 2026: "even two").
 *
 * What is chosen stands as chips; below them a list of the regions still left.
 * The first chip is the MAIN region — what the regional report and a sale's
 * region follow — and tapping another chip makes it the main one. Regions come
 * only from the list of Tanzania's 31, never typed: one typed differently would
 * split a market into two rows of the report.
 */
export default function RegionPicker({ value = [], onChange, max = 5, id }) {
  const left = TZ_REGIONS.filter((r) => !value.includes(r));

  return (
    <div>
      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {value.map((r, i) => (
            <li key={r} className="inline-flex items-center gap-1 rounded-full border border-border bg-elevated py-1 pl-2.5 pr-1 text-[12.5px] text-foreground">
              {i === 0 || value.length < 2 ? (
                <span>{r}</span>
              ) : (
                <button type="button" className="cursor-pointer" title="Make this the main region"
                  onClick={() => onChange([r, ...value.filter((x) => x !== r)])}>{r}</button>
              )}
              {i === 0 && value.length > 1 && <span className="text-[10px] uppercase tracking-wide text-faint">main</span>}
              <button type="button" aria-label={`Remove ${r}`} onClick={() => onChange(value.filter((x) => x !== r))}
                className="grid h-5 w-5 cursor-pointer place-items-center rounded-full text-faint transition hover:bg-white/10 hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.length < max ? (
        <Select id={id} value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
          <option value="">{value.length ? 'Add another region…' : '— Select region —'}</option>
          {left.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
      ) : (
        <p className="text-xs text-faint">That is the most a rep can have ({max}).</p>
      )}
    </div>
  );
}
