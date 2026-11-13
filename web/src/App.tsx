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

// The viewer pulls in three.js and MapLibre; load it only when a track is opened.
const TrackPage = lazy(() => import("./routes/TrackPage"));

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/deployments", label: "Deployments" },
  { to: "/matrix", label: "Files" },
  { to: "/register", label: "Register", hub: true },
];

export default function App() {
  useCollectTray();
  const published = isPublished();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-6 border-b border-line bg-panel px-4 py-3">
        <span className="font-semibold">WHOI-MPG Biologger Portal</span>
        <nav className="flex gap-4 text-sm">
          {NAV.filter((n) => !(published && n.hub)).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) => (isActive ? "text-accent" : "text-muted hover:text-ink")}
            >
              {n.label}
            </NavLink>
          ))}
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
          <Route path="*" element={<Placeholder title="Not found" note="No page at this address." />} />
        </Routes>
      </main>
    </div>
  );
}

function WhoAmI() {
  const me = useMe().data;
  if (!me) return null;
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

export function ServerStatus() {
  const { data, isError } = useQuery({ queryKey: ["health"], queryFn: () => getJson<Health>("/api/health") });
  const label = isError ? "server unreachable" : data ? `server ${data.version}` : "connecting";
  const tone = isError ? "text-bad" : data ? "text-ok" : "text-muted";
  return <span className={`font-mono text-xs ${tone}`}>{label}</span>;
}
