import { useState } from 'react';
import { useSession } from '../lib/session';
import { SchedulePanel } from '../components/admin/SchedulePanel';
import { PassholdersPanel } from '../components/admin/PassholdersPanel';
import { UsersPanel } from '../components/admin/UsersPanel';
import { HeartlandPanel } from '../components/admin/HeartlandPanel';

type Section = 'schedule' | 'passholders' | 'users' | 'heartland';

export function AdminPage() {
  const { user } = useSession();
  const [section, setSection] = useState<Section>('schedule');

  if (!user) return <div className="p-6 text-slate-400">Sign in first.</div>;
  if (user.role !== 'admin') {
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
        <Tab active={section === 'passholders'} onClick={() => setSection('passholders')}>Passholders</Tab>
        <Tab active={section === 'users'} onClick={() => setSection('users')}>Users &amp; PINs</Tab>
        <Tab active={section === 'heartland'} onClick={() => setSection('heartland')}>Heartland</Tab>
      </div>
      {section === 'schedule' && <SchedulePanel />}
      {section === 'passholders' && <PassholdersPanel />}
      {section === 'users' && <UsersPanel />}
      {section === 'heartland' && <HeartlandPanel />}
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
