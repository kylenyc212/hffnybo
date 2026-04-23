import { useEffect, useState } from 'react';
import { queueCount, subscribe, syncPending, wireAutoSync } from '../lib/offlineQueue';
import { latestSync, CacheKeys } from '../lib/cache';

function fmtAgo(d: Date): string {
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 45) return 'just now';
  if (secs < 90) return '1m ago';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

export function SyncIndicator() {
  const [n, setN] = useState(queueCount());
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(
    latestSync([CacheKeys.screenings + ':2026-05-01:2026-05-07', CacheKeys.passholders, CacheKeys.openDrawer])
  );

  useEffect(() => {
    wireAutoSync();
    const unsub = subscribe(() => setN(queueCount()));
    const onOn = () => setOnline(true);
    const onOff = () => setOnline(false);
    window.addEventListener('online', onOn);
    window.addEventListener('offline', onOff);
    // Tick last-sync clock every 30s
    const tick = setInterval(() => {
      setLastSync(latestSync([
        CacheKeys.screenings + ':2026-05-01:2026-05-07',
        CacheKeys.passholders,
        CacheKeys.openDrawer
      ]));
    }, 30_000);
    return () => {
      unsub();
      window.removeEventListener('online', onOn);
      window.removeEventListener('offline', onOff);
      clearInterval(tick);
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

  const stale = lastSync ? (Date.now() - lastSync.getTime()) / 60000 : Infinity;
  const staleTone =
    stale < 5 ? 'text-slate-500' :
    stale < 30 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="flex items-center gap-3 text-xs">
      <div className="flex items-center gap-1" title={online ? 'Online' : 'Offline — still works, queues sales locally'}>
        <span className={`w-2 h-2 rounded-full inline-block ${online ? 'bg-emerald-500' : 'bg-red-500'}`} />
        <span className={online ? 'text-emerald-400' : 'text-red-400'}>{online ? 'online' : 'offline'}</span>
      </div>
      {lastSync && (
        <div className={staleTone} title={`Catalog + passholders last refreshed ${lastSync.toLocaleString()}`}>
          data {fmtAgo(lastSync)}
        </div>
      )}
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
