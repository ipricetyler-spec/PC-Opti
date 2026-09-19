import type { KeyboardEvent, ReactNode } from 'react';

export interface TabRowItem<T extends string> {
  id: T;
  label: ReactNode;
}

interface TabRowProps<T extends string> {
  ariaLabel: string;
  items: readonly TabRowItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  buttonClassName?: (selected: boolean) => string;
}

// Underlined tabs: the selected one carries the accent, the rest stay quiet.
const defaultButtonClass = (selected: boolean) => `tab-item border-b-2 px-1 pb-2 pt-1 text-sm font-semibold ${selected
  ? 'tab-item-selected text-white'
  : 'border-transparent text-slate-400 hover:text-slate-200'}`;

const tabKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
export function TabPanel({ ariaLabel, value, children }: { ariaLabel: string; value: string; children: ReactNode }) {
  return <div role="tabpanel" id={`${tabKey(ariaLabel)}-panel`} aria-labelledby={`${tabKey(ariaLabel)}-${value}-tab`} tabIndex={0}>{children}</div>;
}

export function TabRow<T extends string>({ ariaLabel, items, value, onChange, className = 'flex flex-wrap gap-2', buttonClassName = defaultButtonClass }: TabRowProps<T>) {
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else return;

    event.preventDefault();
    const next = items[nextIndex];
    onChange(next.id);
    const tabList = event.currentTarget.parentElement;
    requestAnimationFrame(() => tabList?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus());
  };

  return <div role="tablist" aria-label={ariaLabel} className={className}>
    {items.map((item, index) => {
      const selected = item.id === value;
      return <button
        key={item.id}
        type="button"
        role="tab"
        id={`${tabKey(ariaLabel)}-${item.id}-tab`}
        aria-controls={`${tabKey(ariaLabel)}-panel`}
        aria-selected={selected}
        tabIndex={selected ? 0 : -1}
        onClick={() => onChange(item.id)}
        onKeyDown={(event) => moveFocus(event, index)}
        className={buttonClassName(selected)}
      >{item.label}</button>;
    })}
  </div>;
}
