import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Shield, FileText, ClipboardCheck, Activity, User, LogOut, Menu, X } from 'lucide-react';
import { useState } from 'react';
import useAuthStore from '../store/authStore';
import toast from 'react-hot-toast';

const navItems = [
  { to: '/', label: 'Dashboard', icon: Activity, exact: true },
  { to: '/consent', label: 'Consent', icon: ClipboardCheck },
  { to: '/records', label: 'Health Records', icon: FileText },
  { to: '/audit', label: 'Audit Trail', icon: Shield },
  { to: '/profile', label: 'Profile', icon: User },
];

export default function Layout() {
  const { user, healthId, logout } = useAuthStore();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    toast.success('Logged out successfully');
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-white transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 md:static md:inset-auto`}>
        
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-700">
          <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-bold text-sm">HealthSecure</p>
            <p className="text-xs text-slate-400">Your Health, Your Control</p>
          </div>
        </div>

        {/* Health ID Badge */}
        <div className="mx-4 my-4 bg-blue-600 rounded-lg px-4 py-3">
          <p className="text-xs text-blue-200 mb-1">Lifetime Health ID</p>
          <p className="font-mono font-bold text-sm">{healthId}</p>
        </div>

        {/* Nav */}
        <nav className="px-4 space-y-1">
          {navItems.map(({ to, label, icon: Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
              onClick={() => setSidebarOpen(false)}
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User footer */}
        <div className="absolute bottom-0 left-0 right-0 px-4 py-4 border-t border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white truncate max-w-[140px]">{user?.fullName}</p>
              <p className="text-xs text-slate-400">Patient</p>
            </div>
            <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-400 transition-colors" title="Logout">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="md:hidden bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
          <button onClick={() => setSidebarOpen(true)} className="p-2 text-slate-600">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            <span className="font-bold text-sm">HealthSecure</span>
          </div>
          <div className="w-9" />
        </header>

        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
