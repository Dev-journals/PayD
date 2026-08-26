import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  Code,
  User,
  Wallet,
  FileText,
  Globe,
  LayoutDashboard,
  Activity,
  ShieldAlert,
  Menu,
  X,
  BarChart2,
  TrendingUp,
} from 'lucide-react';
import { Avatar } from './Avatar';

const AppNav: React.FC = () => {
  const [mobileOpen, setMobileOpen] = useState(false);

  // Mock user data - replace with actual user context
  const currentUser = {
    email: 'user@example.com',
    name: 'John Doe',
    imageUrl: undefined,
  };

  const navLinks = (
    <>
      <NavLink
        to="/payroll"
        className={({ isActive }) =>
          `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition ${
            isActive
              ? 'text-(--accent) bg-white/5'
              : 'text-(--muted) hover:bg-white/10 hover:text-white'
          }`
        }
        onClick={() => setMobileOpen(false)}
      >
        <span className="opacity-70">
          <Wallet className="w-4 h-4" />
        </span>
        <span className="hidden sm:inline">Payroll</span>
      </NavLink>

      <NavLink
        to="/employee"
        className={({ isActive }) =>
          `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition ${
            isActive
              ? 'text-(--accent) bg-white/5'
              : 'text-(--muted) hover:bg-white/10 hover:text-white'
          }`
        }
        onClick={() => setMobileOpen(false)}
      >
        <span className="opacity-70">
          <User className="w-4 h-4" />
        </span>
        <span className="hidden sm:inline">Employees</span>
      </NavLink>

      <NavLink
        to="/portal"
        className={({ isActive }) =>
          `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition ${
            isActive
              ? 'text-(--accent) bg-white/5'
              : 'text-(--muted) hover:bg-white/10 hover:text-white'
          }`
        }
      >
        <span className="opacity-70">
          <LayoutDashboard className="w-4 h-4" />
        </span>
        My Portal
      </NavLink>

      <NavLink
        to="/reports"
        className={({ isActive }) =>
          `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition ${
            isActive
              ? 'text-(--accent) bg-white/5'
              : 'text-(--muted) hover:bg-white/10 hover:text-white'
          }`
        }
        onClick={() => setMobileOpen(false)}
      >
        <span className="opacity-70">
          <FileText className="w-4 h-4" />
        </span>
        <span className="hidden sm:inline">Reports</span>
      </NavLink>

      <NavLink
        to="/cash-flow"
        className={({ isActive }) =>
          `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition ${
            isActive
              ? 'text-(--accent) bg-white/5'
              : 'text-(--muted) hover:bg-white/10 hover:text-white'
          }`
        }
        onClick={() => setMobileOpen(false)}
      >
        <span className="opacity-70">
          <TrendingUp className="w-4 h-4" />
        </span>
        <span className="hidden sm:inline">Cash Flow</span>
      </NavLink>

      <NavLink
        to="/cross-asset-payment"
        className={({ isActive }) =>
          `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition ${
            isActive
              ? 'text-(--accent) bg-white/5'
              : 'text-(--muted) hover:bg-white/10 hover:text-white'
          }`
        }
        onClick={() => setMobileOpen(false)}
      >
        <span className="opacity-70">
          <Globe className="w-4 h-4" />
        </span>
        <span className="hidden sm:inline">Cross-Asset</span>
      </NavLink>

      <NavLink
        to="/transactions"
        className={({ isActive }) =>
          `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition ${
            isActive
              ? 'text-(--accent) bg-white/5'
              : 'text-(--muted) hover:bg-white/10 hover:text-white'
          }`
        }
      >
        <span className="opacity-70">
          <Activity className="w-4 h-4" />
        </span>
        History
      </NavLink>

      <NavLink
        to="/bulk-payments"
        className={({ isActive }) =>
          `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition ${
            isActive
              ? 'text-(--accent) bg-white/5'
              : 'text-(--muted) hover:bg-white/10 hover:text-white'
          }`
        }
        onClick={() => setMobileOpen(false)}
      >
        <span className="opacity-70">
          <BarChart2 className="w-4 h-4" />
        </span>
        <span className="hidden sm:inline">Bulk Payments</span>
      </NavLink>

      <div className="w-px h-5 bg-(--border-hi) mx-2" />
      <NavLink
        to="/admin"
        className={({ isActive }) =>
          `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition ${
            isActive
              ? 'text-red-500 bg-red-500/10'
              : 'text-red-400 hover:bg-red-500/20 hover:text-red-500'
          }`
        }
      >
        <ShieldAlert className="w-4 h-4" />
        Admin
      </NavLink>

      <NavLink
        to="/debug"
        className={({ isActive }) =>
          `flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-mono tracking-wide border transition ${
            isActive
              ? 'text-(--accent2) bg-[rgba(124,111,247,0.06)] border-[rgba(124,111,247,0.25)]'
              : 'text-(--accent2) bg-[rgba(124,111,247,0.06)] border-[rgba(124,111,247,0.25)] hover:bg-[rgba(124,111,247,0.12)]'
          }`
        }
        onClick={() => setMobileOpen(false)}
      >
        <Code className="w-4 h-4" />
        <span className="hidden sm:inline">debugger</span>
      </NavLink>

      <Link
        to="/help"
        onClick={() => setMobileOpen(false)}
        className="text-blue-500 text-xs underline"
      >
        Help
      </Link>
    </>
  );

  return (
    <nav className="relative w-full">
      <div className="flex items-center justify-between gap-4 px-3 py-2">
        {/* Desktop links */}
        <div className="hidden lg:flex items-center gap-4">{navLinks}</div>

        {/* Mobile menu button */}
        <button
          aria-label="Toggle menu"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(!mobileOpen)}
          className="lg:hidden p-3 rounded-md hover:bg-white/5 transition touch-manipulation"
          style={{ minHeight: '44px', minWidth: '44px' }} // Touch-friendly size
        >
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>

        {/* User profile */}
        <div className="ml-auto flex items-center gap-2">
          <div className="p-1 bg-gray-50 rounded-lg flex items-center gap-2">
            <Avatar
              email={currentUser.email}
              name={currentUser.name}
              imageUrl={currentUser.imageUrl}
              size="sm"
            />
            <div className="hidden md:block flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-gray-800 truncate">{currentUser.name}</p>
              <p className="text-[10px] text-gray-500 truncate">{currentUser.email}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {mobileOpen && (
        <>
          {/* Backdrop overlay */}
          <div
            className="lg:hidden fixed inset-0 bg-black/50 z-30"
            onClick={() => setMobileOpen(false)}
          />

          {/* Mobile menu panel */}
          <div className="lg:hidden fixed top-0 right-0 bottom-0 w-80 max-w-[85vw] bg-white shadow-xl z-40 transform transition-transform duration-300 ease-in-out">
            <div className="flex flex-col h-full">
              {/* Mobile menu header */}
              <div className="flex items-center justify-between p-4 border-b">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg grid place-items-center font-extrabold text-black text-sm tracking-tight shadow-[0_0_20px_rgba(74,240,184,0.3)] bg-linear-to-br from-(--accent) to-(--accent2)">
                    P
                  </div>
                  <span className="text-lg font-extrabold tracking-tight">
                    Pay<span className="text-(--accent)">D</span>
                  </span>
                </div>
                <button
                  aria-label="Close menu"
                  onClick={() => setMobileOpen(false)}
                  className="p-2 rounded-md hover:bg-gray-100 transition touch-manipulation"
                  style={{ minHeight: '44px', minWidth: '44px' }}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Mobile menu content */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="flex flex-col gap-2">{navLinks}</div>
              </div>

              {/* Mobile menu footer with user info */}
              <div className="p-4 border-t">
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <Avatar
                    email={currentUser.email}
                    name={currentUser.name}
                    imageUrl={currentUser.imageUrl}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">
                      {currentUser.name}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{currentUser.email}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </nav>
  );
};

export default AppNav;
