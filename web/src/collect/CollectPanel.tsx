import { useRef, type ReactNode } from "react";
import { CollectButton, useCollectItem } from "./collect";

/** A panel that can be collected: its "+" beside the title, its element for the image, its text for the prompt. */
export default function CollectPanel({
  id,
  title,
  text,
  actions,
  children,
  kind = "view",
}: {
  id: string;
  title: string;
  text: () => string;
  actions?: ReactNode;
  children: ReactNode;
  kind?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useCollectItem(id, title, text, ref);
  return (
    <section ref={ref} data-collect-item className="rounded-lg border border-line bg-panel">
      <header className="flex items-center gap-2 border-b border-line px-4 py-2">
        <CollectButton id={id} title={title} kind={kind} />
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="ml-auto flex gap-2">{actions}</div>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
