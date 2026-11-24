import type { ReactNode } from "react";

/**
 * A link into the user guide (served at /docs/guide/ by the hub and the viewer). Pages keep their own text to what is
 * needed to read them; the guide holds the full explanation.
 */
export function GuideLink({ to, children = "Guide" }: { to: string; children?: ReactNode }) {
  return (
    <a href={`/docs/guide/${to}`} className="text-accent hover:underline">
      {children}
    </a>
  );
}
