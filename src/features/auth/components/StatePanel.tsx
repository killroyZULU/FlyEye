import type { ReactNode } from 'react';

type StatePanelProps = {
  eyebrow: string;
  title: string;
  children: ReactNode;
  tone?: 'neutral' | 'warning' | 'success';
};

export function StatePanel({ eyebrow, title, children, tone = 'neutral' }: StatePanelProps) {
  return (
    <section className={`state-panel state-panel--${tone}`} aria-live="polite">
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
