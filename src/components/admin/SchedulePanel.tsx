import { useEffect, useState } from 'react';
import { money, toCents } from '../../lib/money';
import { fmtWhen } from '../../lib/datetime';
import {
  listScreenings,
  upsertScreening,
  deleteScreening,
  listTicketTypes,
  upsertTicketType,
  deleteTicketType
} from '../../lib/admin';
import type { ScreeningRow, TicketTypeRow, TicketCategory, CompCategory } from '../../lib/database.types';

export function SchedulePanel() {
  const [list, setList] = useState<ScreeningRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    try { setList(await listScreenings()); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : 'Failed to load'); }
  }
  useEffect(() => { reload(); }, []);

  return (
    <div>
      {err && <div className="text-red-400 text-sm mb-2">{err}</div>}
      <div className="flex justify-end mb-3">
        <button
          onClick={() => setCreating(true)}
          className="bg-brand hover:bg-brand-dark text-white px-4 py-2 rounded-lg font-semibold"
        >+ New screening</button>
      </div>
      {creating && (
        <ScreeningEditor
          onCancel={() => setCreating(false)}
          onSaved={async () => { setCreating(false); await reload(); }}
        />
      )}
      <ul className="space-y-2">
        {list.map((s) => (
          <li key={s.id} className="bg-slate-800 border border-slate-700 rounded-xl">
            <button
              onClick={() => setExpanded(expanded === s.id ? null : s.id)}
              className="w-full text-left p-3 flex items-center justify-between gap-3"
            >
              <div>
                <div className="text-xs text-slate-400">{fmtWhen(s.starts_at)}</div>
                <div className="font-semibold">{s.title}</div>
              </div>
              <div className="text-xs text-slate-400">
                cap {s.capacity}{s.is_free ? ' · FREE' : ''}{s.online_sold ? ` · ${s.online_sold} online` : ''}
                <span className="ml-2">{expanded === s.id ? '▾' : '▸'}</span>
              </div>
            </button>
            {expanded === s.id && (
              <div className="p-3 border-t border-slate-700 space-y-4">
                <ScreeningEditor
                  existing={s}
                  onCancel={() => setExpanded(null)}
                  onSaved={async () => { await reload(); }}
                  onDelete={async () => {
                    if (!confirm('Delete screening? Will fail if any tickets already sold.')) return;
                    try {
                      await deleteScreening(s.id);
                      setExpanded(null);
                      await reload();
                    } catch (e: unknown) {
                      alert(e instanceof Error ? e.message : 'Delete failed');
                    }
                  }}
                />
                <TicketTypesEditor screeningId={s.id} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScreeningEditor({
  existing, onCancel, onSaved, onDelete
}: {
  existing?: ScreeningRow;
  onCancel: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? '');
  const [startLocal, setStartLocal] = useState(existing ? toLocalInput(existing.starts_at) : '');
  const [capacity, setCapacity] = useState(existing?.capacity ?? 200);
  const [online, setOnline] = useState(existing?.online_sold ?? 0);
  const [isFree, setIsFree] = useState(existing?.is_free ?? false);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setErr(null);
    if (!title.trim()) { setErr('Title required'); return; }
    if (!startLocal) { setErr('Date/time required'); return; }
    setBusy(true);
    try {
      await upsertScreening({
        id: existing?.id,
        title: title.trim(),
        starts_at: fromLocalInput(startLocal),
        capacity,
        online_sold: online,
        is_free: isFree,
        notes: notes.trim() || null
      });
      onSaved();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="sm:col-span-2">
          <div className="text-xs text-slate-400 mb-1">Title</div>
          <input
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          <div className="text-xs text-slate-400 mb-1">Date & time (NY)</div>
          <input
            type="datetime-local"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
          />
        </label>
        <label>
          <div className="text-xs text-slate-400 mb-1">Capacity</div>
          <input
            type="number" min="0"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
            value={capacity}
            onChange={(e) => setCapacity(Math.max(0, parseInt(e.target.value || '0', 10)))}
          />
        </label>
        <label>
          <div className="text-xs text-slate-400 mb-1">Online tickets sold (Wix)</div>
          <input
            type="number" min="0"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
            value={online}
            onChange={(e) => setOnline(Math.max(0, parseInt(e.target.value || '0', 10)))}
          />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} />
          <span className="text-sm">Free event</span>
        </label>
        <label className="sm:col-span-2">
          <div className="text-xs text-slate-400 mb-1">Notes</div>
          <input
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>
      {err && <div className="text-red-400 text-sm">{err}</div>}
      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy}
          onClick={save}
          className="bg-emerald-700 hover:bg-emerald-600 text-white font-semibold px-4 py-2 rounded-lg"
        >{busy ? 'Saving…' : existing ? 'Save changes' : 'Create screening'}</button>
        <button onClick={onCancel} className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg">
          Cancel
        </button>
        {onDelete && (
          <button onClick={onDelete} className="ml-auto bg-red-800 hover:bg-red-700 text-white px-4 py-2 rounded-lg">
            Delete screening
          </button>
        )}
      </div>
    </div>
  );
}

function TicketTypesEditor({ screeningId }: { screeningId: string }) {
  const [types, setTypes] = useState<TicketTypeRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function reload() {
    try { setTypes(await listTicketTypes(screeningId)); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : 'Failed to load'); }
  }
  useEffect(() => { reload(); }, [screeningId]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase text-slate-400">Ticket types</div>
        <button
          onClick={() => setAdding(!adding)}
          className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-2 py-1 rounded"
        >
          {adding ? 'Cancel' : '+ Add type'}
        </button>
      </div>
      {err && <div className="text-red-400 text-sm mb-2">{err}</div>}
      {adding && (
        <TypeRow
          screeningId={screeningId}
          onCancel={() => setAdding(false)}
          onSaved={async () => { setAdding(false); await reload(); }}
        />
      )}
      <ul className="space-y-2">
        {types.map((t) => (
          <li key={t.id}>
            <TypeRow
              screeningId={screeningId}
              existing={t}
              onSaved={reload}
              onDelete={async () => {
                if (!confirm(`Delete ticket type "${t.label}"?`)) return;
                try { await deleteTicketType(t.id); await reload(); }
                catch (e: unknown) { alert(e instanceof Error ? e.message : 'Delete failed'); }
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function TypeRow({
  screeningId, existing, onCancel, onSaved, onDelete
}: {
  screeningId: string;
  existing?: TicketTypeRow;
  onCancel?: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const [label, setLabel] = useState(existing?.label ?? '');
  const [priceStr, setPriceStr] = useState(existing ? (existing.price_cents / 100).toFixed(2) : '0.00');
  const [category, setCategory] = useState<TicketCategory>(existing?.category ?? 'paid');
  const [compCategory, setCompCategory] = useState<CompCategory | ''>(existing?.comp_category ?? '');
  const [active, setActive] = useState(existing?.active ?? true);

  async function save() {
    try {
      await upsertTicketType({
        id: existing?.id,
        screening_id: screeningId,
        label: label.trim() || 'Unnamed',
        price_cents: toCents(parseFloat(priceStr || '0')),
        category,
        comp_category: category === 'comp' ? (compCategory || null) : null,
        active,
        sort_order: existing?.sort_order ?? 50
      });
      onSaved();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Save failed');
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-2 grid grid-cols-12 gap-2 items-center">
      <input
        className="col-span-4 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
        placeholder="Label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <input
        className="col-span-2 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm tabular-nums"
        type="number" step="0.01" min="0"
        value={priceStr}
        onChange={(e) => setPriceStr(e.target.value)}
      />
      <select
        className="col-span-2 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
        value={category}
        onChange={(e) => setCategory(e.target.value as TicketCategory)}
      >
        <option value="paid">paid</option>
        <option value="comp">comp</option>
        <option value="other">other</option>
      </select>
      <select
        className="col-span-2 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
        disabled={category !== 'comp'}
        value={compCategory}
        onChange={(e) => setCompCategory(e.target.value as CompCategory | '')}
      >
        <option value="">—</option>
        <option value="press">press</option>
        <option value="pass_holder">pass_holder</option>
        <option value="industry">industry</option>
      </select>
      <label className="col-span-1 flex items-center gap-1 text-xs">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        on
      </label>
      <div className="col-span-1 flex gap-1 justify-end">
        <button onClick={save} className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white px-2 py-1 rounded">
          {existing ? 'Save' : 'Add'}
        </button>
        {onDelete && (
          <button onClick={onDelete} className="text-xs bg-red-800 hover:bg-red-700 text-white px-2 py-1 rounded">✕</button>
        )}
        {onCancel && !existing && (
          <button onClick={onCancel} className="text-xs bg-slate-700 text-white px-2 py-1 rounded">x</button>
        )}
      </div>
      {existing && (
        <div className="col-span-12 text-[10px] text-slate-500">
          {money(existing.price_cents)} · {existing.active ? 'active' : 'hidden'}
        </div>
      )}
    </div>
  );
}

// ---- Helpers: datetime-local <-> timestamptz ----

// A `datetime-local` input returns "YYYY-MM-DDTHH:mm" in the user's local TZ.
// Since HFFNY is in NY, treat that local as America/New_York and convert to ISO.
function toLocalInput(iso: string): string {
  // Format in NY, then join.
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function fromLocalInput(local: string): string {
  // Treat the input string as NY-local. Parse into a NY-local Date by appending
  // the current NY offset (EDT=-04, EST=-05). We compute the offset for that
  // specific instant to handle DST edges correctly.
  // Strategy: create a Date assuming UTC, then adjust by NY offset for that moment.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) {
    throw new Error('Invalid datetime');
  }
  // Compute the offset (in minutes) for NY on the given wall-clock instant.
  const asIfUTC = new Date(local + 'Z'); // what we'd get if we treated it as UTC
  const nyFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const nyParts = Object.fromEntries(
    nyFormatter.formatToParts(asIfUTC).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
  );
  const nyAsUTC = Date.UTC(
    Number(nyParts.year),
    Number(nyParts.month) - 1,
    Number(nyParts.day),
    Number(nyParts.hour === '24' ? '0' : nyParts.hour),
    Number(nyParts.minute),
    Number(nyParts.second)
  );
  const offsetMin = (asIfUTC.getTime() - nyAsUTC) / 60000;
  // Actual UTC time = local wall-clock minus NY offset
  const utcMs = new Date(local + 'Z').getTime() + offsetMin * 60000;
  return new Date(utcMs).toISOString();
}
