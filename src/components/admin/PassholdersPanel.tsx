import { useEffect, useState } from 'react';
import { importPassholders, listPassholders, parsePassholderCSV } from '../../lib/admin';
import type { PassholderRow } from '../../lib/database.types';

export function PassholdersPanel() {
  const [list, setList] = useState<PassholderRow[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replace, setReplace] = useState(false);

  async function reload() {
    try { setList(await listPassholders()); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : 'Load failed'); }
  }
  useEffect(() => { reload(); }, []);

  async function doImport() {
    setErr(null); setMsg(null);
    const { rows, errors } = parsePassholderCSV(text);
    if (errors.length) setErr(`Parse warnings:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n…and ${errors.length - 5} more` : ''}`);
    if (rows.length === 0) { setErr('Nothing to import'); return; }
    setBusy(true);
    try {
      const { inserted } = await importPassholders(rows, replace);
      setMsg(`Imported ${inserted} passholders${replace ? ' (replaced existing)' : ' (added or updated)'}.`);
      setText('');
      await reload();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  const lastSync = list.reduce((mx, r) => (r.synced_at > mx ? r.synced_at : mx), '');

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-lg font-semibold">{list.length} passholders</div>
            {lastSync && (
              <div className="text-xs text-slate-400">
                Last sync {new Date(lastSync).toLocaleString('en-US', { timeZone: 'America/New_York' })}
              </div>
            )}
          </div>
        </div>
        <div className="text-sm text-slate-400 mb-2">
          Paste CSV below. Format: <code className="bg-slate-900 px-1 rounded">Name, Email, Barcode</code> (header row optional). Two columns OK if you just have Name + Barcode.
          <div className="mt-1">Export your Google Sheet as CSV (File → Download → CSV) and paste.</div>
        </div>
        <textarea
          className="w-full h-40 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 font-mono text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Jane Doe, jane@example.com, P00001&#10;John Smith, john@example.com, P00002"
        />
        <label className="flex items-center gap-2 mt-2 text-sm">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          Replace all existing passholders (uncheck to merge by barcode)
        </label>
        {err && <div className="text-red-400 text-sm whitespace-pre-wrap mt-2">{err}</div>}
        {msg && <div className="text-emerald-400 text-sm mt-2">{msg}</div>}
        <button
          disabled={busy || !text.trim()}
          onClick={doImport}
          className="mt-3 bg-brand hover:bg-brand-dark disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg"
        >
          {busy ? 'Importing…' : 'Import passholders'}
        </button>
      </div>

      {list.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <div className="text-sm font-semibold mb-2">Current list ({list.length})</div>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-400">
                <tr>
                  <th className="text-left font-normal py-1">Name</th>
                  <th className="text-left font-normal py-1">Email</th>
                  <th className="text-left font-normal py-1">Barcode</th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, 500).map((p) => (
                  <tr key={p.id} className="border-t border-slate-700">
                    <td className="py-1">{p.name}</td>
                    <td className="py-1 text-slate-400">{p.email ?? ''}</td>
                    <td className="py-1 font-mono text-xs">{p.barcode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.length > 500 && <div className="text-xs text-slate-500 mt-2">Showing first 500.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
