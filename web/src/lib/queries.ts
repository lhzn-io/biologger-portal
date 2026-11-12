import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";
import type { DeploymentDetail, DeploymentSummary, Matrix, Me, TrackRow, ValidationRun } from "./types";

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => getJson<Me>("/api/me") });

export const useDeployments = () =>
  useQuery({ queryKey: ["deployments"], queryFn: () => getJson<DeploymentSummary[]>("/api/deployments") });

export const useDeployment = (id: string) =>
  useQuery({
    queryKey: ["deployment", id],
    queryFn: () => getJson<DeploymentDetail>(`/api/deployments/${encodeURIComponent(id)}`),
  });

export const useMatrix = () => useQuery({ queryKey: ["matrix"], queryFn: () => getJson<Matrix>("/api/matrix") });

export const useTracks = () => useQuery({ queryKey: ["tracks"], queryFn: () => getJson<TrackRow[]>("/api/tracks") });

/** A validation run, polled every 2 s while it is queued or running. */
export const useValidationRun = (id: number | null) =>
  useQuery({
    queryKey: ["validation", id],
    queryFn: () => getJson<ValidationRun>(`/api/validation/${id}`),
    enabled: id != null,
    refetchInterval: (q) => (q.state.data && ["queued", "running"].includes(q.state.data.status) ? 2000 : false),
  });
