import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import QRCode from 'qrcode';
import { Save, Download, Plus, Trash2, ExternalLink, RefreshCw } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { PageHeader, Card, CardHeader, CardBody, PageSpinner, Input, Textarea, Button, Field, Badge } from '@/components/ui';

// One QR code, the same on every carton, pointing at one page that carries
// every product. Nothing here is per-box: a code unique to each box would mean
// variable-data printing on a carton worth a few thousand shillings, and it
// would still prove nothing, because a counterfeiter copies one valid code onto
// all his fakes. What a shared code CAN do honestly is say who makes the
// product and how to reach them — which is what the page says.

const MM = 25.4; // millimetres per inch
const QUIET = 4; // quiet-zone modules each side — mandatory, not decoration

// Below roughly this, a scratched phone camera in a dim shop starts failing.
const MIN_MODULE_MM = 0.4;

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

function QRPanel({ defaultUrl }) {
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
    const box = modules + QUIET * 2;
    return svg
      .replace('<svg ', `<svg width="${footprintMm.toFixed(3)}mm" height="${footprintMm.toFixed(3)}mm" `)
      .replace(`viewBox="0 0 ${box} ${box}"`, `viewBox="0 0 ${box} ${box}"`);
  }

  function downloadSvg() {
    blobDownload(`pepa-qr-${codeMm}mm.svg`, new Blob([printSvg()], { type: 'image/svg+xml' }));
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
    canvas.toBlob((b) => blobDownload(`pepa-qr-${codeMm}mm-600dpi.png`, b), 'image/png');
  }

  return (
    <Card>
      <CardHeader
        title="The code for the printer"
        subtitle="One code, printed the same on every box"
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
          <a href="/p" target="_blank" rel="noreferrer">
            <Button variant="secondary" type="button">
              <ExternalLink className="mr-2 h-4 w-4" /> Open the page
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

export default function ProductLabel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['product-page'],
    queryFn: () => api.get('/product-page').then(unwrap),
  });
  const saved = data?.data;
  const [form, setForm] = useState(null);
  const [previewKey, setPreviewKey] = useState(() => Date.now());

  useEffect(() => { if (saved?.content && !form) setForm(saved.content); }, [saved, form]);

  const save = useMutation({
    mutationFn: (body) => api.put('/product-page', body),
    onSuccess: () => {
      toast.success('Saved — the page is live');
      qc.invalidateQueries({ queryKey: ['product-page'] });
      setPreviewKey(Date.now());
    },
    onError: (e) => toast.error(apiError(e)),
  });

  // A fact with no value is not shown on the page. Say so, rather than letting
  // him wonder why the line he typed never appeared.
  const blanks = useMemo(() => {
    if (!form) return 0;
    return form.products.reduce((n, p) => n + p.facts.filter((f) => f.label && !f.value).length, 0);
  }, [form]);

  if (isLoading || !form) return <PageSpinner />;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setProduct = (i, patch) => setForm((f) => ({
    ...f, products: f.products.map((p, j) => (j === i ? { ...p, ...patch } : p)),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Product label"
        subtitle="What someone sees when they scan the code on the box"
      >
        <Button onClick={() => save.mutate(form)} loading={save.isPending}>
          <Save className="mr-2 h-4 w-4" /> Save
        </Button>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <QRPanel defaultUrl={saved.url} />

          <Card>
            <CardHeader title="The product" subtitle="These words appear on the page, exactly as typed" />
            <CardBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name"><Input value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
                <Field label="Distributor"><Input value={form.maker} onChange={(e) => set({ maker: e.target.value })} /></Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tagline">
                  <Input value={form.tagline} onChange={(e) => set({ tagline: e.target.value })} />
                </Field>
                <Field label="Address"><Input value={form.city} onChange={(e) => set({ city: e.target.value })} /></Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Email" hint="Left blank, no email is shown.">
                  <Input value={form.email ?? ''} onChange={(e) => set({ email: e.target.value })} />
                </Field>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="The papers"
              subtitle="One code covers all of them — add a size here and it appears on the same page, no reprint"
              action={(
                <Button
                  variant="secondary"
                  onClick={() => set({ products: [...form.products, { name: '', note: '', intro: '', facts: [{ label: 'Size', value: '' }] }] })}
                >
                  <Plus className="mr-2 h-4 w-4" /> Add a paper
                </Button>
              )}
            />
            <CardBody className="space-y-6">
              {form.products.map((p, i) => (
                <div key={i} className="space-y-3 rounded-lg border border-border p-4">
                  <div className="flex gap-2">
                    <Input
                      className="font-medium" placeholder="Pepa Ndogo" value={p.name}
                      onChange={(e) => setProduct(i, { name: e.target.value })}
                    />
                    <Input
                      className="w-44" placeholder="Brown · Unfiltered" value={p.note}
                      onChange={(e) => setProduct(i, { note: e.target.value })}
                    />
                    <button
                      type="button" title="Remove this paper"
                      className="shrink-0 rounded-md border border-border px-2 text-muted hover:text-red-500"
                      onClick={() => set({ products: form.products.filter((_, j) => j !== i) })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <Textarea
                    rows={3} placeholder="A sentence or two about how it rolls and burns."
                    value={p.intro || ''}
                    onChange={(e) => setProduct(i, { intro: e.target.value })}
                  />
                  <FactRows facts={p.facts} onChange={(facts) => setProduct(i, { facts })} />
                </div>
              ))}
              {blanks > 0 && (
                <p className="text-sm text-amber-500">
                  {blanks === 1 ? 'One detail has no value yet' : `${blanks} details have no value yet`} —
                  {' '}empty ones are left off the page rather than shown blank. Fill them in before the box is printed.
                </p>
              )}
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

        <div className="xl:sticky xl:top-6 xl:self-start">
          <Card>
            <CardHeader
              title="On a phone"
              subtitle="The saved page, live"
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
                key={previewKey}
                title="Product page preview"
                src={`/p?preview=${previewKey}`}
                className="h-[620px] w-full rounded-lg border border-border bg-white"
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
