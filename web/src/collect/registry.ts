/** What can be collected on the current page, and the text each item gives the prompt.
 *
 * The tray (@lhzn-io/collect) is mounted once for the whole app, but items belong to pages. Pages register
 * their items while they are on screen; when a page unmounts, its items' last text is kept, so an item
 * collected on one page still reaches the prompt after moving to another (its image cannot, since its
 * element is gone, which is how lhzn-blue treats items not on screen).
 */

export interface CollectItem {
  title: string;
  /** The numbers as text: built from the same values the page renders. */
  text: () => string;
  /** The element the image paints, or null when it is not on screen. */
  element: () => HTMLElement | null;
}

const live = new Map<string, CollectItem>();
const kept = new Map<string, { title: string; text: string }>();

/** Prompt settings the header toggles; the people who deployed or recovered a tag stay out unless included. */
export const promptSettings = { includePeople: false };

export function register(id: string, item: CollectItem): () => void {
  live.set(id, item);
  return () => {
    if (live.get(id) === item) {
      try {
        kept.set(id, { title: item.title, text: item.text() });
      } catch {
        // the page's data is already gone; keep nothing
      }
      live.delete(id);
    }
  };
}

export function itemText(id: string): { title: string; text: string } | null {
  const item = live.get(id);
  if (item) return { title: item.title, text: item.text() };
  return kept.get(id) ?? null;
}

export const liveIds = (): string[] => [...live.keys()];
export const elementFor = (id: string): HTMLElement | null => live.get(id)?.element() ?? null;
export const titleFor = (id: string, stored: string): string => live.get(id)?.title ?? kept.get(id)?.title ?? stored;

/** For tests. */
export function clearRegistry(): void {
  live.clear();
  kept.clear();
}
