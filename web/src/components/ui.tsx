import type { ReactNode } from "react";

export function Panel({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-panel">
      {(title || actions) && (
        <header className="flex items-center gap-3 border-b border-line px-4 py-2">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          <div className="ml-auto flex gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const TONES: Record<string, string> = {
  passed: "border-ok/40 text-ok",
  present: "border-ok/40 text-ok",
  warning: "border-warn/40 text-warn",
  remote: "border-accent/40 text-accent",
  failed: "border-bad/40 text-bad",
  error: "border-bad/40 text-bad",
  missing: "border-line text-muted",
  queued: "border-line text-muted",
  running: "border-accent/40 text-accent",
};

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 font-mono text-xs ${TONES[tone] ?? TONES.missing}`}>
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  kind = "primary",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  kind?: "primary" | "plain";
  type?: "button" | "submit";
}) {
  const style =
    kind === "primary"
      ? "bg-accent text-white hover:opacity-90"
      : "border border-line text-ink hover:border-accent hover:text-accent";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40 ${style}`}
    >
      {children}
    </button>
  );
}

export function Loading({ what }: { what: string }) {
  return <p className="text-sm text-muted">Loading {what}...</p>;
}

export function ErrorNote({ error }: { error: unknown }) {
  return <p className="text-sm text-bad">{error instanceof Error ? error.message : String(error)}</p>;
}
