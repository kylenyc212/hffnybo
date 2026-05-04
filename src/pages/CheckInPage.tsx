import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { useSession } from '../lib/session';
import {
  loadCheckinCounts,
  getUpcomingForCheckin,
  recordWixCheckin,
  recordManualCheckin,
  lookupScreeningByWixId,
} from '../lib/checkins';
import { fmtTime } from '../lib/datetime';
import { GuestListTab } from '../components/GuestListTab';

type Phase = 'scan' | 'lookup' | 'review' | 'done';
type MainTab = 'scan' | 'guestlist';

interface WixTicket {
  ticketNumber?: string;
  guestFullName?: string;
  orderFullName?: string;
  guestDetails?: { firstName?: string; lastName?: string; email?: string } | null;
  name?: string;
  checkIn?: { created?: string } | null;
  checkedIn?: boolean;
  status?: string;
  canceled?: boolean;
  archived?: boolean;
  orderStatus?: string;
  eventId?: string;
  [key: string]: unknown;
}

interface UpcomingScreening {
  id: string;
  title: string;
  starts_at: string;
  capacity: number;
  online_sold: number;
  wix_event_ids: string[];
}

function parseQr(raw: string): { ticketNumber: string; eventId: string } | null {
  const trimmed = raw.trim();
  try {
    const u = new URL(trimmed);
    const m = u.pathname.match(/\/check-in\/([^,/?]+)(?:,([^/?]+))?/);
    if (m) return { ticketNumber: m[1], eventId: m[2] ?? '' };
  } catch { /* not a URL */ }
  return trimmed ? { ticketNumber: trimmed, eventId: '' } : null;
}

function detectCheckedIn(t: WixTicket): boolean {
  if (t.checkedIn === true) return true;
  if (t.status === 'CHECKED_IN') return true;
  if (t.checkIn !== null && t.checkIn !== undefined) return true;
  return false;
}

