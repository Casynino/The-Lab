import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import QRCode from 'qrcode';
import {
  Save, Download, Plus, Trash2, ExternalLink, RefreshCw, ArrowLeft,
  ChevronUp, ChevronDown, Package,
} from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import {
  PageHeader, Card, CardHeader, CardBody, PageSpinner, EmptyState,
  Input, Textarea, Button, Field, Badge, Modal,
} from '@/components/ui';

// ONE BOX, ONE CODE, ONE PAGE.
//
// This screen used to be a single column: the brand, then every box, then
// every code one under the other — which read as one long form rather than as
// a set of products. It is now a list of boxes you open, and inside a box is
// everything that belongs to that box and nothing that belongs to another:
// its words, its details, its pictures, its code, and a phone showing its own
// page (owner, 23 Oct 2026).
//
// A code unique to each individual carton would mean variable-data printing on
// a box worth a few thousand shillings, and it would still prove nothing — a
// counterfeiter copies one valid code onto all his fakes. What a per-BOX code
// does honestly is make a scan describe the box it was printed on.

const MM = 25.4; // millimetres per inch
const QUIET = 4; // quiet-zone modules each side — mandatory, not decoration

// Below roughly this, a scratched phone camera in a dim shop starts failing.
const MIN_MODULE_MM = 0.4;

// The page's own paper colour, so a picture of a box sits on the same tone
// here as it does on the page a customer sees.
const PAPER = '#f6f1e7';

