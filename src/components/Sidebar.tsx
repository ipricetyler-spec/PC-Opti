import { BarChart3, Cpu, Gamepad2, History, Radar, Settings, SlidersHorizontal, Usb } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export type AppTab = 'readiness' | 'overview' | 'startup' | 'game-settings' | 'gpu' | 'network-quality' | 'input-devices' | 'performance-lab' | 'drift' | 'workload-profiles';

interface SidebarProps {
  activeTab: AppTab;
  availableTabs: AppTab[];
  onChange: (tab: AppTab) => void;
  profile: 'public' | 'consumer-premium' | 'owner';
}

interface NavItem {
  id: AppTab;
  label: string;
  icon: typeof Radar;
  keywords: string;
  /** Views reached from inside this section. They highlight this section and can be found by search. */
  includes?: Array<{ id: AppTab; keywords: string }>;
}

// Eight sections. Scan details live under Home and the network test under Measure; their
// workspace ids are unchanged so links and saved places keep working.
const navItems: NavItem[] = [
  { id: 'readiness', label: 'Home', icon: Radar, keywords: 'home priorities sessions summary', includes: [{ id: 'overview', keywords: 'scan hardware inventory storage apps security' }] },
  { id: 'startup', label: 'Tweaks', icon: SlidersHorizontal, keywords: 'tweaks optimize bios boot timing bcd startup processes maintenance policies power plan game session shader cache' },
  { id: 'game-settings', label: 'Games', icon: Gamepad2, keywords: 'games display backups refresh rate' },
  { id: 'gpu', label: 'GPU', icon: Cpu, keywords: 'gpu graphics card scheduling hags mpo overlay flicker per program preference' },
  { id: 'performance-lab', label: 'Measure', icon: BarChart3, keywords: 'measure benchmark captures presentmon sessions', includes: [{ id: 'network-quality', keywords: 'network internet latency jitter wifi signal connection' }] },
  { id: 'input-devices', label: 'Input devices', icon: Usb, keywords: 'input controller mouse keyboard usb polling hidusbf' },
  { id: 'drift', label: 'Restore', icon: History, keywords: 'restore undo verify audit history recovery changes' },
  { id: 'workload-profiles', label: 'Settings', icon: Settings, keywords: 'settings themes appearance support data' },
];

/** The section a workspace belongs to, for highlighting. */
export function sectionFor(tab: AppTab): AppTab {
  return navItems.find((item) => item.id === tab || item.includes?.some((view) => view.id === tab))?.id ?? tab;
}

/** Where a search should land: a section, or the view inside it that matched. */
function searchTarget(item: NavItem, query: string): AppTab | null {
  if (!query) return item.id;
  if (`${item.label} ${item.keywords}`.toLowerCase().includes(query)) return item.id;
  return item.includes?.find((view) => view.keywords.includes(query))?.id ?? null;
}

export function Sidebar({ activeTab, availableTabs, onChange, profile }: SidebarProps) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const matches = navItems
    .filter((item) => availableTabs.includes(item.id))
    .map((item) => ({ item, target: searchTarget(item, needle) }))
    .filter((match): match is { item: NavItem; target: AppTab } => match.target !== null && availableTabs.includes(match.target));
  const activeSection = sectionFor(activeTab);
  const navRef = useRef<HTMLElement>(null);
  const [overflowEdges, setOverflowEdges] = useState({ left: false, right: false });
  const updateOverflowEdges = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const next = {
      left: nav.scrollLeft > 1,
      right: nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1,
    };
    setOverflowEdges((current) => current.left === next.left && current.right === next.right ? current : next);
  }, []);

  useEffect(() => {
    updateOverflowEdges();
    window.addEventListener('resize', updateOverflowEdges);
    return () => window.removeEventListener('resize', updateOverflowEdges);
  }, [availableTabs, query, updateOverflowEdges]);

  const go = (tab: AppTab) => { onChange(tab); setQuery(''); };

  return (
    <aside className="app-sidebar w-full border-b border-slate-800 lg:min-h-screen lg:w-60 lg:border-b-0 lg:border-r">
      <div className="px-5 pb-4 pt-6">
        <h1 className="wordmark" aria-label="Dialed">dialed<span aria-hidden="true">.</span></h1>
        <p className="mt-1.5 text-[11px] uppercase tracking-wider text-slate-500">
          {profile === 'owner' ? 'Owner tools' : 'PC tuning, explained'}
        </p>
      </div>
      <div className="px-3 pb-3">
        <label className="sr-only" htmlFor="workspace-search">Find a section</label>
        <input id="workspace-search" type="search" maxLength={80} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery(''); if (event.key === 'Enter' && matches.length === 1) go(matches[0].target); }} placeholder="Search: controller, backups…" className="w-full min-w-0 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200" />
        {query.trim() && <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-400"><span role="status">{matches.length} matching section{matches.length === 1 ? '' : 's'}</span><button type="button" onClick={() => setQuery('')} className="rounded border border-slate-700 px-2 py-1">Clear search</button></div>}
      </div>
      <div className="relative">
        <nav ref={navRef} onScroll={updateOverflowEdges} aria-label="Primary navigation" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:space-y-0.5">
          {matches.map(({ item, target }) => {
            const Icon = item.icon;
            const selected = item.id === activeSection;
            const number = String(navItems.indexOf(item) + 1).padStart(2, '0');
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(target)}
                aria-current={selected ? 'page' : undefined}
                className={`nav-item group flex shrink-0 items-center gap-3 rounded-md px-3 py-2 text-sm lg:w-full ${selected ? 'nav-item-selected font-semibold' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <span className="font-mono text-[11px] text-slate-500" aria-hidden="true">{number}</span>
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
        {overflowEdges.left ? <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-black/70 to-transparent lg:hidden" /> : null}
        {overflowEdges.right ? <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-black/70 to-transparent lg:hidden" /> : null}
      </div>
      <div className="hidden px-5 py-4 text-xs leading-relaxed text-slate-500 lg:block">
        Every change is explained, checked before it runs, and can be undone from Restore. No driver updaters, registry cleaners, RAM boosters or made-up FPS numbers.
      </div>
    </aside>
  );
}
