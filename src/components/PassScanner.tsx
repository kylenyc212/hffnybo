import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { lookupPassholder, createPassholder } from '../lib/queries';

interface Props {
  onClose: () => void;
  onFound: (ph: { id: string; name: string; email: string | null; barcode: string }) => void;
}

export function PassScanner({ onClose, onFound }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [status, setStatus] = useState('Starting camera…');
  const [manual, setManual] = useState('');

  // Registration state — set when a scanned barcode is not in the system
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);
  const [regName, setRegName]   = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [saving, setSaving]     = useState(false);
  const [saveErr, setSaveErr]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

    (async () => {
      try {
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        if (devices.length === 0) {
          setStatus('No camera available. Enter barcode manually below.');
          return;
        }
        const back = devices.find((d) => /back|rear|environment/i.test(d.label)) ?? devices[0];
        if (cancelled || !videoRef.current) return;
        const controls = await reader.decodeFromVideoDevice(back.deviceId, videoRef.current, async (result, _err) => {
          if (!result) return;
          const text = result.getText();
          controls.stop();
          await handleBarcode(text);
        });
        controlsRef.current = controls;
        setStatus('Point camera at pass barcode…');
      } catch (e: unknown) {
        setStatus(`Camera error: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    })();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
    };
  }, []);

  async function handleBarcode(code: string) {
    setStatus(`Looking up ${code}…`);
    setUnknownBarcode(null);
    try {
      const ph = await lookupPassholder(code);
      if (!ph) {
        // Unknown barcode — show registration form
        setUnknownBarcode(code);
        setRegName('');
        setRegEmail('');
        setSaveErr(null);
        setStatus('');
        return;
      }
      onFound(ph);
    } catch (e: unknown) {
      setStatus(`Lookup error: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  async function registerAndContinue() {
    if (!unknownBarcode || !regName.trim()) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const ph = await createPassholder({ barcode: unknownBarcode, name: regName, email: regEmail || null });
      onFound(ph);
    } catch (e: unknown) {
      setSaveErr(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
    }
  }

  // ── Registration form (unknown barcode) ────────────────────────────────────
  if (unknownBarcode) {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="font-bold text-lg">Register pass</div>
            <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
          </div>

          <div className="bg-amber-900/30 border border-amber-700 rounded-xl p-3">
            <div className="text-amber-300 text-sm font-semibold mb-0.5">Pass not in system</div>
            <div className="text-xs text-slate-400 font-mono">{unknownBarcode}</div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">
                Name <span className="text-red-400">*</span>
              </label>
              <input
                autoFocus
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm"
                placeholder="Pass holder name"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                autoCapitalize="words"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">
                Email <span className="text-slate-500">(optional)</span>
              </label>
              <input
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm"
                placeholder="email@example.com"
                type="email"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                autoCapitalize="none"
              />
            </div>
          </div>

          {saveErr && (
            <div className="text-red-400 text-sm">{saveErr}</div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => { setUnknownBarcode(null); setStatus('Point camera at pass barcode…'); }}
              className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-xl"
            >
              Scan again
            </button>
            <button
              disabled={!regName.trim() || saving}
              onClick={registerAndContinue}
              className="flex-[2] bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-bold py-3 rounded-xl"
            >
              {saving ? 'Saving…' : 'Save & continue →'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Normal scanner view ────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-bold">Scan pass barcode</div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>
        <video
          ref={videoRef}
          className="w-full aspect-video bg-black rounded-lg"
          muted
          playsInline
        />
        <div className="text-sm text-slate-300 mt-2">{status}</div>
        <div className="mt-3 flex gap-2">
          <input
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
            placeholder="Or type barcode…"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
          <button
            onClick={() => manual.trim() && handleBarcode(manual.trim())}
            className="bg-brand hover:bg-brand-dark text-white px-4 py-2 rounded-lg font-semibold"
          >
            Look up
          </button>
        </div>
      </div>
    </div>
  );
}
