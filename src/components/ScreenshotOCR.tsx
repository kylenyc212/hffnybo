import { useRef, useState } from 'react';
import { parseHeartlandReceipt } from '../lib/heartland-receipt';
import type { ParsedHeartlandReceipt } from '../lib/heartland-receipt';
import { HeartlandReceiptModal } from './HeartlandReceiptModal';

interface Props {
  onExtracted: (name: string, ref: string) => void;
  onClose: () => void;
}

type Phase = 'idle' | 'capturing' | 'captured' | 'ocr' | 'done' | 'error';

export function ScreenshotOCR({ onExtracted, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase]         = useState<Phase>('idle');
  const [errMsg, setErrMsg]       = useState('');
  const [imgUrl, setImgUrl]       = useState<string | null>(null);
  const [rawText, setRawText]     = useState('');
  const [name, setName]           = useState('');
  const [ref, setRef]             = useState('');
  const [parsedReceipt, setParsedReceipt] = useState<(ParsedHeartlandReceipt & { _rawText?: string }) | null>(null);

  async function pasteFromClipboard() {
    setPhase('capturing');
    setErrMsg('');
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const url  = URL.createObjectURL(blob);
          const img  = new Image();
          img.onload = () => {
            const canvas = canvasRef.current!;
            canvas.width  = img.width;
            canvas.height = img.height;
            canvas.getContext('2d')!.drawImage(img, 0, 0);
            setImgUrl(url);
            setPhase('captured');
          };
          img.src = url;
          return;
        }
      }
      setErrMsg('No image found on clipboard. Take a screenshot, tap the thumbnail → Copy, then try again.');
      setPhase('error');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('denied') || msg.includes('not allowed')) {
        setErrMsg('Clipboard access denied. Tap "Allow" when Safari asks for permission.');
      } else {
        setErrMsg(`Could not read clipboard: ${msg}`);
      }
      setPhase('error');
    }
  }

  async function captureScreen() {
    setPhase('capturing');
    setErrMsg('');
    try {
      // Ask the user to pick a window / screen to share
      const stream = await (navigator.mediaDevices as MediaDevices & {
        getDisplayMedia(c?: MediaStreamConstraints): Promise<MediaStream>;
      }).getDisplayMedia({ video: true, audio: false });

      // Pull one frame off the video track
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      const w = settings.width  ?? 1280;
      const h = settings.height ?? 720;

      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();

      const canvas = canvasRef.current!;
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0, w, h);

      // Stop immediately — don't keep capturing
      stream.getTracks().forEach((t) => t.stop());
      video.remove();

      const url = canvas.toDataURL('image/png');
      setImgUrl(url);
      setPhase('captured');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('denied') || msg.includes('cancel') || msg.includes('Permission')) {
        setErrMsg('Screen access was cancelled or denied.');
      } else if (msg.includes('not supported') || msg.includes('getDisplayMedia')) {
        setErrMsg('Screen capture is not supported on this device/browser. Try taking a screenshot and using "Import photo" instead.');
      } else {
        setErrMsg(`Could not capture screen: ${msg}`);
      }
      setPhase('error');
    }
  }

  async function runOCR() {
    if (!canvasRef.current || !imgUrl) return;
    setPhase('ocr');
    try {
      // Lazy-load Tesseract so it doesn't bloat initial bundle
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng');
      const { data: { text } } = await worker.recognize(canvasRef.current);
      await worker.terminate();
      setRawText(text);

      // Try to parse as a Heartland receipt; always set so the modal can show
      // the raw OCR text for debugging even when items aren't detected.
      const receipt = parseHeartlandReceipt(text);
      setParsedReceipt({ ...receipt, _rawText: text });

      // Also extract name + ref as fallback
      const extractedName = extractName(text);
      const extractedRef  = extractRef(text) || receipt.receiptNumber;
      setName(extractedName);
      setRef(extractedRef);
      setPhase('done');
    } catch (e: unknown) {
      setErrMsg(`OCR failed: ${e instanceof Error ? e.message : String(e)}`);
      setPhase('error');
    }
  }

  function apply() {
    onExtracted(name, ref);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex flex-col overflow-auto p-4">
      <div className="max-w-xl mx-auto w-full space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-bold text-lg">Scan Heartland Receipt</div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>

        {/* Hidden canvas used for capture + OCR */}
        <canvas ref={canvasRef} className="hidden" />

        {phase === 'idle' && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">

            {/* ── Option 1: Clipboard (iPad-friendly) ── */}
            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Best on iPad</div>
              <ol className="text-xs text-slate-400 space-y-0.5 pl-4 list-decimal mb-2">
                <li>Take a screenshot (Power + Volume Up)</li>
                <li>Tap the thumbnail → <strong className="text-slate-300">Copy</strong></li>
                <li>Come back here and tap ↓</li>
              </ol>
              <button
                onClick={pasteFromClipboard}
                className="w-full bg-brand hover:bg-brand-dark text-white font-bold py-4 rounded-xl text-lg"
              >
                📋 Paste screenshot
              </button>
            </div>

            <div className="border-t border-slate-700" />

            {/* ── Option 2: Photo library ── */}
            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-300 uppercase tracking-wide">From photo library</div>
              <label className="w-full block">
                <span className="w-full block text-center bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-xl cursor-pointer">
                  🖼 Import screenshot
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const url = URL.createObjectURL(file);
                    const img = new Image();
                    img.onload = () => {
                      const canvas = canvasRef.current!;
                      canvas.width  = img.width;
                      canvas.height = img.height;
                      canvas.getContext('2d')!.drawImage(img, 0, 0);
                      setImgUrl(url);
                      setPhase('captured');
                    };
                    img.src = url;
                  }}
                />
              </label>
            </div>

            <div className="border-t border-slate-700" />

            {/* ── Option 3: Screen capture (Mac/desktop only) ── */}
            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Mac / desktop only</div>
              <button
                onClick={captureScreen}
                className="w-full bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-xl text-sm"
              >
                🖥 Capture window
              </button>
            </div>
          </div>
        )}

        {phase === 'capturing' && (
          <div className="text-center py-12 text-slate-400">
            <div className="text-4xl mb-3">📸</div>
            <div>Choose a window to share in the browser prompt…</div>
          </div>
        )}

        {phase === 'captured' && imgUrl && (
          <div className="space-y-3">
            <div className="text-sm text-slate-400">Captured — looks right?</div>
            <img src={imgUrl} alt="Captured screen" className="w-full rounded-xl border border-slate-600 max-h-64 object-contain bg-black" />
            <div className="flex gap-2">
              <button onClick={() => { setPhase('idle'); setImgUrl(null); }} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-xl">
                ← Retake
              </button>
              <button onClick={runOCR} className="flex-[2] bg-brand hover:bg-brand-dark text-white font-bold py-3 rounded-xl">
                Read text →
              </button>
            </div>
          </div>
        )}

        {phase === 'ocr' && (
          <div className="text-center py-12 text-slate-400">
            <div className="text-4xl mb-3">🔍</div>
            <div>Reading text… this takes a few seconds</div>
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-3">
            {imgUrl && (
              <img src={imgUrl} alt="Captured" className="w-full rounded-xl border border-slate-600 max-h-40 object-contain bg-black" />
            )}

            {/* Heartland receipt modal auto-opens; show status + scan-again button */}
            {parsedReceipt ? (
              <div className="space-y-3">
                {parsedReceipt.items.length > 0 ? (
                  <div className="bg-emerald-900/40 border border-emerald-700 rounded-xl p-3 text-sm text-emerald-200">
                    ✓ Heartland receipt — {parsedReceipt.items.length} item{parsedReceipt.items.length !== 1 ? 's' : ''} found
                  </div>
                ) : (
                  <div className="bg-amber-900/40 border border-amber-700 rounded-xl p-3 text-sm text-amber-200">
                    ⚠ No items detected — see raw OCR text in the panel below
                  </div>
                )}
                <button onClick={() => setPhase('idle')} className="w-full text-slate-400 hover:text-white text-sm py-2">
                  ← Scan again
                </button>
              </div>
            ) : (
              /* Fallback: just name + ref extraction */
              <div className="space-y-3">
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
                  <div className="text-sm text-slate-400">No receipt items found. Edit and use manually:</div>
                  <label className="block">
                    <div className="text-xs text-slate-400 mb-1">Customer name</div>
                    <input className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} placeholder="Not found" autoCapitalize="words" />
                  </label>
                  <label className="block">
                    <div className="text-xs text-slate-400 mb-1">Receipt #</div>
                    <input className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 font-mono" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Not found" autoCapitalize="off" />
                  </label>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setPhase('idle')} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-xl">← Redo</button>
                  <button onClick={apply} className="flex-[2] bg-emerald-700 hover:bg-emerald-600 text-white font-bold py-3 rounded-xl">Use these ✓</button>
                </div>
              </div>
            )}

            {rawText && (
              <details className="text-xs text-slate-600 pb-4">
                <summary className="cursor-pointer hover:text-slate-400">Show raw OCR text</summary>
                <pre className="mt-2 bg-slate-950 rounded p-2 whitespace-pre-wrap text-slate-500 max-h-40 overflow-auto">{rawText}</pre>
              </details>
            )}
          </div>
        )}

        {phase === 'error' && (
          <div className="space-y-3">
            <div className="bg-red-900/40 border border-red-700 text-red-200 text-sm p-4 rounded-xl">
              {errMsg}
            </div>
            <button onClick={() => setPhase('idle')} className="w-full bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-xl">
              ← Try again
            </button>
          </div>
        )}
      </div>

      {/* Full receipt import modal — shown on top when a receipt is parsed */}
      {parsedReceipt && phase === 'done' && (
        <HeartlandReceiptModal
          receipt={parsedReceipt}
          onConfirm={(receiptRef) => {
            onExtracted('', receiptRef); // set the ref # in CartPage
            onClose();
          }}
          onClose={() => setParsedReceipt(null)}
        />
      )}
    </div>
  );
}

