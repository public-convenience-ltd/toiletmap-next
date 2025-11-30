/** @jsxImportSource hono/jsx/dom */

/**
 * Feature coverage progress bars component
 */

import { formatNumber, percentage } from "../utils/formatters";
import type { MetricsResponse } from "../utils/types";

type LoosFeatureListProps = {
  metrics: MetricsResponse;
  totalCount: number;
  loading?: boolean;
};

export function LoosFeatureList({ metrics, totalCount, loading }: LoosFeatureListProps) {
  if (loading) {
    return (
      <div data-loos-features-loading>
        <p>Loading features...</p>
      </div>
    );
  }

  const totals = metrics.totals || {};
  const stats = [
    { label: "Baby changing", value: totals.babyChange || 0 },
    { label: "RADAR key", value: totals.radar || 0 },
    { label: "Free to use", value: totals.freeAccess || 0 },
    { label: "Verified", value: totals.verified || 0 },
  ];

  return (
    <ul class="stat-progress-list" data-loos-feature-list>
      {stats.map((stat) => {
        const pct = percentage(stat.value, totalCount);
        return (
          <li class="stat-progress-item" key={stat.label}>
            <div class="stat-progress">
              <span>{stat.label}</span>
              <span>{formatNumber(stat.value)}</span>
            </div>
            <div class="stat-progress-bar">
              <div class="stat-progress-bar__fill" style={`width: ${pct}%`} />
            </div>
            <span class="stat-progress-meta">{pct}% of filtered set</span>
          </li>
        );
      })}
    </ul>
  );
}
