import { NavLink, Route, Routes } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { getJson, type Health } from "./lib/api";
import Placeholder from "./routes/Placeholder";

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/deployments", label: "Deployments" },
  { to: "/matrix", label: "Files" },
  { to: "/register", label: "Register" },
];

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-6 border-b border-line bg-panel px-4 py-3">
        <span className="font-semibold">WHOI-MPG Biologger Portal</span>
        <nav className="flex gap-4 text-sm">
          {NAV.map((n) => (
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
        <ServerStatus />
      </header>
      <main className="flex-1 p-4">
        <Routes>
          <Route path="/" element={<Placeholder title="Overview" note="All deployments on one map (Phase D3)." />} />
          <Route path="/deployments" element={<Placeholder title="Deployments" note="Catalog list (Phase D2)." />} />
          <Route path="/deployments/:id" element={<Placeholder title="Deployment" note="Metadata, files, validation, tracks (Phase D2)." />} />
          <Route path="/matrix" element={<Placeholder title="Files" note="Deployments by file kind (Phase D2)." />} />
          <Route path="/register" element={<Placeholder title="Register" note="Stage, validate and register files (Phase D2)." />} />
          <Route path="*" element={<Placeholder title="Not found" note="No page at this address." />} />
        </Routes>
      </main>
    </div>
  );
}

export function ServerStatus() {
  const { data, isError } = useQuery({ queryKey: ["health"], queryFn: () => getJson<Health>("/api/health") });
  const label = isError ? "server unreachable" : data ? `server ${data.version}` : "connecting";
  const tone = isError ? "text-bad" : data ? "text-ok" : "text-muted";
  return <span className={`ml-auto font-mono text-xs ${tone}`}>{label}</span>;
}
