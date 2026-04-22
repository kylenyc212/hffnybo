import { useEffect, useState } from 'react';
import { queueCount, subscribe, syncPending, wireAutoSync } from '../lib/offlineQueue';

export function SyncIndicator() {
  const [n, setN] = useState(queueCount());
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    wireAutoSync();
    const unsub = subscribe(() => setN(queueCount()));
    const onOn = () => setOnline(true);
    const onOff = () => setOnline(false);
    window.addEventListener('online', onOn);
    window.addEventListener('offline', onOff);
    return () => {
      unsub();
      window.removeEventListener('online', onOn);
      window.removeEventListener('offline', onOff);
    };
  }, []);

  async function sync() {
    setBusy(true);
    setMsg(null);
    const r = await syncPending();
    setN(queueCount());
    if (r.attempted === 0) setMsg('Nothing to sync');
    else setMsg(`Synced ${r.succeeded}/${r.attempted}${r.failed ? ` — ${r.failed} failed` : ''}`);
    setBusy(false);
    setTimeout(() => setMsg(null), 4000);
  }

  if (online && n === 0) {
    return (
      <div className="flex items-center gap-1 text-xs text-emerald-400" title="Online, all sales synced">
        <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> online
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="flex items-center gap-1" title={online ? 'Online' : 'Offline'}>
        <span className={`w-2 h-2 rounded-full inline-block ${online ? 'bg-emerald-500' : 'bg-red-500'}`} />
        {online ? 'online' : 'offline'}
      </div>
      {n > 0 && (
        <>
          <span className="bg-amber-600 text-white font-semibold px-2 py-0.5 rounded-full">{n} pending</span>
          <button
            onClick={sync}
            disabled={busy || !online}
            className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white px-2 py-1 rounded"
          >
            {busy ? 'Syncing…' : 'Sync now'}
          </button>
        </>
      )}
      {msg && <span className="text-slate-300">{msg}</span>}
    </div>
  );
}
