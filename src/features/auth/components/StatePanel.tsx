import type { ReactNode, Ref } from 'react';

type StatePanelProps = {
  eyebrow: string;
  title: string;
  children: ReactNode;
  tone?: 'neutral' | 'warning' | 'success';
  headingRef?: Ref<HTMLHeadingElement>;
};

export function StatePanel({
  eyebrow,
  title,
  children,
  tone = 'neutral',
  headingRef,
}: StatePanelProps) {
  return (
    <section className={`state-panel state-panel--${tone}`} aria-live="polite">
      <span className="eyebrow">{eyebrow}</span>
      <h2 ref={headingRef} tabIndex={headingRef ? -1 : undefined}>
        {title}
      </h2>
      {children}
    </section>
  );
}
