/** @jsxImportSource hono/jsx/dom */

/**
 * Area breakdown list component with colored dots
 */

import type { MetricsResponse } from '../utils/types';
import { formatNumber } from '../utils/formatters';

type LoosAreaListProps = {
    metrics: MetricsResponse;
    areaColors: string[];
    loading?: boolean;
};

export function LoosAreaList({ metrics, areaColors, loading }: LoosAreaListProps) {
    if (loading) {
        return (
            <div data-loos-areas-loading>
                <p>Loading areas...</p>
            </div>
        );
    }

    const areas = Array.isArray(metrics.areas) ? metrics.areas : [];

    if (areas.length === 0) {
        return (
            <ul data-loos-area-list>
                <li class="stat-list-item">
                    <span class="stat-list-label muted-text">No areas match the current filters.</span>
                </li>
            </ul>
        );
    }

    return (
        <ul class="stat-list" data-loos-area-list>
            {areas.map((area, index) => {
                const color = areaColors[index % areaColors.length] || '#0a165e';
                return (
                    <li class="stat-list-item" key={area.name || index}>
                        <span class="stat-list-label">
                            <span class="status-dot" style={`background: ${color};`}></span>
                            {area.name || 'Unnamed area'}
                        </span>
                        <strong>{formatNumber(area.count || 0)}</strong>
                    </li>
                );
            })}
        </ul>
    );
}
