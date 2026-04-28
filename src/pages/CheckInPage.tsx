import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { useSession } from '../lib/session';

type Phase = 'scan' | 'lookup' | 'review' | 'done';

interface WixTicket {
  ticketNumber?: string;
  guestFullName?: string;
  orderFullName?: string;
  name?: string;          // ticket type label
  checkIn?: { created?: string } | null;
  canceled?: boolean;
  status?: string;
  [key: string]: unknown; // allow unknown fields from Wix
}

/** Parse a Wix ticket QR code URL or bare ticket number.
 *  QR format: https://www.wixevents.com/check-in/{ticketNumber},{eventId}
 *  Returns the ticketNumber string, or null if unparseable. */
function parseQr(raw: string): string | null {
  const trimmed = raw.trim();
  try {
    const u = new URL(trimmed);
    const m = u.pathname.match(/\/check-in\/([^,/?]+)/);
    if (m) return m[1];
  } catch {
    /* not a URL — fall through */
  }
  return trimmed || null;
}

export function CheckInPage() {
  const { user } = useSession();
  const [phase, setPhase]   = useState<Phase>('scan');
  const [ticket, setTicket] = useState<WixTicket | null>(null);
  const [ticketNum, setTicketNum] = useState('');
  const [err, setErr]       = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [busy, setBusy]     = useState(false);
  const [camStatus, setCamStatus] = useState('Starting camera…');
  const videoRef    = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);

  // Start / stop camera whenever we enter the scan phase
  useEffect(() => {
    if (phase !== 'scan') return;
    const reader = new BrowserMultiFormatReader();
    let cancelled = false;

    (async () => {
      try {
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        if (devices.length === 0) {
          setCamStatus('No camera found — use manual entry below.');
          return;
        }
        if (cancelled || !videoRef.current) return;
        const back =
          devices.find((d) => /back|rear|environment/i.test(d.label)) ?? devices[0];
        const controls = await reader.decodeFromVideoDevice(
          back.deviceId,
          videoRef.current,
          (result) => {
            if (!result || cancelled) return;
            controls.stop();
            handleCode(result.getText());
          }
        );
        controlsRef.current = controls;
        setCamStatus('Point camera at the QR code on the Wix ticket…');
      } catch {
        setCamStatus('Camera unavailable — use manual entry below.');
      }
    })();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function handleCode(raw: string) {
    const tn = parseQr(raw);
    if (!tn) { setErr('Could not read a ticket number from that QR code.'); return; }

    setTicketNum(tn);
    setErr(null);
    setPhase('lookup');
    setBusy(true);

    try {
      const res  = await fetch(`/api/wix-checkin?ticket=${encodeURIComponent(tn)}`);
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        setErr(String(data.error ?? 'Ticket lookup failed'));
        setPhase('scan');
        return;
      }
      // Wix may return { ticket: {...} } or the ticket object directly
      const t = (data.ticket ?? data) as WixTicket;
      setTicket({ ...t, ticketNumber: t.ticketNumber ?? tn });
      setPhase('review');
    } catch {
      setErr('Network error looking up ticket.');
      setPhase('scan');
    } finally {
      setBusy(false);
    }
  }

  async function doCheckIn() {
    const tn = ticket?.ticketNumber ?? ticketNum;
    if (!tn) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/wix-checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketNumber: tn }),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        setErr(String(data.error ?? 'Check-in failed'));
        return;
      }
      setPhase('done');
    } catch {
      setErr('Network error during check-in.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPhase('scan');
    setTicket(null);
    setTicketNum('');
    setErr(null);
    setManual('');
    setBusy(false);
    setCamStatus('Starting camera…');
  }

  if (!user) return <div className="p-6 text-slate-400">Sign in first.</div>;

  const guestName      = ticket?.guestFullName ?? ticket?.orderFullName ?? '—';
  const ticketType     = ticket?.name ?? 'Ticket';
  const alreadyIn      = !!ticket?.checkIn;
  const isCanceled     = !!ticket?.canceled;
  const checkInTime    = typeof ticket?.checkIn === 'object' && ticket.checkIn
    ? new Date(String(ticket.checkIn.created ?? '')).toLocaleString('en-US', {
        timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit'
      })
    : null;

  return (
    <div className="p-4 sm:p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-4">Door Check-In</h1>

      {err && (
        <div className="bg-red-900/40 border border-red-700 text-red-200 text-sm p-3 rounded-lg mb-4">
          {err}
        </div>
      )}

      {/* ── Scan phase ───────────────────────────────────── */}
      {phase === 'scan' && (
        <div className="space-y-3">
          <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
            <video
              ref={videoRef}
              className="w-full aspect-video bg-black"
              muted
              playsInline
            />
            <div className="px-4 py-2 text-sm text-slate-400">{camStatus}</div>
          </div>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
              placeholder="Or type / paste ticket number…"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && manual.trim() && handleCode(manual.trim())}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <button
              disabled={!manual.trim()}
              onClick={() => handleCode(manual.trim())}
              className="bg-brand hover:bg-brand-dark disabled:opacity-40 text-white px-4 py-2 rounded-lg font-semibold"
            >
              Look up
            </button>
          </div>
        </div>
      )}

      {/* ── Lookup in progress ───────────────────────────── */}
      {phase === 'lookup' && (
        <div className="text-center py-16 text-slate-400">
          <div className="text-lg mb-2">Looking up ticket…</div>
          <div className="font-mono text-sm">{ticketNum}</div>
        </div>
      )}

      {/* ── Review phase ─────────────────────────────────── */}
      {phase === 'review' && ticket && (
        <div className="space-y-3">
          {/* Status banner */}
          {isCanceled ? (
            <div className="bg-red-900 border-2 border-red-500 text-red-100 font-bold text-center py-4 rounded-2xl text-lg">
              ❌ TICKET CANCELED
            </div>
          ) : alreadyIn ? (
            <div className="bg-amber-900 border-2 border-amber-500 text-amber-100 font-bold text-center py-4 rounded-2xl">
              <div className="text-lg">⚠️ ALREADY CHECKED IN</div>
              {checkInTime && (
                <div className="text-sm font-normal mt-0.5 text-amber-200">at {checkInTime}</div>
              )}
            </div>
          ) : (
            <div className="bg-emerald-900/60 border-2 border-emerald-600 text-emerald-200 font-bold text-center py-4 rounded-2xl text-lg">
              ✓ VALID TICKET
            </div>
          )}

          {/* Ticket details card */}
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
            <div className="text-3xl font-bold mb-1 leading-tight">{guestName}</div>
            <div className="text-slate-300 text-lg">{ticketType}</div>
            <div className="text-xs text-slate-500 font-mono mt-3">
              {ticket.ticketNumber ?? ticketNum}
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-2">
            <button
              onClick={reset}
              className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-xl"
            >
              ← Back
            </button>
            {!isCanceled && !alreadyIn && (
              <button
                disabled={busy}
                onClick={doCheckIn}
                className="flex-[2] bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-xl"
              >
                {busy ? 'Checking in…' : 'Check In ✓'}
              </button>
            )}
            {alreadyIn && (
              <button
                onClick={reset}
                className="flex-[2] bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-xl"
              >
                Scan next
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Done phase ───────────────────────────────────── */}
      {phase === 'done' && (
        <div className="space-y-4">
          <div className="bg-emerald-900/60 border-2 border-emerald-600 rounded-2xl p-10 text-center">
            <div className="text-6xl mb-4">✓</div>
            <div className="text-3xl font-bold text-emerald-300 leading-tight">{guestName}</div>
            <div className="text-emerald-200 text-lg mt-1">{ticketType}</div>
            <div className="text-emerald-400 mt-3 font-semibold">Checked in!</div>
          </div>
          <button
            onClick={reset}
            className="w-full bg-brand hover:bg-brand-dark text-white font-bold py-4 rounded-xl text-xl"
          >
            Scan next ticket
          </button>
        </div>
      )}
    </div>
  );
}
