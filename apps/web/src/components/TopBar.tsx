/**
 * Top bar: the Σtesiα wordmark (text, not an image — the final α in accent is
 * the page's signature element). `children` renders on the right (status pills).
 */
export function TopBar({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return (
    <header className="border-b border-border bg-bg">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
        <a
          href="https://etesiar.com"
          className="text-2xl font-bold tracking-tight text-ink"
          aria-label="Etesia — back to etesiar.com"
        >
          Σtesi<span className="text-accent">α</span>
        </a>
        {children}
      </div>
    </header>
  );
}
