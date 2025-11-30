/**
 * Data fetching hook for Loos List with AbortController support
 */

import { useEffect, useRef, useState } from "hono/jsx";
import { buildMetricsParams, buildSearchParams } from "../utils/builders";
import type { FilterMappings, MetricsResponse, ScriptState, SearchResponse } from "../utils/types";

type UseLoosDataParams = {
  state: ScriptState;
  searchEndpoint: string;
  metricsEndpoint: string;
  filterMappings: FilterMappings;
  recentWindowDays: number;
};

type UseLoosDataReturn = {
  searchData: SearchResponse | null;
  metricsData: MetricsResponse | null;
  loading: boolean;
  error: boolean;
  metricsError: string | null;
  refetch: () => void;
};

async function fetchJson<T>(
  path: string,
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(`${path}?${params.toString()}`, { signal });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function useLoosData({
  state,
  searchEndpoint,
  metricsEndpoint,
  filterMappings,
  recentWindowDays,
}: UseLoosDataParams): UseLoosDataReturn {
  const [searchData, setSearchData] = useState<SearchResponse | null>(null);
  const [metricsData, setMetricsData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const refetch = () => {
    setRefetchTrigger((prev) => prev + 1);
  };

  useEffect(() => {
    const loadData = async () => {
      // Cancel any ongoing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setLoading(true);
      setError(false);
      setMetricsError(null);

      try {
        // Load search data first
        const searchParams = buildSearchParams(state, filterMappings);
        const search = await fetchJson<SearchResponse>(
          searchEndpoint,
          searchParams,
          controller.signal,
        );

        if (controller.signal.aborted) {
          return;
        }

        setSearchData(search);

        // Load metrics data
        try {
          const metricsParams = buildMetricsParams(state, filterMappings, recentWindowDays);
          const metrics = await fetchJson<MetricsResponse>(
            metricsEndpoint,
            metricsParams,
            controller.signal,
          );

          if (!controller.signal.aborted) {
            setMetricsData(metrics);
          }
        } catch (metricsErr) {
          if (!controller.signal.aborted) {
            console.error("Failed to load metrics", metricsErr);
            setMetricsError("Unable to load metrics right now. Please try refreshing.");
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("Failed to load loos data", err);
          setError(true);
        }
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        setLoading(false);
      }
    };

    loadData();

    // Cleanup function
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [state, searchEndpoint, metricsEndpoint, refetchTrigger]);

  return {
    searchData,
    metricsData,
    loading,
    error,
    metricsError,
    refetch,
  };
}
