import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Wallet,
  History,
  Settings,
  HelpCircle,
  FileText,
  Globe,
  ShieldAlert,
  Layout,
  TrendingUp,
  Receipt,
} from 'lucide-react';

interface NavItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  path: string;
}

const navItems: NavItem[] = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
  { icon: Wallet, label: 'Payroll', path: '/payroll' },
  { icon: Users, label: 'Employees', path: '/employee' },
  { icon: TrendingUp, label: 'Forecast', path: '/forecast' },
  { icon: FileText, label: 'Reports', path: '/reports' },
  { icon: Receipt, label: 'Tax Compliance', path: '/tax-compliance' },
  { icon: Globe, label: 'Cross-Asset', path: '/cross-asset-payment' },
  { icon: History, label: 'History', path: '/transactions' },
  { icon: Layout, label: 'Employee Portal', path: '/portal' },
  { icon: ShieldAlert, label: 'Security Center', path: '/admin' },
  { icon: Settings, label: 'Settings', path: '/settings' },
];

interface DashboardSidebarProps {
  onClose?: () => void;
}

export const DashboardSidebar: React.FC<DashboardSidebarProps> = ({
  onClose,
}: DashboardSidebarProps) => {
  return (
    <aside className="h-full w-64 border-r border-(--border) bg-(--surface) flex flex-col">
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg grid place-items-center font-extrabold text-black text-sm tracking-tight shadow-[0_0_20px_rgba(74,240,184,0.3)] bg-linear-to-br from-(--accent) to-(--accent2)">
          P
        </div>
        <span className="text-xl font-extrabold tracking-tight">
          Pay<span className="text-(--accent)">D</span>
        </span>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onClose}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
                isActive
                  ? 'bg-(--accent)/10 text-(--accent)'
                  : 'text-(--muted) hover:bg-white/5 hover:text-(--text)'
              }`
            }
          >
            <item.icon className="w-5 h-5" />
            <span className="font-medium text-sm">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="p-4 mt-auto">
        <NavLink
          to="/help"
          onClick={onClose}
          className={({ isActive }) =>
            `flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
              isActive
                ? 'bg-white/5 text-(--text)'
                : 'text-(--muted) hover:bg-white/5 hover:text-(--text)'
            }`
          }
        >
          <HelpCircle className="w-5 h-5" />
          <span className="font-medium text-sm">Help Center</span>
        </NavLink>

        <div className="mt-4 p-4 border border-(--border) rounded-2xl bg-white/5">
          <p className="text-[10px] text-(--muted) uppercase font-bold tracking-widest mb-2">
            Network
          </p>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-(--accent) animate-pulse shadow-[0_0_8px_var(--accent)]" />
            <span className="text-xs font-mono font-medium">Stellar Testnet</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