export function CheckInPage() {
  const { user } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Main tab ──
  const [mainTab, setMainTab] = useState<MainTab>('scan');
  // Set when user taps a screening card — GuestListTab picks this up to jump to that event
  const [jumpEventId, setJumpEventId] = useState<string | undefined>(undefined);

  // ── Upcoming screenings ──
  const [upcoming, setUpcoming] = useState<UpcomingScreening[]>([]);
  const [checkinCounts, setCheckinCounts] = useState<Map<string, number>>(new Map());

  // ── Scanner state ──
  const [phase, setPhase] = useState<Phase>('scan');
  const [scanKey, setScanKey] = useState(0);
  const [ticket, setTicket] = useState<WixTicket | null>(null);
  const [rawResponse, setRawResponse] = useState<Record<string, unknown> | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [ticketNum, setTicketNum] = useState('');
  const [eventId, setEventId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [camStatus, setCamStatus] = useState('Starting camera…');
  const [scanScreening, setScanScreening] = useState<{ id: string; title: string; starts_at: string } | null>(null);
  const [undoing, setUndoing] = useState(false);

  const videoRef    = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);

  async function refreshCounts() {
    try {
      const [screens, counts] = await Promise.all([
        getUpcomingForCheckin(2),
        loadCheckinCounts(),
      ]);
      setUpcoming(screens);
      setCheckinCounts(counts);
    } catch { /* ignore */ }
  }

  useEffect(() => { refreshCounts(); }, []);

  // Poll every 15 s so counts stay fresh across devices without a manual reload.
  useEffect(() => {
    const id = setInterval(refreshCounts, 15_000);
    return () => clearInterval(id);
  }, []);

  // Auto-process a ticket handed off from the pass scanner (via ?ticket=&eventId= params)
  useEffect(() => {
    const ticket  = searchParams.get('ticket');
    const eventId = searchParams.get('eventId');
    if (!ticket) return;
    // Clear params from URL so a refresh doesn't re-trigger
    setSearchParams({}, { replace: true });
    const raw = eventId
      ? `https://www.wixevents.com/check-in/${ticket},${eventId}`
      : ticket;
    handleCode(raw);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Stop camera when not on the scan tab or not in scan phase
    if (phase !== 'scan' || mainTab !== 'scan') return;
    const reader = new BrowserMultiFormatReader();
    let cancelled = false;

    (async () => {
      try {
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        if (devices.length === 0) { setCamStatus('No camera found — use manual entry below.'); return; }
        if (cancelled || !videoRef.current) return;
        const back = devices.find((d) => /back|rear|environment/i.test(d.label)) ?? devices[0];
        const controls = await reader.decodeFromVideoDevice(back.deviceId, videoRef.current, (result) => {
          if (!result || cancelled) return;
          controls.stop();
          handleCode(result.getText());
        });
        // If cancelled while awaiting decodeFromVideoDevice, stop immediately
        if (cancelled) { controls.stop(); return; }
        controlsRef.current = controls;
        setCamStatus('Point camera at the QR code on the Wix ticket…');
      } catch {
        setCamStatus('Camera unavailable — use manual entry below.');
      }
    })();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
      // Explicitly kill MediaStream tracks so the camera indicator goes off
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, scanKey, mainTab]);

  async function handleCode(raw: string) {
    const parsed = parseQr(raw);
    if (!parsed) { setErr('Could not read a ticket number from that QR code.'); return; }

    const { ticketNumber: tn, eventId: eid } = parsed;
    setTicketNum(tn);
    setEventId(eid);
    setErr(null);
    setShowRaw(false);
    setScanScreening(null);
    setUndoing(false);
    setPhase('lookup');
    setBusy(true);

    // Look up matching BO screening in parallel with ticket fetch
    if (eid) {
      lookupScreeningByWixId(eid)
        .then((s) => { if (s) setScanScreening(s); })
        .catch(() => {});
    }

    try {
      const params = new URLSearchParams({ ticket: tn });
      if (eid) params.set('eventId', eid);
      const res  = await fetch(`/api/wix-checkin?${params}`);
      const data = await res.json() as Record<string, unknown>;
      setRawResponse(data);
      if (!res.ok) {
        setErr(String(data.error ?? 'Ticket lookup failed'));
        setPhase('scan');
        return;
      }
      const t = (data.ticket ?? data) as WixTicket;

      // Guard: reject non-Wix barcodes (pass/staff codes) immediately.
      const looksLikeWixTicket = !!(
        t.guestFullName ||
        t.orderFullName ||
        t.guestDetails?.firstName ||
        t.guestDetails?.email ||
        t.eventId ||
        t.status ||
        t.orderStatus ||
        t.checkedIn !== undefined ||
        t.canceled  !== undefined ||
        t.archived  !== undefined
      );
      if (!looksLikeWixTicket) {
        setErr('Not a Wix ticket — scan the QR code from the Wix confirmation email.');
        setPhase('scan');
        setScanKey((k) => k + 1);
        setBusy(false);
        return;
      }

      const tWithNum = { ...t, ticketNumber: t.ticketNumber ?? tn };
      setTicket(tWithNum);

      const thisCanceled  = !!t.canceled;
      const thisAlreadyIn = detectCheckedIn(t);

      // Canceled or already checked in → show review screen with the warning.
      if (thisCanceled || thisAlreadyIn) {
        setPhase('review');
        return;
      }

      // ── Auto check-in: valid ticket, no confirmation needed ──
      const checkRes = await fetch('/api/wix-checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketNumber: tn, eventId: eid }),
      });
      const checkData = await checkRes.json() as Record<string, unknown>;
      if (!checkRes.ok) {
        // Check-in failed — fall back to manual review so staff can see the error
        setErr(String(checkData.error ?? 'Auto check-in failed — tap Check In to retry'));
        setPhase('review');
        return;
      }

      // Record in our DB (best-effort)
      if (user) {
        const gdn = t.guestDetails
          ? [t.guestDetails.firstName, t.guestDetails.lastName].filter(Boolean).join(' ')
          : null;
        const gn = t.guestFullName ?? t.orderFullName ?? gdn ?? null;
        const tt = t.name ?? (t.orderStatus === 'FREE' ? 'Free / Comp' : null);
        recordWixCheckin({
          ticketNumber: tn,
          wixEventId:   eid,
          screeningId:  scanScreening?.id ?? null,
          checkedInBy:  user.name,
          guestName:    gn || null,
          ticketType:   (tt && tt !== 'Ticket') ? tt : null,
        }).catch(() => {});
      }

      setPhase('done');
      refreshCounts();
    } catch {
      setErr('Network error looking up ticket.');
      setPhase('scan');
    } finally {
      setBusy(false);
    }
  }

  async function doCheckIn() {
    const tn  = ticket?.ticketNumber ?? ticketNum;
    const eid = eventId || String(ticket?.eventId ?? '');
    if (!tn) return;
    if (!eid) {
      setErr('Event ID is missing — scan the full QR code from the ticket.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res  = await fetch('/api/wix-checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketNumber: tn, eventId: eid }),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        setErr(String(data.error ?? 'Check-in failed'));
        return;
      }

      // Record in our DB (best-effort — don't block on failure)
      if (user) {
        recordWixCheckin({
          ticketNumber: tn,
          wixEventId:   eid,
          screeningId:  scanScreening?.id ?? null,
          checkedInBy:  user.name,
          guestName:    guestName !== '—' ? guestName : null,
          ticketType:   ticketType !== 'Ticket' ? ticketType : null,
        }).catch(() => {});
      }

      setPhase('done');
      refreshCounts();
    } catch {
      setErr('Network error during check-in.');
    } finally {
      setBusy(false);
    }
  }

  async function doUndo() {
    const tn  = ticket?.ticketNumber ?? ticketNum;
    const eid = eventId || String(ticket?.eventId ?? '');
    if (!tn || !eid) return;
    setUndoing(true);
    setErr(null);
    try {
      const res  = await fetch('/api/wix-checkin', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketNumber: tn, eventId: eid }),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        setErr(String(data.error ?? 'Undo failed'));
        return;
      }
      refreshCounts();
      reset();
    } catch {
      setErr('Network error — undo failed.');
    } finally {
      setUndoing(false);
    }
  }

  function reset() {
    setPhase('scan');
    setScanKey((k) => k + 1);
    setTicket(null);
    setRawResponse(null);
    setShowRaw(false);
    setTicketNum('');
    setEventId('');
    setErr(null);
    setManual('');
    setBusy(false);
    setScanScreening(null);
    setCamStatus('Starting camera…');
  }

  if (!user) return <div className="p-6 text-slate-400">Sign in first.</div>;

  const guestDetailsName = ticket?.guestDetails
    ? [ticket.guestDetails.firstName, ticket.guestDetails.lastName].filter(Boolean).join(' ')
    : null;
  const guestName  = ticket?.guestFullName ?? ticket?.orderFullName ?? guestDetailsName ?? '—';
  const ticketType = ticket?.name
    ?? (ticket?.orderStatus === 'FREE' ? 'Free / Comp' : ticket?.orderStatus ? String(ticket.orderStatus) : 'Ticket');
  const alreadyIn  = ticket ? detectCheckedIn(ticket) : false;
  const isCanceled = !!ticket?.canceled;
  const checkInObj = ticket?.checkIn as Record<string, unknown> | null | undefined;
  const checkInTime = checkInObj?.created
    ? new Date(String(checkInObj.created)).toLocaleString('en-US', {
        timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit'
      })
    : null;

  return (
    <div className="p-4 sm:p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-3">Door Check-In</h1>

      {/* ── Tab bar: QR Scan | Guest List ── */}
      <div className="flex gap-1 mb-4 bg-slate-800 border border-slate-700 rounded-xl p-1">
        {(['scan', 'guestlist'] as MainTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setMainTab(t)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
              mainTab === t
                ? 'bg-brand text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t === 'scan' ? '⊡ QR Scan' : '☰ Guest List'}
          </button>
        ))}
      </div>

      {/* ── Guest List tab ── */}
      {mainTab === 'guestlist' && (
        <GuestListTab
          jumpToEventId={jumpEventId}
          onJumpConsumed={() => setJumpEventId(undefined)}
        />
      )}

      {/* ── Scan tab content (hidden when guest list is active) ── */}
      {mainTab === 'scan' && (
      <>

      {/* ── Upcoming screenings + counts + manual +1 ── */}
      {upcoming.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          {upcoming.map((s) => {
            const count = checkinCounts.get(s.id) ?? 0;
            return (
              <div
                key={s.id}
                className="bg-slate-800 border border-slate-700 rounded-xl p-3 cursor-pointer hover:border-brand/60 hover:bg-slate-700/70 transition-colors"
                onClick={() => {
                  const eid = s.wix_event_ids?.[0];
                  if (eid) { setJumpEventId(eid); setMainTab('guestlist'); }
                }}
              >
                <div className="text-xs font-semibold text-slate-200 leading-tight line-clamp-2 mb-1">{s.title}</div>
                <div className="text-xs text-slate-400">{fmtTime(s.starts_at)}</div>
                <div className="flex items-center justify-between mt-2 gap-1">
                  <span className="text-orange-400 font-bold text-sm">{count} ✓ in</span>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation(); // don't also trigger the card click
                      if (!user) return;
                      // optimistic update
                      setCheckinCounts((prev) => {
                        const next = new Map(prev);
                        next.set(s.id, (next.get(s.id) ?? 0) + 1);
                        return next;
                      });
                      await recordManualCheckin(s.id, user.name).catch(() => {});
                    }}
                    className="bg-orange-700 hover:bg-orange-600 text-white font-bold text-sm px-3 py-1 rounded-lg"
                  >
                    +1
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {err && (
        <div className="bg-red-900 border-2 border-red-500 text-red-100 font-bold text-center p-4 rounded-2xl mb-4 text-base">
          ⚠ {err}
        </div>
      )}

      {/* ── Scan phase ── */}
      {phase === 'scan' && (
        <div key={scanKey} className="space-y-3">
          <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
            <video ref={videoRef} className="w-full aspect-video bg-black" muted playsInline />
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

      {/* ── Lookup in progress ── */}
      {phase === 'lookup' && (
        <div className="text-center py-16 text-slate-400">
          <div className="text-lg mb-2">Looking up ticket…</div>
          <div className="font-mono text-sm">{ticketNum}</div>
        </div>
      )}

      {/* ── Review phase ── */}
      {phase === 'review' && ticket && (
        <div className="space-y-3">
          {isCanceled ? (
            <div className="bg-red-900 border-2 border-red-500 text-red-100 font-bold text-center py-4 rounded-2xl text-lg">
              ❌ TICKET CANCELED
            </div>
          ) : alreadyIn ? (
            <div className="bg-amber-900 border-2 border-amber-500 text-amber-100 font-bold text-center py-4 rounded-2xl">
              <div className="text-lg">⚠️ ALREADY CHECKED IN</div>
              {checkInTime && <div className="text-sm font-normal mt-0.5 text-amber-200">at {checkInTime}</div>}
            </div>
          ) : (
            <div className="bg-emerald-900/60 border-2 border-emerald-600 text-emerald-200 font-bold text-center py-4 rounded-2xl text-lg">
              ✓ VALID TICKET
            </div>
          )}

          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
            <div className="text-3xl font-bold mb-1 leading-tight">{guestName}</div>
            <div className="text-slate-300 text-lg">{ticketType}</div>
            {scanScreening && (
              <div className="text-slate-400 text-sm mt-1">
                {scanScreening.title} · {fmtTime(scanScreening.starts_at)}
              </div>
            )}
            <div className="text-xs text-slate-500 font-mono mt-3">
              {ticket.ticketNumber ?? ticketNum}
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={reset} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-xl">
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
            {(alreadyIn || isCanceled) && (
              <button onClick={reset} className="flex-[2] bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-xl">
                Scan next
              </button>
            )}
          </div>

          {rawResponse && (
            <div className="mt-1">
              <div className="flex gap-2 items-center">
                <button onClick={() => setShowRaw(!showRaw)} className="text-xs text-slate-500 hover:text-slate-300">
                  {showRaw ? '− Hide' : '+ Show'} raw Wix response
                </button>
                <button
                  onClick={() => navigator.clipboard?.writeText(JSON.stringify(rawResponse, null, 2))}
                  className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-0.5 rounded"
                >
                  Copy
                </button>
              </div>
              {showRaw && (
                <textarea
                  readOnly
                  value={JSON.stringify(rawResponse, null, 2)}
                  className="mt-1 w-full h-40 bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs font-mono text-slate-300 resize-y"
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Done phase ── */}
      {phase === 'done' && (
        <div className="space-y-3">
          <div className="bg-emerald-900/60 border-2 border-emerald-600 rounded-2xl p-10 text-center">
            <div className="text-6xl mb-4">✓</div>
            <div className="text-3xl font-bold text-emerald-300 leading-tight">{guestName}</div>
            <div className="text-emerald-200 text-lg mt-1">{ticketType}</div>
            {scanScreening && (
              <div className="text-emerald-400 text-sm mt-1">
                {scanScreening.title} · {fmtTime(scanScreening.starts_at)}
              </div>
            )}
            <div className="text-emerald-400 mt-3 font-semibold">Checked in!</div>
          </div>
          {err && (
            <div className="bg-red-900 border-2 border-red-500 text-red-100 font-bold text-center p-3 rounded-2xl text-sm">
              ⚠ {err}
            </div>
          )}
          <button onClick={reset} className="w-full bg-brand hover:bg-brand-dark text-white font-bold py-4 rounded-xl text-xl">
            Scan next ticket
          </button>
          <button
            onClick={doUndo}
            disabled={undoing}
            className="w-full bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 font-semibold py-3 rounded-xl text-sm"
          >
            {undoing ? 'Undoing…' : 'Undo check-in'}
          </button>
        </div>
      )}

      </> /* end scan tab */
      )}
    </div>
  );
}
