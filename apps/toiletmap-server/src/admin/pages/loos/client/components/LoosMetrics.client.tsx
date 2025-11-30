/** @jsxImportSource hono/jsx/dom */

import { useState } from "hono/jsx";

/**
 * Metrics panel component with insights cards, features, and areas
 */

import { formatNumber, percentage } from "../utils/formatters";
import type { MetricsResponse } from "../utils/types";
import { LoosAreaList } from "./LoosAreaList.client";
import { LoosFeatureList } from "./LoosFeatureList.client";

type LoosMetricsProps = {
  metrics: MetricsResponse | null;
  totalCount: number;
  searchQuery: string;
  recentWindowDays: number;
  areaColors: string[];
  loading?: boolean;
  error?: string;
};

export function LoosMetrics({
  metrics,
  totalCount,
  searchQuery,
  recentWindowDays,
  areaColors,
  loading,
  error,
}: LoosMetricsProps) {
  if (error) {
    return (
      <div>
        <div data-loos-insights>
          <div class="metric-card metric-card--error">
            <p class="metric-label">Metrics unavailable</p>
            <p class="metric-meta">{error}</p>
          </div>
        </div>
        <div>
          <h3>Features</h3>
          <ul data-loos-feature-list>
            <li class="stat-progress-item">
              <span class="muted-text">{error}</span>
            </li>
          </ul>
        </div>
        <div>
          <h3>Areas</h3>
          <ul data-loos-area-list>
            <li class="stat-list-item">
              <span class="stat-list-label muted-text">{error}</span>
            </li>
          </ul>
        </div>
      </div>
    );
  }

  if (!metrics) {
    return null;
  }

  const searchMeta = searchQuery ? `Matching "${searchQuery}"` : "Full dataset slice";
  const totals = metrics.totals || {};
  const cards = [
    { title: "Filtered records", value: totalCount, meta: searchMeta },
    {
      title: "Active coverage",
      value: totals.active || 0,
      meta: `${percentage(totals.active || 0, totalCount)}% active`,
    },
    {
      title: "Accessibility ready",
      value: totals.accessible || 0,
      meta: `${percentage(totals.accessible || 0, totalCount)}% accessible`,
    },
    {
      title: `Updated last ${recentWindowDays}d`,
      value: totals.recent || 0,
      meta: totals.recent ? "Recently edited" : "Needs attention",
    },
  ];

  const [isCollapsed, setIsCollapsed] = useState(true);

  const toggleStats = () => setIsCollapsed(!isCollapsed);

  return (
    <section class={`stats-panel ${isCollapsed ? "stats-panel--collapsed" : ""}`} data-loos-metrics>
      <div class="stats-panel__header">
        <div class="stats-summary">
          {isCollapsed ? (
            <span>
              {formatNumber(totalCount)} loos • {formatNumber(totals.active || 0)} active •{" "}
              {formatNumber(totals.accessible || 0)} accessible
            </span>
          ) : (
            <span>Dataset Insights</span>
          )}
        </div>

        <button type="button" class="stats-toggle" onClick={toggleStats}>
          {isCollapsed ? (
            <>
              <i class="fa-solid fa-chart-simple" aria-hidden="true" />
              <span>Show insights</span>
            </>
          ) : (
            <>
              <i class="fa-solid fa-chevron-up" aria-hidden="true" />
              <span>Hide insights</span>
            </>
          )}
        </button>
      </div>

      <div class="stats-panel__content">
        <div class="metric-grid" data-loos-insights>
          {cards.map((card) => (
            <div class="metric-card" key={card.title}>
              <p class="metric-label">{card.title}</p>
              <p class="metric-value">{formatNumber(card.value)}</p>
              <p class="metric-meta">{card.meta}</p>
            </div>
          ))}
        </div>
        <div class="stat-sections">
          <div class="stat-section">
            <p class="stat-heading">Feature coverage</p>
            <LoosFeatureList metrics={metrics} totalCount={totalCount} loading={loading} />
          </div>
          <div class="stat-section">
            <p class="stat-heading">Top areas</p>
            <LoosAreaList metrics={metrics} areaColors={areaColors} loading={loading} />
          </div>
        </div>
      </div>
    </section>
  );
}