// ── Heuristic extractors ──────────────────────────────────────────────────────

function extractRef(text: string): string {
  // Look for patterns like: Order #123456, Ref: 123456, Receipt 123456,
  // Transaction 123456, Auth 123456, Approval 123456
  const patterns = [
    /(?:order|receipt|ref(?:erence)?|trans(?:action)?|auth(?:orization)?|approval|invoice)\s*[:#]?\s*([A-Z0-9-]{4,20})/gi,
    /\b([A-Z]{2,4}-\d{4,10})\b/g,   // e.g. HL-123456
    /\bTXN\s*([A-Z0-9]{4,20})\b/gi,
  ];
  for (const pat of patterns) {
    const m = pat.exec(text);
    if (m?.[1]) return m[1].trim();
  }
  // Fallback: longest standalone number 4–10 digits
  const nums = text.match(/\b\d{4,10}\b/g) ?? [];
  return nums.sort((a, b) => b.length - a.length)[0] ?? '';
}

function extractName(text: string): string {
  // Heartland receipts often show cardholder name after "Name:" or on the
  // signature line. Also look for "SALE" lines with a name above.
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^(?:name|cardholder|card holder|customer)[:\s]+(.+)/i);
    if (m) return titleCase(m[1].trim());
  }
  // Heuristic: find a line that looks like "FIRSTNAME LASTNAME" (2 words, no digits)
  for (const line of lines) {
    if (/^[A-Z][a-zA-Z'-]+\s+[A-Z][a-zA-Z'-]+$/.test(line.trim())) {
      return line.trim();
    }
  }
  return '';
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
