import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { CatalogPage } from './pages/CatalogPage';
import { CartPage } from './pages/CartPage';
import { DrawerPage } from './pages/DrawerPage';
import { ReportsPage } from './pages/ReportsPage';
import { AdminPage } from './pages/AdminPage';
import { LoginGate } from './components/LoginGate';
import { SyncIndicator } from './components/SyncIndicator';

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `px-4 py-3 text-sm font-semibold tracking-wide ${
    isActive ? 'bg-brand text-white' : 'text-slate-300 hover:bg-slate-800'
  }`;

export default function App() {
  return (
    <LoginGate>
      <div className="flex flex-col h-full">
        <header className="flex items-center justify-between bg-slate-950 border-b border-slate-800">
          <nav className="flex">
            <NavLink to="/catalog" className={tabClass}>Screenings</NavLink>
            <NavLink to="/cart" className={tabClass}>Cart</NavLink>
            <NavLink to="/drawer" className={tabClass}>Cash Drawer</NavLink>
            <NavLink to="/reports" className={tabClass}>Reports</NavLink>
            <NavLink to="/admin" className={tabClass}>Admin</NavLink>
          </nav>
          <div className="flex items-center gap-3 px-4">
            <SyncIndicator />
            <span className="text-xs text-slate-400">HFFNY Box Office</span>
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/catalog" replace />} />
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/drawer" element={<DrawerPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </main>
      </div>
    </LoginGate>
  );
}
