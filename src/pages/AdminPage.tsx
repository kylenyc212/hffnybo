import { useRef, useState } from 'react';
import { useSession } from '../lib/session';
import { SchedulePanel } from '../components/admin/SchedulePanel';
import { PassholdersPanel } from '../components/admin/PassholdersPanel';
import { UsersPanel } from '../components/admin/UsersPanel';
import { HeartlandPanel } from '../components/admin/HeartlandPanel';
import { WixPanel } from '../components/admin/WixPanel';

type Section = 'schedule' | 'wix' | 'passholders' | 'users' | 'heartland';

export function AdminPage() {
  const { user } = useSession();
  const [section, setSection] = useState<Section>('schedule');

  if (!user) return <div className="p-6 text-slate-400">Sign in first.</div>;
  if (user.role !== 'admin' && user.role !== 'super_admin') {
    return (
      <div className="p-6 max-w-lg mx-auto bg-amber-900/30 border border-amber-700 text-amber-100 rounded-xl">
        Admin access required. Ask an admin to promote your PIN via the Admin → Users page.
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Admin</h1>
      <div className="flex flex-wrap gap-2 mb-6">
        <Tab active={section === 'schedule'} onClick={() => setSection('schedule')}>Schedule</Tab>
        <Tab active={section === 'wix'} onClick={() => setSection('wix')}>Wix sync</Tab>
        <Tab active={section === 'passholders'} onClick={() => setSection('passholders')}>Passholders</Tab>
        <Tab active={section === 'users'} onClick={() => setSection('users')}>Users &amp; PINs</Tab>
        <Tab active={section === 'heartland'} onClick={() => setSection('heartland')}>Heartland</Tab>
      </div>
      {section === 'schedule' && <SchedulePanel />}
      {section === 'wix' && <WixPanel />}
      {section === 'passholders' && <PassholdersPanel />}
      {section === 'users' && <UsersPanel />}
      {section === 'heartland' && <HeartlandPanel />}

      <ScreenCapTest />
    </div>
  );
}

// ── Screen Capture API demo ──────────────────────────────────────────────────
function ScreenCapTest() {
  const [status, setStatus]   = useState<string | null>(null);
  const [imgSrc, setImgSrc]   = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);
  const videoRef              = useRef<HTMLVideoElement>(null);

  async function capture() {
    setBusy(true);
    setStatus(null);
    setImgSrc(null);
    try {
      // This line is the whole API — browser pops the OS picker
      const stream = await (navigator.mediaDevices as MediaDevices & {
        getDisplayMedia: (opts?: object) => Promise<MediaStream>;
      }).getDisplayMedia({ video: true, audio: false });

      // Feed stream into a hidden <video>, wait for it to load, grab a frame
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

      const canvas  = document.createElement('canvas');
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')!.drawImage(video, 0, 0);

      // Stop the stream immediately (dismiss the "sharing" indicator)
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;

      setImgSrc(canvas.toDataURL('image/png'));
      setStatus(`Captured ${canvas.width}×${canvas.height} px`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // User cancelled → NotAllowedError; not supported → name check
      setStatus(`Result: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-10 border-t border-slate-700 pt-6">
      <h2 className="text-lg font-bold mb-1">🖥 Screen Capture API test</h2>
      <p className="text-sm text-slate-400 mb-3">
        Pressing the button calls <code className="bg-slate-800 px-1 rounded">getDisplayMedia()</code>.
        The OS will show its own picker — you choose what to share (or cancel). Nothing leaves this page.
      </p>
      <button
        disabled={busy}
        onClick={capture}
        className="bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white font-bold px-5 py-2 rounded-xl"
      >
        {busy ? 'Waiting for picker…' : 'Test Screen Capture'}
      </button>

      {/* Hidden video used to decode the stream into a frame */}
      <video ref={videoRef} className="hidden" muted playsInline />

      {status && (
        <div className="mt-3 text-sm font-mono text-slate-300 bg-slate-800 rounded-lg px-3 py-2">
          {status}
        </div>
      )}
      {imgSrc && (
        <div className="mt-3">
          <div className="text-xs text-slate-500 mb-1">Captured frame (only visible to you, not sent anywhere):</div>
          <img src={imgSrc} alt="Screen capture" className="rounded-lg border border-slate-700 max-w-full" />
          <a
            href={imgSrc}
            download="screencap.png"
            className="mt-2 inline-block text-xs text-indigo-400 underline"
          >
            Download PNG
          </a>
        </div>
      )}
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg font-semibold ${
        active ? 'bg-brand text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  );
}
