import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { CatalogPage } from './pages/CatalogPage';
import { CartPage } from './pages/CartPage';
import { DrawerPage } from './pages/DrawerPage';
import { ReportsPage } from './pages/ReportsPage';
import { AdminPage } from './pages/AdminPage';
import { CheckInPage } from './pages/CheckInPage';
import { LoginGate } from './components/LoginGate';
import { SyncIndicator } from './components/SyncIndicator';
import { useSession } from './lib/session';

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `px-4 py-3 text-sm font-semibold tracking-wide ${
    isActive ? 'bg-brand text-white' : 'text-slate-300 hover:bg-slate-800'
  }`;

export default function App() {
  const { user, signOut } = useSession();
  return (
    <LoginGate>
      <div className="flex flex-col h-full">
        <header className="flex items-center justify-between bg-slate-950 border-b border-slate-800">
          <nav className="flex">
            <NavLink to="/catalog" className={tabClass}>Screenings</NavLink>
            <NavLink to="/cart" className={tabClass}>Cart</NavLink>
            <NavLink to="/checkin" className={tabClass}>Check In</NavLink>
            <NavLink to="/drawer" className={tabClass}>Cash Drawer</NavLink>
            <NavLink to="/reports" className={tabClass}>Reports</NavLink>
            <NavLink to="/admin" className={tabClass}>Admin</NavLink>
          </nav>
          <div className="flex items-center gap-3 px-4">
            <SyncIndicator />
            {user && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 hidden sm:inline">
                  {user.name}
                  {user.role !== 'cashier' && (
                    <span className="ml-1 text-slate-500">({user.role.replace('_', ' ')})</span>
                  )}
                </span>
                <button
                  onClick={signOut}
                  className="text-xs text-slate-500 hover:text-white bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded"
                  title="Sign out"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/catalog" replace />} />
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/drawer" element={<DrawerPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/checkin" element={<CheckInPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </main>
      </div>
    </LoginGate>
  );
}