function blobDownload(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// QR alphanumeric mode covers 0-9 A-Z and a few symbols; one lowercase letter
// forces byte mode and costs about 40% more capacity. Scheme and host are
// case-insensitive, so the uppercase form opens the very same page in the
// cheaper mode — which is free millimetres on the box.
function upperUrl(u) {
  return String(u || '').trim().toUpperCase();
}

// The code for ONE box. Each size carries its own: the 70 x 36 carton points
// at /p, the 77 x 44 at /p2, and a carton must only ever describe the box it
// is printed on.
function QRPanel({ defaultUrl, pagePath = 'p' }) {
  const [url, setUrl] = useState(defaultUrl || '');
  const [codeMm, setCodeMm] = useState(12);
  const [svg, setSvg] = useState('');
  const [modules, setModules] = useState(0);
  const [error, setError] = useState('');
  const canvasRef = useRef(null);

  const payload = upperUrl(url);
  const [lowerModules, setLowerModules] = useState(0);

  // Encode the lowercase form too, purely so the panel can state the cost of
  // getting it wrong in real modules rather than in a claim.
  useEffect(() => {
    const lower = String(url || '').trim();
    if (!lower) { setLowerModules(0); return undefined; }
    let alive = true;
    QRCode.toString(lower, { type: 'svg', errorCorrectionLevel: 'M', margin: QUIET })
      .then((out) => {
        if (!alive) return;
        setLowerModules(Number((out.match(/viewBox="0 0 (\d+)/) || [])[1] || 0) - QUIET * 2);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [url]);

  useEffect(() => {
    let alive = true;
    if (!payload) { setSvg(''); setModules(0); return undefined; }
    QRCode.toString(payload, { type: 'svg', errorCorrectionLevel: 'M', margin: QUIET })
      .then((out) => {
        if (!alive) return;
        const box = Number((out.match(/viewBox="0 0 (\d+)/) || [])[1] || 0);
        setModules(box - QUIET * 2);
        setSvg(out);
        setError('');
      })
      .catch((e) => { if (alive) { setError(String(e.message || e)); setSvg(''); } });
    return () => { alive = false; };
  }, [payload]);

  // Only claim a saving when there is one to claim.
  const saves = Boolean(lowerModules && modules && lowerModules > modules);
  const moduleMm = modules ? codeMm / modules : 0;
  const footprintMm = modules ? (codeMm * (modules + QUIET * 2)) / modules : 0;
  const tight = moduleMm > 0 && moduleMm < MIN_MODULE_MM;

  // The exported file is the symbol PLUS its quiet zone, sized in real
  // millimetres, so the printer places one rectangle and the clear margin is
  // already inside it. Vector, because a PNG of a QR code on litho board
  // rounds the module edges and that is where scans start failing.
  function printSvg() {
    return svg.replace('<svg ', `<svg width="${footprintMm.toFixed(3)}mm" height="${footprintMm.toFixed(3)}mm" `);
  }

  // The file names itself after the page it opens, so two codes never get
  // mixed up on the way to the printer.
  const slug = (String(url).match(/\/([a-z0-9]+)\/?$/i) || [, 'p'])[1].toLowerCase();

  function downloadSvg() {
    blobDownload(`pepa-qr-${slug}-${codeMm}mm.svg`, new Blob([printSvg()], { type: 'image/svg+xml' }));
  }

  // 600 dpi, for a printer who insists on raster. The SVG is the better file
  // and the one to send if they will take it.
  async function downloadPng() {
    const px = Math.round((footprintMm / MM) * 600);
    const canvas = canvasRef.current;
    await QRCode.toCanvas(canvas, payload, {
      errorCorrectionLevel: 'M', margin: QUIET, width: px,
      color: { dark: '#000000', light: '#ffffff' },
    });
    canvas.toBlob((b) => blobDownload(`pepa-qr-${slug}-${codeMm}mm-600dpi.png`, b), 'image/png');
  }

  return (
    <Card>
      <CardHeader
        title="The code printed on this box"
        subtitle={`Scanning it opens /${pagePath} — this box and no other`}
      />
      <CardBody className="space-y-5">
        <Field
          label="Address the code opens"
          hint="Once a carton run is printed, this can never change."
        >
          <Input value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
        </Field>

        <div className="rounded-lg border border-border bg-elevated px-4 py-3">
          <div className="text-xs uppercase tracking-wider text-faint">Encoded in the code as</div>
          <div className="mt-1 break-all font-mono text-sm font-semibold">{payload || '—'}</div>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {saves ? (
              <>
                Capitals on purpose. A QR code has a cheaper mode for capitals and digits, and one
                lowercase letter switches the whole code out of it. On this address that is the
                difference between {lowerModules} and {modules} modules —{' '}
                {(codeMm / lowerModules).toFixed(2)} mm against {moduleMm.toFixed(2)} mm per module
                at this size. Addresses are not case-sensitive, so it opens exactly the same page.
              </>
            ) : (
              <>
                Capitals on purpose: a QR code has a cheaper mode for capitals and digits.
                This address happens to be the same size either way, but a shorter one would not
                be. Addresses are not case-sensitive, so it opens exactly the same page.
              </>
            )}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Printed size of the code" hint="The dark square, without its clear margin">
            <div className="flex items-center gap-2">
              <Input
                type="number" min="6" max="40" step="0.5" value={codeMm}
                onChange={(e) => setCodeMm(Math.max(6, Math.min(40, Number(e.target.value) || 12)))}
              />
              <span className="text-sm text-muted">mm</span>
            </div>
          </Field>
          <Field label="Space it needs on the box" hint="Including the clear margin all round">
            <div className="flex h-[42px] items-center text-lg font-semibold tabular-nums">
              {footprintMm ? `${footprintMm.toFixed(1)} × ${footprintMm.toFixed(1)} mm` : '—'}
            </div>
          </Field>
        </div>

        <div className="flex items-start gap-5 rounded-lg border border-border bg-elevated p-4">
          <div className="shrink-0 rounded bg-white p-2">
            {svg
              ? <div className="h-[124px] w-[124px] [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
              : <div className="h-[124px] w-[124px]" />}
          </div>
          <div className="min-w-0 space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-elevated text-muted">{modules ? `${modules} × ${modules} modules` : '—'}</Badge>
              <Badge className={tight ? 'bg-amber-500/15 text-amber-500' : 'bg-lime-500/15 text-lime-500'}>
                {moduleMm ? `${moduleMm.toFixed(2)} mm per module` : '—'}
              </Badge>
            </div>
            {tight ? (
              <p className="text-amber-500">
                Under {MIN_MODULE_MM} mm per module. A scratched phone camera in a dim shop will
                start failing on this. Print it bigger, or shorten the address.
              </p>
            ) : (
              <p className="text-muted">
                Comfortable for a phone camera on carton board.
              </p>
            )}
            <p className="text-faint">
              The clear margin is part of the file. It cannot sit on a 10–12 mm side
              panel — the margin alone would run off the edge. Put it on a main face.
            </p>
          </div>
        </div>

        {error ? <p className="text-sm text-red-500">{error}</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button onClick={downloadSvg} disabled={!svg}>
            <Download className="mr-2 h-4 w-4" /> SVG for the printer
          </Button>
          <Button variant="secondary" onClick={downloadPng} disabled={!svg}>
            <Download className="mr-2 h-4 w-4" /> PNG at 600 dpi
          </Button>
          <a href={`/${pagePath}`} target="_blank" rel="noreferrer">
            <Button variant="secondary" type="button">
              <ExternalLink className="mr-2 h-4 w-4" /> Open this box&apos;s page
            </Button>
          </a>
        </div>

        <p className="text-xs leading-relaxed text-faint">
          Print the address in readable type beside the code. That is the part that
          actually protects you: anyone can copy your QR, but a fake pointing somewhere
          else has a different address on the box, and the address bar on the phone is
          the check. A copied code sends the customer to your own page.
        </p>
        <canvas ref={canvasRef} className="hidden" />
      </CardBody>
    </Card>
  );
}

function FactRows({ facts, onChange }) {
  return (
    <div className="space-y-2">
      {facts.map((f, i) => (
        <div key={i} className="flex gap-2">
          <Input
            className="w-2/5" placeholder="Papers per booklet" value={f.label}
            onChange={(e) => onChange(facts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
          />
          <Input
            placeholder="50" value={f.value}
            onChange={(e) => onChange(facts.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
          />
          <button
            type="button" title="Remove"
            className="shrink-0 rounded-md border border-border px-2 text-muted hover:text-red-500"
            onClick={() => onChange(facts.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-sm text-brand-400 hover:underline"
        onClick={() => onChange([...facts, { label: '', value: '' }])}
      >
        + Add a detail
      </button>
    </div>
  );
}

// A picture of a box, on the box's own paper colour. Pictures are rendered
// from the die-lines and ship with the release, so what is arranged on this
// screen is WHICH of them a box shows and in what order — never an address,
// which is what keeps a Save from pointing the page at a missing file.
function Thumb({ pic, className = '' }) {
  if (!pic) {
    return (
      <div
        className={`flex items-center justify-center text-center text-[11px] leading-tight ${className}`}
        style={{ background: PAPER, color: '#9a9080' }}
      >
        not in this release
      </div>
    );
  }
  return (
    <img
      src={pic.src} alt={pic.alt || ''} loading="lazy"
      className={`object-contain ${className}`} style={{ background: PAPER }}
    />
  );
}

// ── The pictures on one box's page ──────────────────────────────────────────
function Pictures({ chosen, custom, byName, nameOfKey, productKey, onChange, onReset }) {
  const available = useMemo(
    () => Object.values(byName).filter((pic) => !chosen.includes(pic.name)),
    [byName, chosen],
  );
  const move = (i, to) => {
    if (to < 0 || to >= chosen.length) return;
    const next = [...chosen];
    [next[i], next[to]] = [next[to], next[i]];
    onChange(next);
  };
  // Say out loud when a picture was drawn for a different box: putting one
  // there should be a choice, not an accident.
  const whose = (pic) => {
    if (!pic.renderedFor || pic.renderedFor === productKey) return '';
    return nameOfKey[pic.renderedFor] || 'another box';
  };

  return (
    <Card>
      <CardHeader
        title="The pictures"
        subtitle="Shown on this box's page in this order. The first is also what WhatsApp shows when the link is shared."
        action={custom ? (
          <Button variant="secondary" onClick={onReset}>
            <RefreshCw className="mr-2 h-4 w-4" /> Standard set
          </Button>
        ) : null}
      />
      <CardBody className="space-y-4">
        {chosen.length === 0 ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-500">
            No pictures. This box&apos;s page will show the words and the details only.
          </p>
        ) : (
          <div className="space-y-2">
            {chosen.map((name, i) => {
              const pic = byName[name];
              const other = pic ? whose(pic) : '';
              return (
                <div key={name} className="flex items-center gap-3 rounded-lg border border-border p-2">
                  <Thumb pic={pic} className="h-16 w-24 shrink-0 rounded" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{pic?.alt || name}</div>
                    <div className="truncate text-xs text-faint">
                      {i === 0 ? 'First — shown in a shared link' : `Picture ${i + 1}`}
                      {other ? ` · drawn for ${other}` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button" title="Move up" disabled={i === 0}
                      className="rounded-md border border-border p-1.5 text-muted enabled:hover:text-foreground disabled:opacity-30"
                      onClick={() => move(i, i - 1)}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button" title="Move down" disabled={i === chosen.length - 1}
                      className="rounded-md border border-border p-1.5 text-muted enabled:hover:text-foreground disabled:opacity-30"
                      onClick={() => move(i, i + 1)}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button" title="Take off this page"
                      className="rounded-md border border-border p-1.5 text-muted hover:text-red-500"
                      onClick={() => onChange(chosen.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {available.length > 0 && (
          <div className="border-t border-border pt-4">
            <div className="label">Add a picture</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {available.map((pic) => {
                const other = whose(pic);
                return (
                  <button
                    key={pic.name} type="button" onClick={() => onChange([...chosen, pic.name])}
                    title={other ? `${pic.alt} — drawn for ${other}` : pic.alt}
                    className="group overflow-hidden rounded-lg border border-border text-left transition hover:border-brand-500/60"
                  >
                    <Thumb pic={pic} className="h-20 w-full" />
                    <div className="truncate border-t border-border px-2 py-1.5 text-[11px] text-muted group-hover:text-foreground">
                      {other ? `Drawn for ${other}` : 'This box'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-xs leading-relaxed text-faint">
          Pictures are rendered from the factory die-lines and ship with the app, so they can be
          arranged and reordered here, but a brand new one has to be rendered and released. That is
          deliberate: nothing done on this screen can send the page looking for a file that is not
          there.
        </p>
      </CardBody>
    </Card>
  );
}

// ── One box in the list ─────────────────────────────────────────────────────
function BoxCard({ product, pic, path, pictureCount, onOpen }) {
  const filled = product.facts.filter((f) => f.label && f.value).length;
  const blanks = product.facts.filter((f) => f.label && !f.value).length;
  return (
    <button
      type="button" onClick={onOpen}
      className="flex w-full flex-col overflow-hidden rounded-lg border border-border bg-surface text-left transition hover:border-brand-500/60 hover:shadow-lg hover:shadow-black/20"
    >
      {/* aspect-ratio sets the height from the width, but it is not a maximum:
          an img at h-full inside a box of indefinite height falls back to its
          own natural height and stretches the box, which left the two cards
          different heights. Taking the picture out of the flow pins it. */}
      <div className="relative aspect-[4/3] w-full" style={{ background: PAPER }}>
        {pic
          ? <Thumb pic={pic} className="absolute inset-0 h-full w-full p-2" />
          : (
            <div className="absolute inset-0 flex items-center justify-center text-xs" style={{ color: '#9a9080' }}>
              No picture on this page
            </div>
          )}
        {path && (
          <span className="absolute left-2 top-2 rounded bg-black/75 px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wide text-white">
            /{path}
          </span>
        )}
      </div>
      <div className="space-y-1 border-t border-border p-4">
        <div className="truncate font-semibold text-foreground">{product.name || 'Untitled box'}</div>
        <div className="truncate text-xs text-muted">{product.note || 'No line under the name yet'}</div>
        <div className="flex flex-wrap gap-1.5 pt-2">
          <Badge className="bg-elevated text-muted">
            {pictureCount === 1 ? '1 picture' : `${pictureCount} pictures`}
          </Badge>
          <Badge className="bg-elevated text-muted">
            {filled === 1 ? '1 detail' : `${filled} details`}
          </Badge>
          {blanks > 0 && (
            <Badge className="bg-amber-500/15 text-amber-500">
              {blanks === 1 ? '1 to fill in' : `${blanks} to fill in`}
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}

export default function ProductLabel() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['product-page'],
    queryFn: () => api.get('/product-page').then(unwrap),
  });
  const saved = data?.data;
  const [form, setForm] = useState(null);
  const [previewKey, setPreviewKey] = useState(() => Date.now());
  // Which box is open, by position. null is the list.
  const [openBox, setOpenBox] = useState(null);
  const [removing, setRemoving] = useState(null);

  useEffect(() => { if (saved?.content && !form) setForm(saved.content); }, [saved, form]);

  const save = useMutation({
    mutationFn: (body) => api.put('/product-page', body),
    onSuccess: (res) => {
      toast.success('Saved — the page is live');
      // Continue from what the server stored, not from what was sent: it gives
      // each product its picture key, and a form that never took those back
      // would drop them again on the next Save.
      if (res?.data?.data) setForm(res.data.data);
      qc.invalidateQueries({ queryKey: ['product-page'] });
      setPreviewKey(Date.now());
    },
    onError: (e) => toast.error(apiError(e)),
  });

  // Pictures as this release published them, by name, plus the set each box
  // falls back to while its own list has never been set.
  const byName = useMemo(() => {
    const out = {};
    for (const pic of saved?.pictures || []) out[pic.name] = pic;
    return out;
  }, [saved]);
  const fallback = saved?.defaultPictures || {};
  const picturesOf = (p) => (Array.isArray(p.images) ? p.images : (fallback[p.key] || []));

  // A fact with no value is not shown on the page. Say so, rather than letting
  // him wonder why the line he typed never appeared.
  const blanks = useMemo(() => {
    if (!form) return 0;
    return form.products.reduce((n, p) => n + p.facts.filter((f) => f.label && !f.value).length, 0);
  }, [form]);

  const dirty = useMemo(
    () => Boolean(form && saved?.content && JSON.stringify(form) !== JSON.stringify(saved.content)),
    [form, saved],
  );

  // The server refuses to hand over defaults when it cannot read the saved
  // label, so that a Save can never overwrite it. Say so, rather than spin.
  if (isError && !form) {
    return (
      <Card>
        <EmptyState
          title="Couldn't load the label"
          message={`${apiError(error)} — nothing has been changed. Try again in a moment.`}
          action={<Button onClick={() => refetch()} loading={isFetching}><RefreshCw className="mr-2 h-4 w-4" /> Try again</Button>}
        />
      </Card>
    );
  }
  if (isLoading || !form) return <PageSpinner />;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setProduct = (i, patch) => setForm((f) => ({
    ...f, products: f.products.map((p, j) => (j === i ? { ...p, ...patch } : p)),
  }));
  const pageOf = (p) => (saved.pages || []).find((x) => (x.keys || []).includes(p.key));
  const nameOfKey = Object.fromEntries(form.products.filter((p) => p.key).map((p) => [p.key, p.name]));

  // Held as markup, not as a component declared inside render: a component
  // defined here would be a new type on every keystroke and remount its button.
  const saveBar = (
    <>
      {dirty && <Badge className="bg-amber-500/15 text-amber-500">Not saved yet</Badge>}
      <Button onClick={() => save.mutate(form)} loading={save.isPending}>
        <Save className="mr-2 h-4 w-4" /> Save
      </Button>
    </>
  );

  function addBox() {
    const next = [...form.products, { name: '', note: '', intro: '', facts: [{ label: 'Size', value: '' }] }];
    set({ products: next });
    setOpenBox(next.length - 1);
  }

  function removeBox(i) {
    set({ products: form.products.filter((_, j) => j !== i) });
    setRemoving(null);
    setOpenBox(null);
  }

  // ── One box, opened ───────────────────────────────────────────────────────
  const p = openBox !== null ? form.products[openBox] : null;
  if (p) {
    const pg = pageOf(p);
    const chosen = picturesOf(p);
    const pBlanks = p.facts.filter((f) => f.label && !f.value).length;
    const path = pg ? pg.path : 'p';
    return (
      <div className="space-y-6">
        <PageHeader
          title={p.name || 'Untitled box'}
          subtitle={pg
            ? `Everything on this box — scanning its code opens /${pg.path}, which shows this box alone`
            : 'A new box. Press Save and it gets its own code.'}
        >
          <Button variant="secondary" onClick={() => setOpenBox(null)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> All boxes
          </Button>
          {saveBar}
        </PageHeader>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">
            <Card>
              <CardHeader title="What the page says" subtitle="The name, the line under it, and the paragraph" />
              <CardBody className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_260px]">
                  <Field label="Name">
                    <Input
                      className="font-medium" placeholder="Pepa Ndogo" value={p.name}
                      onChange={(e) => setProduct(openBox, { name: e.target.value })}
                    />
                  </Field>
                  <Field label="Line under the name" hint="Set in capitals on the page">
                    <Input
                      placeholder="Brown · Slow burn Unfiltered" value={p.note}
                      onChange={(e) => setProduct(openBox, { note: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label="Description">
                  <Textarea
                    rows={3} placeholder="A sentence or two about how it rolls and burns."
                    value={p.intro || ''}
                    onChange={(e) => setProduct(openBox, { intro: e.target.value })}
                  />
                </Field>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="The details" subtitle="Printed as a list under the pictures" />
              <CardBody className="space-y-4">
                <FactRows facts={p.facts} onChange={(facts) => setProduct(openBox, { facts })} />
                {pBlanks > 0 && (
                  <p className="text-sm text-amber-500">
                    {pBlanks === 1 ? 'One detail has no value yet' : `${pBlanks} details have no value yet`} —
                    {' '}empty ones are left off the page rather than shown blank. Fill them in before the box is printed.
                  </p>
                )}
              </CardBody>
            </Card>

            <Pictures
              chosen={chosen}
              custom={Array.isArray(p.images)}
              byName={byName}
              nameOfKey={nameOfKey}
              productKey={p.key}
              onChange={(images) => setProduct(openBox, { images })}
              onReset={() => setProduct(openBox, { images: undefined })}
            />

            {pg ? (
              <QRPanel defaultUrl={pg.url} pagePath={pg.path} />
            ) : (
              <Card>
                <CardHeader title="The code printed on this box" />
                <CardBody>
                  <p className="text-sm text-muted">
                    This box has no code yet. Press Save, and its own code appears here with the
                    files for the printer.
                  </p>
                </CardBody>
              </Card>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
              <div>
                <div className="text-sm font-medium text-foreground">Remove this box</div>
                <div className="text-xs text-muted">
                  It comes off the label. Cartons already printed with its code still open a page.
                </div>
              </div>
              <Button variant="danger" onClick={() => setRemoving(openBox)}>
                <Trash2 className="mr-2 h-4 w-4" /> Remove
              </Button>
            </div>
          </div>

          <div className="xl:sticky xl:top-6 xl:self-start">
            <Card>
              <CardHeader
                title="On a phone"
                subtitle={pg ? `The saved /${pg.path} page, live` : 'Save to see this box on its own page'}
                action={(
                  <button
                    type="button" title="Reload"
                    className="rounded-md border border-border p-2 text-muted hover:text-foreground"
                    onClick={() => setPreviewKey(Date.now())}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                )}
              />
              <CardBody>
                <iframe
                  key={`${path}-${previewKey}`}
                  title="Product page preview"
                  src={`/${path}?preview=${previewKey}`}
                  className="h-[620px] w-full rounded-lg border border-border bg-white"
                />
              </CardBody>
            </Card>
          </div>
        </div>

        <Modal
          open={removing !== null}
          onClose={() => setRemoving(null)}
          title="Remove this box?"
          footer={(
            <>
              <Button variant="secondary" onClick={() => setRemoving(null)}>Keep it</Button>
              <Button variant="danger" onClick={() => removeBox(removing)}>Remove</Button>
            </>
          )}
        >
          <p className="text-sm text-muted">
            <span className="font-medium text-foreground">{form.products[removing]?.name || 'This box'}</span>
            {' '}comes off the label. It is gone from the page once you press Save.
          </p>
        </Modal>
      </div>
    );
  }

  // ── The list ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Product label"
        subtitle="One box, one code, one page — open a box to change its words, its pictures and its code"
      >
        {saveBar}
      </PageHeader>

      <Card>
        <CardHeader
          title="The boxes"
          subtitle={form.products.length === 1 ? 'One box on the label' : `${form.products.length} boxes on the label`}
          action={(
            <Button variant="secondary" onClick={addBox}>
              <Plus className="mr-2 h-4 w-4" /> Add a box
            </Button>
          )}
        />
        <CardBody>
          {form.products.length === 0 ? (
            <EmptyState
              icon={Package}
              title="No boxes yet"
              message="Add a box and it gets its own page, its own code and its own pictures."
              action={<Button onClick={addBox}><Plus className="mr-2 h-4 w-4" /> Add a box</Button>}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {form.products.map((pr, i) => {
                const names = picturesOf(pr);
                return (
                  <BoxCard
                    key={pr.key || `new-${i}`}
                    product={pr}
                    pic={byName[names[0]]}
                    pictureCount={names.length}
                    path={pageOf(pr)?.path}
                    onOpen={() => setOpenBox(i)}
                  />
                );
              })}
              <button
                type="button" onClick={addBox}
                className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-muted transition hover:border-brand-500/60 hover:text-foreground"
              >
                <Plus className="h-6 w-6" />
                <span className="text-sm font-medium">Add a box</span>
              </button>
            </div>
          )}
          {blanks > 0 && (
            <p className="mt-4 text-sm text-amber-500">
              {blanks === 1 ? 'One detail has no value yet' : `${blanks} details have no value yet`} —
              {' '}empty ones are left off the page rather than shown blank.
            </p>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="The brand" subtitle="Shown at the top of every page, above whichever box was scanned" />
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name"><Input value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label="Distributor"><Input value={form.maker} onChange={(e) => set({ maker: e.target.value })} /></Field>
            </div>
            <Field label="Tagline">
              <Input value={form.tagline} onChange={(e) => set({ tagline: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Address"><Input value={form.city} onChange={(e) => set({ city: e.target.value })} /></Field>
              <Field label="Email" hint="Left blank, no email is shown.">
                <Input value={form.email ?? ''} onChange={(e) => set({ email: e.target.value })} />
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Wholesale" subtitle="Tapped straight from the phone that scanned the box" />
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {form.phones.map((ph, i) => (
                <Field key={i} label={`Number ${i + 1}`}>
                  <Input
                    value={ph}
                    onChange={(e) => set({ phones: form.phones.map((x, j) => (j === i ? e.target.value : x)) })}
                  />
                </Field>
              ))}
            </div>
            <Field label="What the WhatsApp message says before they send it">
              <Input value={form.waText} onChange={(e) => set({ waText: e.target.value })} />
            </Field>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
