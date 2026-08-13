import { ClipboardCheck, History, LayoutDashboard, Leaf, ListChecks, ShieldCheck } from 'lucide-react';

interface SidebarProps {
  activeTab: 'overview' | 'startup' | 'balancer' | 'policies' | 'maintenance' | 'history';
  onChange: (tab: 'overview' | 'startup' | 'balancer' | 'policies' | 'maintenance' | 'history') => void;
}

const navItems = [
  { id: 'overview' as const, label: 'System diagnostic', icon: LayoutDashboard },
  { id: 'startup' as const, label: 'Startup Center', icon: ListChecks },
  { id: 'balancer' as const, label: 'Dynamic Eco-Balance', icon: Leaf },
  { id: 'policies' as const, label: 'Safe OS policies', icon: ShieldCheck },
  { id: 'maintenance' as const, label: 'Maintenance queue', icon: ClipboardCheck },
  { id: 'history' as const, label: 'Local audit history', icon: History },
];

export function Sidebar({ activeTab, onChange }: SidebarProps) {
  return (
    <aside className="w-full border-b border-slate-800 bg-[#111318] lg:min-h-screen lg:w-64 lg:border-b-0 lg:border-r">
      <div className="p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-400 font-black text-slate-950">P</div>
          <div>
            <h1 className="font-bold tracking-tight text-white">PC-Opti</h1>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Transparent diagnostics</p>
          </div>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const selected = item.id === activeTab;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition lg:w-full ${
                selected ? 'bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-400/20' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="hidden px-5 py-4 text-xs leading-relaxed text-slate-500 lg:block">
        No driver updates, registry sweepers, pagefile changes, RAM cleaners, or simulated results.
      </div>
    </aside>
  );
}
