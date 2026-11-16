import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "../lib/api";
import { Button, ErrorNote, Loading, Panel } from "../components/ui";

interface Person {
  email: string;
  first_seen: string;
  last_seen: string;
  pages: number;
  tracks: string[];
  actions: Record<string, number>;
}
interface VisitRow {
  id: number;
  at_utc: string;
  email: string;
  country: string;
  kind: "page" | "action";
  path: string;
  action: string;
  detail: Record<string, string | number | boolean>;
}
interface Visits {
  configured: boolean;
  days: number;
  last_pull_utc: string | null;
  people: Person[];
  recent: VisitRow[];
}
interface PullResult {
  fetched: number;
  purged: number;
}

const DAYS = [7, 30, 90, 180];

/** Who has used the live viewer (whoi-mpg.lhzn.io): its visit log, mirrored from the Worker. Hub only. */
export default function Visitors() {
  const [days, setDays] = useState(30);
  const client = useQueryClient();
  const visits = useQuery({ queryKey: ["visits", days], queryFn: () => getJson<Visits>(`/api/visits?days=${days}`) });
  const [pull, setPull] = useState<{ busy: boolean; note: string }>({ busy: false, note: "" });
  const refresh = async () => {
    setPull({ busy: true, note: "" });
    try {
      const r = await sendJson<PullResult>("/api/visits/refresh", "POST", {});
      setPull({ busy: false, note: `${r.fetched} new` });
      await client.invalidateQueries({ queryKey: ["visits"] });
    } catch (e) {
      setPull({ busy: false, note: e instanceof Error ? e.message : String(e) });
    }
  };

  if (visits.isLoading) return <Loading what="the visit log" />;
  if (visits.error || !visits.data) return <ErrorNote error={visits.error} />;
  const v = visits.data;
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="text-xl">Visitors to the live viewer</h1>
        <span className="text-sm text-muted">
          whoi-mpg.lhzn.io, signed in through Cloudflare Access. Pages and a few actions, kept 180 days.
          {v.last_pull_utc ? ` Last pulled ${v.last_pull_utc.replace("T", " ").replace("Z", " UTC")}.` : " Not pulled yet."}
        </span>
        <span className="ml-auto flex items-center gap-2 text-sm">
          <label className="flex items-center gap-1 text-muted">
            Last
            <select className="rounded border border-line bg-surface px-1" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
          <Button kind="plain" onClick={() => void refresh()} disabled={pull.busy || !v.configured}>
            {pull.busy ? "Pulling..." : "Refresh"}
          </Button>
          {pull.note && <span className="text-xs text-muted">{pull.note}</span>}
        </span>
      </header>
      {!v.configured && (
        <p className="text-sm text-bad">
          Not configured: the hub needs PORTAL_CF_ACCESS_CLIENT_ID and PORTAL_CF_ACCESS_CLIENT_SECRET (an Access service token
          for whoi-mpg.lhzn.io/api/admin/*) in deploy/portal.env.
        </p>
      )}

      <Panel title={`People (${v.people.length})`}>
        {v.people.length === 0 ? (
          <p className="text-sm text-muted">No visits in the last {v.days} days.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 pr-4 font-normal">Email</th>
                <th className="py-1 pr-4 font-normal">Last seen (UTC)</th>
                <th className="py-1 pr-4 font-normal">First seen</th>
                <th className="py-1 pr-4 font-normal">Pages</th>
                <th className="py-1 pr-4 font-normal">Tracks opened</th>
                <th className="py-1 font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              {v.people.map((p) => (
                <tr key={p.email} className="border-t border-line align-top">
                  <td className="py-1 pr-4 font-mono">{p.email}</td>
                  <td className="py-1 pr-4 font-mono text-xs">{when(p.last_seen)}</td>
                  <td className="py-1 pr-4 font-mono text-xs">{when(p.first_seen)}</td>
                  <td className="py-1 pr-4">{p.pages}</td>
                  <td className="py-1 pr-4 font-mono text-xs">{p.tracks.length ? p.tracks.join(", ") : "--"}</td>
                  <td className="py-1 text-xs">
                    {Object.entries(p.actions)
                      .map(([a, n]) => `${a.replace(/_/g, " ")} ${n}`)
                      .join(", ") || "--"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Recent activity">
        {v.recent.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="space-y-0.5 font-mono text-xs">
            {v.recent.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-3">
                <span className="text-muted">{when(r.at_utc)}</span>
                <span>{r.email}</span>
                {r.country && <span className="text-muted">{r.country}</span>}
                <span>{r.kind === "page" ? "opened" : r.action.replace(/_/g, " ")}</span>
                {Object.keys(r.detail).length > 0 && <span className="text-muted">{Object.entries(r.detail).map(([k, x]) => `${k}=${x}`).join(" ")}</span>}
                <Link to={r.path} className="truncate text-accent hover:underline" title="Open the same view on the hub">
                  {r.path}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function when(iso: string): string {
  return iso.replace("T", " ").replace("Z", "");
}
