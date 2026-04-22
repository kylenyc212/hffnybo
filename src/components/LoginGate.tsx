import { useEffect, useState } from 'react';
import { useSession } from '../lib/session';
import { verifyPin, countUsers, createUser } from '../lib/auth';

type Phase = 'loading' | 'bootstrap' | 'login';

export function LoginGate({ children }: { children: React.ReactNode }) {
  const { user, deviceLabel, setUser, setDeviceLabel } = useSession();
  const [phase, setPhase] = useState<Phase>('loading');
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [device, setDevice] = useState(deviceLabel ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user && deviceLabel) return;
    (async () => {
      try {
        const n = await countUsers();
        setPhase(n === 0 ? 'bootstrap' : 'login');
      } catch (e: unknown) {
        setErr(
          (e instanceof Error ? e.message : 'Failed to reach Supabase') +
            ' — did you run supabase/schema.sql?'
        );
        setPhase('login');
      }
    })();
  }, [user, deviceLabel]);

  if (user && deviceLabel) return <>{children}</>;
  if (phase === 'loading') return <div className="p-6 text-slate-400">Loading…</div>;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!device.trim()) { setErr('Label this device (e.g. "iPad-1")'); return; }
    if (pin.length < 4) { setErr('PIN must be 4+ digits'); return; }
    setBusy(true);
    try {
      const u = await verifyPin(pin);
      if (!u) { setErr('PIN not recognized'); return; }
      setDeviceLabel(device.trim());
      setUser(u);
    } finally {
      setBusy(false);
      setPin('');
    }
  }

  async function handleBootstrap(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) { setErr('Enter your name'); return; }
    if (!device.trim()) { setErr('Label this device'); return; }
    if (pin.length < 4) { setErr('PIN must be 4+ digits'); return; }
    setBusy(true);
    try {
      const u = await createUser(name.trim(), pin, 'admin');
      setDeviceLabel(device.trim());
      setUser({ id: u.id, name: u.name, role: 'admin' });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to create admin');
    } finally {
      setBusy(false);
      setPin('');
    }
  }

  return (
    <div className="h-full flex items-center justify-center p-6">
      <form
        onSubmit={phase === 'bootstrap' ? handleBootstrap : handleLogin}
        className="w-full max-w-sm space-y-4 bg-slate-800 p-6 rounded-2xl shadow-xl"
      >
        <div className="text-2xl font-bold text-center">HFFNY Box Office</div>
        {phase === 'bootstrap' && (
          <div className="bg-amber-900/40 border border-amber-700 text-amber-200 text-sm p-3 rounded-lg">
            First-run setup. Create the primary admin account. You can add cashier PINs later.
          </div>
        )}
        {phase === 'bootstrap' && (
          <label className="block">
            <div className="text-xs uppercase text-slate-400 mb-1">Your name</div>
            <input
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-3 text-lg"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Kyle"
            />
          </label>
        )}
        <label className="block">
          <div className="text-xs uppercase text-slate-400 mb-1">Device label</div>
          <input
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-3 text-lg"
            value={device}
            onChange={(e) => setDevice(e.target.value)}
            placeholder="iPad-1, iPhone-Kyle…"
            autoCapitalize="off"
          />
        </label>
        <label className="block">
          <div className="text-xs uppercase text-slate-400 mb-1">
            {phase === 'bootstrap' ? 'Choose a 4–8 digit PIN' : 'PIN'}
          </div>
          <input
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-3 text-2xl tracking-widest text-center"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
          />
        </label>
        {err && <div className="text-red-400 text-sm">{err}</div>}
        <button
          disabled={busy}
          className="w-full bg-brand hover:bg-brand-dark text-white font-bold py-3 rounded-lg disabled:opacity-50"
        >
          {busy ? 'Working…' : phase === 'bootstrap' ? 'Create admin' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
