import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { lookupPassholder } from '../lib/queries';

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
    try {
      const ph = await lookupPassholder(code);
      if (!ph) {
        setStatus(`No passholder found for barcode "${code}".`);
        return;
      }
      onFound(ph);
    } catch (e: unknown) {
      setStatus(`Lookup error: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

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
