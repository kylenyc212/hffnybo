import { useEffect, useRef, useState } from 'react';
import { listPassholders, updatePassholder } from '../../lib/admin';
import type { PassholderRow } from '../../lib/database.types';

// Inline-editable row: auto-saves on blur if the name changed.
function PassRow({ pass, onSaved }: { pass: PassholderRow; onSaved: (id: string, name: string) => void }) {
  const [draft, setDraft]   = useState(pass.name ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [err, setErr]       = useState<string | null>(null);
  const original = useRef(pass.name ?? '');

  // Keep draft in sync if parent refreshes (e.g. after initial load)
  useEffect(() => {
    setDraft(pass.name ?? '');
    original.current = pass.name ?? '';
  }, [pass.name]);

  async function save() {
    if (draft === original.current) return; // nothing changed
    setSaving(true);
    setErr(null);
    try {
      await updatePassholder(pass.id, draft);
      original.current = draft;
      onSaved(pass.id, draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-t border-slate-700 group">
      <td className="py-1.5 pr-3 font-mono text-xs text-slate-400 whitespace-nowrap">{pass.barcode}</td>
      <td className="py-1 w-full">
        <input
          type="text"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setSaved(false); }}
          onBlur={save}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur())}
          placeholder="— unassigned —"
          className="w-full bg-transparent border border-transparent focus:border-slate-600 focus:bg-slate-900 rounded px-2 py-0.5 text-sm outline-none placeholder-slate-600"
        />
      </td>
      <td className="py-1 pl-2 w-8 text-right">
        {saving && <span className="text-xs text-slate-500">…</span>}
        {saved  && <span className="text-xs text-emerald-400">✓</span>}
        {err    && <span className="text-xs text-red-400" title={err}>!</span>}
      </td>
    </tr>
  );
}

export function PassholdersPanel() {
  const [passes, setPasses] = useState<PassholderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  async function reload() {
    setLoading(true);
    try {
      const all = await listPassholders();
      // Sort: ACS first then CIN25, numerically within each series
      all.sort((a, b) => {
        const seriesA = a.barcode.startsWith('ACS') ? 0 : 1;
        const seriesB = b.barcode.startsWith('ACS') ? 0 : 1;
        if (seriesA !== seriesB) return seriesA - seriesB;
        return a.barcode.localeCompare(b.barcode, undefined, { numeric: true });
      });
      setPasses(all);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  function handleSaved(id: string, name: string) {
    setPasses((prev) => prev.map((p) => p.id === id ? { ...p, name } : p));
  }

  const acs   = passes.filter((p) => p.barcode.startsWith('ACS'));
  const cin25 = passes.filter((p) => p.barcode.startsWith('CIN25'));

  const q = search.trim().toLowerCase();
  const filterRows = (rows: PassholderRow[]) =>
    q ? rows.filter((p) =>
      p.barcode.toLowerCase().includes(q) ||
      (p.name ?? '').toLowerCase().includes(q)
    ) : rows;

  const assigned   = passes.filter((p) => (p.name ?? '').trim()).length;
  const unassigned = passes.length - assigned;

  if (loading) return <div className="text-sm text-slate-400 py-6 text-center">Loading passes…</div>;
  if (err)     return <div className="text-sm text-red-400 py-4">{err} <button onClick={reload} className="underline ml-2">Retry</button></div>;

  return (
    <div className="space-y-4">
      {/* Stats + search */}
      <div className="flex items-center gap-3">
        <div className="text-sm text-slate-400 shrink-0">
          <span className="text-white font-semibold">{assigned}</span>/{passes.length} assigned
          {unassigned > 0 && <span className="text-slate-500 ml-2">({unassigned} open)</span>}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or barcode…"
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm"
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>

      <p className="text-xs text-slate-500">
        Tap a name field to edit · press Enter or tap away to save
      </p>

      {/* ACS series */}
      {filterRows(acs).length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-4 py-2 bg-slate-700/50 text-xs font-semibold text-slate-300 flex justify-between">
            <span>ACS passes ({acs.length})</span>
            <span className="text-slate-500">{acs.filter((p) => (p.name ?? '').trim()).length} assigned</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full px-4">
              <tbody className="divide-y divide-slate-700/0">
                {filterRows(acs).map((p) => (
                  <PassRow key={p.id} pass={p} onSaved={handleSaved} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CIN25 series */}
      {filterRows(cin25).length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-4 py-2 bg-slate-700/50 text-xs font-semibold text-slate-300 flex justify-between">
            <span>CIN25 passes ({cin25.length})</span>
            <span className="text-slate-500">{cin25.filter((p) => (p.name ?? '').trim()).length} assigned</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full px-4">
              <tbody>
                {filterRows(cin25).map((p) => (
                  <PassRow key={p.id} pass={p} onSaved={handleSaved} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {q && filterRows(acs).length === 0 && filterRows(cin25).length === 0 && (
        <div className="text-sm text-slate-500 text-center py-6">No passes match "{search}"</div>
      )}
    </div>
  );
}
