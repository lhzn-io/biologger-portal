import { lazy, Suspense } from "react";
import { NavLink, Route, Routes } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { getJson, type Health } from "./lib/api";
import { CollectControls, useCollectTray } from "./collect/collect";
import { isPublished, type SnapshotInfo } from "./lib/mode";
import { useMe } from "./lib/queries";
import DeploymentPage from "./routes/DeploymentPage";
import Deployments from "./routes/Deployments";
import Matrix from "./routes/Matrix";
import Overview from "./routes/Overview";
import Placeholder from "./routes/Placeholder";
import Register from "./routes/Register";
import Runs from "./routes/Runs";
import Visitors from "./routes/Visitors";
import { useVisitLog } from "./lib/visits";

// The viewer pulls in three.js and MapLibre; load it only when a track is opened.
const TrackPage = lazy(() => import("./routes/TrackPage"));
const ComparePage = lazy(() => import("./routes/ComparePage"));

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/deployments", label: "Deployments" },
  { to: "/matrix", label: "Files" },
  { to: "/register", label: "Register", hub: true, editor: true },
  { to: "/runs", label: "Runs", hub: true, editor: true },
  { to: "/visitors", label: "Visitors", hub: true, editor: true },
];

export default function App() {
  useCollectTray();
  useVisitLog();
  const published = isPublished();
  const editor = useMe().data?.editor ?? false;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-6 border-b border-line bg-panel px-4 py-3">
        <span className="font-semibold">WHOI-MPG Biologger Portal</span>
        <nav className="flex gap-4 text-sm">
          {NAV.filter((n) => !(published && n.hub) && !(n.editor && !editor)).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) => (isActive ? "text-accent" : "text-muted hover:text-ink")}
            >
              {n.label}
            </NavLink>
          ))}
          <a href="/docs/sim/" className="text-muted hover:text-ink" title="biologger-sim documentation: tracks, currents and the pipeline">
            Sim docs
          </a>
          <a href="/docs/guide/" className="text-muted hover:text-ink" title="The portal's user guide">
            Guide
          </a>
        </nav>
        <span className="ml-auto flex items-center gap-4">
          <CollectControls />
          {published ? <SnapshotStatus /> : <WhoAmI />}
          {!published && <ServerStatus />}
        </span>
      </header>
      <main className="flex-1 p-4">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/deployments" element={<Deployments />} />
          <Route path="/deployments/:id" element={<DeploymentPage />} />
          <Route
            path="/deployments/:id/track/:run"
            element={
              <Suspense fallback={<p className="text-sm text-muted">Loading the viewer...</p>}>
                <TrackPage />
              </Suspense>
            }
          />
          <Route
            path="/deployments/:id/compare"
            element={
              <Suspense fallback={<p className="text-sm text-muted">Loading the viewer...</p>}>
                <ComparePage />
              </Suspense>
            }
          />
          <Route path="/matrix" element={<Matrix />} />
          <Route
            path="/register"
            element={
              published ? (
                <Placeholder title="Register" note="Registration, validation and metadata edits happen on the hub, on the lab VPN." />
              ) : (
                <Register />
              )
            }
          />
          <Route
            path="/runs"
            element={published || !editor ? <Placeholder title="Not found" note="No page at this address." /> : <Runs />}
          />
          <Route
            path="/visitors"
            element={
              published || !editor ? <Placeholder title="Not found" note="No page at this address." /> : <Visitors />
            }
          />
          <Route path="*" element={<Placeholder title="Not found" note="No page at this address." />} />
        </Routes>
      </main>
      {published && (
        <footer className="border-t border-line px-4 py-2 text-xs text-muted">
          Page views and a few actions (play, copy) are recorded with your sign-in email for the portal maintainers and
          deleted after 180 days.
        </footer>
      )}
    </div>
  );
}

function WhoAmI() {
  const me = useMe().data;
  if (!me) return null;
  if (!me.editor && me.signin_url) {
    return (
      <span className="text-xs text-muted">
        read only.{" "}
        <a className="text-accent hover:underline" href={me.signin_url}>
          Editor sign-in
        </a>
      </span>
    );
  }
  return (
    <span className="text-xs text-muted">
      {me.email}
      {me.editor ? " (editor)" : " (read only)"}
    </span>
  );
}

/** Published viewer: when the snapshot was taken (data/v1/snapshot.json, which /api/health resolves to). */
function SnapshotStatus() {
  const { data, isError } = useQuery({ queryKey: ["health"], queryFn: () => getJson<SnapshotInfo>("/api/health") });
  if (isError) return <span className="font-mono text-xs text-bad">snapshot unavailable</span>;
  if (!data) return null;
  return (
    <span className="font-mono text-xs text-muted" title={`content ${data.content_sha256.slice(0, 12)}, portal ${data.portal_version}`}>
      snapshot {data.published_utc.slice(0, 16).replace("T", " ")} UTC
    </span>
  );
}

function ServerStatus() {
  const { data, isError } = useQuery({ queryKey: ["health"], queryFn: () => getJson<Health>("/api/health") });
  const label = isError ? "server unreachable" : data ? `server ${data.version}` : "connecting";
  const tone = isError ? "text-bad" : data ? "text-ok" : "text-muted";
  return <span className={`font-mono text-xs ${tone}`}>{label}</span>;
}
