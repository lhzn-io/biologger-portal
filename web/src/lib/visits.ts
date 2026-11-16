/**
 * The published viewer's visit log: each page opened and a few actions go to the Worker (deploy/cloudflare/worker),
 * which records them with the visitor's Cloudflare Access email for the maintainers (shown in the hub's Visitors
 * page; deleted after 180 days). The hub itself logs nothing.
 */
import { useEffect } from "react";
import { useLocation } from "react-router";
import { isPublished } from "./mode";

/** The actions the Worker accepts (worker/visits.ts ACTIONS). */
export type VisitAction =
  | "play"
  | "camera"
  | "speed"
  | "track_color"
  | "chart_pick"
  | "studio"
  | "fullscreen"
  | "collect_add"
  | "collect_copy_image"
  | "collect_copy_prompt"
  | "collect_download"
  | "collect_mail";

export type VisitDetail = Record<string, string | number | boolean>;

/** A page is logged once the route has been still this long, so the view's own URL parameters are in it. */
export const PAGE_SETTLE_MS = 2000;
const REPEAT_MS = 2000;
let last = { body: "", at: 0 };

const here = () => (location.pathname + location.search).slice(0, 512);

/** Send one event; false when not sent (the hub, no beacon support, or the same event within 2 s). */
export function logVisit(kind: "page" | "action", action?: VisitAction, detail?: VisitDetail, path: string = here()): boolean {
  if (!isPublished() || typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return false;
  const body = JSON.stringify({ kind, path, ...(action ? { action } : {}), ...(detail ? { detail } : {}) });
  const now = Date.now();
  if (body === last.body && now - last.at < REPEAT_MS) return false;
  last = { body, at: now };
  return navigator.sendBeacon("/api/visit", new Blob([body], { type: "application/json" }));
}

/** Test hook: forget the last event. */
export function resetVisitLog(): void {
  last = { body: "", at: 0 };
}

const TRAY_ACTIONS: Record<string, VisitAction> = {
  "copy-image": "collect_copy_image",
  "copy-prompt": "collect_copy_prompt",
  download: "collect_download",
  mail: "collect_mail",
};

/**
 * Logs each page opened (after it settles) and the Collect tray's "+", copy, download and mail buttons, read from
 * clicks so the tray package needs no hooks. Mount once, in the published app.
 */
export function useVisitLog(): void {
  const { pathname } = useLocation();
  const published = isPublished();
  useEffect(() => {
    if (!published) return;
    const id = setTimeout(() => logVisit("page"), PAGE_SETTLE_MS);
    return () => clearTimeout(id);
  }, [pathname, published]);
  useEffect(() => {
    if (!published) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      const plus = t?.closest<HTMLElement>("[data-collect]");
      if (plus) {
        logVisit("action", "collect_add", { item: (plus.dataset.kind ?? "view").slice(0, 32) });
        return;
      }
      const act = t?.closest<HTMLElement>("[data-act]")?.dataset.act;
      if (act && TRAY_ACTIONS[act]) logVisit("action", TRAY_ACTIONS[act]);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [published]);
}
