import { useEffect, useRef, useState, type RefObject } from "react";
import { mountCollect } from "@lhzn-io/collect";
import "@lhzn-io/collect/collect.css";
import { buildPrompt } from "./prompt";
import { elementFor, promptSettings, register, titleFor } from "./registry";

const SUGGEST_TO = import.meta.env.VITE_SUGGEST_MAILTO as string | undefined;
let mounted = false;

/** Mounts the tray once for the app. The prompt and image come from whatever the current page registered. */
export function useCollectTray(): void {
  useEffect(() => {
    if (mounted) return;
    mounted = true;
    mountCollect(
      {
        elementFor,
        prompt: (ids, question) => buildPrompt(ids, question),
        titleFor,
        linkFor: () => location.href,
        header: () => `WHOI-MPG biologger portal, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
        credit: "Tracks: biologger-sim. Topobathymetry: GEBCO 2025, GMRT, NOAA BlueTopo, NCEI BAG via topobathykit.",
        mailTo: SUGGEST_TO || undefined,
        pageName: "WHOI-MPG biologger portal",
      },
      {
        itemSelector: "[data-collect-item]",
        fileName: "biologger-portal",
        skip: ".maplibregl-control-container, .collect-btn, button, input, select",
        buttonClass: "ct-main",
        quietClass: "ct-quiet",
        labels: {
          hint: "Collected views gather here. Then copy the image and the prompt into the assistant you use.",
          question: "What stands out in these, and what would you check next?",
          askNote:
            "Paste the image and the prompt into the assistant you already use. The prompt carries these unpublished " +
            "lab data to that assistant; the portal sends nothing itself. With nothing collected, the prompt covers the page.",
        },
      },
    );
  }, []);
}

/** The "+" beside an item; the tray's own click handler collects it. */
export function CollectButton({ id, title, kind = "view" }: { id: string; title: string; kind?: string }) {
  return (
    <button type="button" className="collect-btn" data-collect={id} data-title={title} data-kind={kind} aria-label={`Collect ${title}`}>
      +
    </button>
  );
}

/** Registers an item while the component is mounted. `text` is read when the prompt is built, so it sees the latest props. */
export function useCollectItem(id: string, title: string, text: () => string, element: RefObject<HTMLElement | null>): void {
  const latest = useRef(text);
  useEffect(() => {
    latest.current = text;
  });
  useEffect(
    () => register(id, { title, text: () => latest.current(), element: () => element.current }),
    [id, title, element],
  );
}

/** The header's "Collect" button and the toggle for people's names in prompts. */
export function CollectControls() {
  const [people, setPeople] = useState(promptSettings.includePeople);
  return (
    <span className="flex items-center gap-3 text-xs text-muted">
      <label className="flex items-center gap-1" title="Deployment and recovery team names stay out of prompts unless included">
        <input
          type="checkbox"
          checked={people}
          onChange={(e) => {
            promptSettings.includePeople = e.target.checked;
            setPeople(e.target.checked);
          }}
        />
        names in prompts
      </label>
      <button className="collect-open" id="collect-open" type="button" aria-controls="collect-tray" aria-expanded="false">
        Collect<span id="collect-count" />
      </button>
    </span>
  );
}
