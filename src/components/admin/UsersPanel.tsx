import { useEffect, useState } from 'react';
import { addUser, listUsers, resetUserPin, setUserActive } from '../../lib/admin';
import type { UserRole, UserRow } from '../../lib/database.types';

export function UsersPanel() {
  const [list, setList] = useState<UserRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('cashier');

  async function reload() {
    try { setList(await listUsers()); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : 'Load failed'); }
  }
  useEffect(() => { reload(); }, []);

  async function create() {
    setErr(null); setMsg(null);
    if (!newName.trim()) { setErr('Name required'); return; }
    if (newPin.length < 4) { setErr('PIN must be 4+ digits'); return; }
    try {
      await addUser(newName.trim(), newPin, newRole);
      setNewName(''); setNewPin(''); setNewRole('cashier');
      setMsg('User added.');
      await reload();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Add failed');
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
        <div className="text-lg font-semibold mb-3">Add user</div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <input
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2"
            placeholder="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 tabular-nums"
            placeholder="PIN (4–8 digits)"
            inputMode="numeric"
            maxLength={8}
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
          />
          <select
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as UserRole)}
          >
            <option value="cashier">cashier</option>
            <option value="admin">admin</option>
          </select>
          <button
            onClick={create}
            className="bg-brand hover:bg-brand-dark text-white font-semibold rounded-lg px-4 py-2"
          >
            Add
          </button>
        </div>
        {err && <div className="text-red-400 text-sm mt-2">{err}</div>}
        {msg && <div className="text-emerald-400 text-sm mt-2">{msg}</div>}
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
        <div className="text-lg font-semibold mb-3">All users</div>
        <ul className="divide-y divide-slate-700">
          {list.map((u) => (
            <li key={u.id} className="py-2 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="font-medium">
                  {u.name}
                  {!u.active && <span className="ml-2 text-xs bg-slate-700 px-2 py-0.5 rounded">disabled</span>}
                </div>
                <div className="text-xs text-slate-400">{u.role}</div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const pin = prompt(`New PIN for ${u.name} (4–8 digits)`);
                    if (!pin || !/^\d{4,8}$/.test(pin)) return;
                    try { await resetUserPin(u.id, pin); alert('PIN reset.'); }
                    catch (e: unknown) { alert(e instanceof Error ? e.message : 'Failed'); }
                  }}
                  className="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded"
                >Reset PIN</button>
                <button
                  onClick={async () => {
                    try {
                      await setUserActive(u.id, !u.active);
                      await reload();
                    } catch (e: unknown) {
                      alert(e instanceof Error ? e.message : 'Failed');
                    }
                  }}
                  className={`text-xs px-3 py-1 rounded ${u.active ? 'bg-red-800 hover:bg-red-700' : 'bg-emerald-700 hover:bg-emerald-600'}`}
                >{u.active ? 'Disable' : 'Enable'}</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
