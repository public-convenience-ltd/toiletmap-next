/** @jsxImportSource hono/jsx/dom */

/**
 * Loos table component with row rendering
 */

import {
  formatDate,
  formatNumber,
  getAccessLabel,
  getCostLabel,
  getFacilitiesLabel,
  getOpeningLabel,
  getStatusInfo,
  getVerificationLabel,
} from "../utils/formatters";
import type { SearchResponse } from "../utils/types";
import { LoosTableStates } from "./LoosTableStates.client";

type LoosTableProps = {
  searchData: SearchResponse | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
};

function LoosTableRow({ row }: { row: Record<string, unknown> }) {
  const name = typeof row.name === "string" && row.name ? row.name : "Unnamed location";
  const area =
    Array.isArray(row.area) && row.area[0] && typeof row.area[0].name === "string"
      ? row.area[0].name
      : "Unassigned area";
  const geohash = typeof row.geohash === "string" ? row.geohash : "";
  const id = typeof row.id === "string" ? row.id : "";
  const active = typeof row.active === "boolean" ? row.active : null;
  const verificationDate =
    typeof row.verified_at === "string"
      ? row.verified_at
      : typeof row.verifiedAt === "string"
        ? row.verifiedAt
        : null;
  const accessible = typeof row.accessible === "boolean" ? row.accessible : null;
  const babyChange =
    typeof row.baby_change === "boolean"
      ? row.baby_change
      : typeof row.babyChange === "boolean"
        ? row.babyChange
        : null;
  const noPayment =
    typeof row.no_payment === "boolean"
      ? row.no_payment
      : typeof row.noPayment === "boolean"
        ? row.noPayment
        : null;
  const radar = typeof row.radar === "boolean" ? row.radar : null;
  const updatedAt =
    typeof row.updated_at === "string"
      ? row.updated_at
      : typeof row.updatedAt === "string"
        ? row.updatedAt
        : null;
  const createdAt =
    typeof row.created_at === "string"
      ? row.created_at
      : typeof row.createdAt === "string"
        ? row.createdAt
        : null;
  const contributorsCount =
    typeof row.contributorsCount === "number"
      ? row.contributorsCount
      : typeof row.contributors_count === "number"
        ? row.contributors_count
        : 0;
  const openingLabel = getOpeningLabel(
    row.openingTimes || (row as Record<string, unknown>).opening_times,
  );
  const statusInfo = getStatusInfo(active);
  const verificationLabel = getVerificationLabel(verificationDate);
  const accessLabel = getAccessLabel(accessible);
  const facilityValue = getFacilitiesLabel(babyChange, radar);
  const costLabel = getCostLabel(noPayment);

  return (
    <tr>
      <td>
        <div class="table-cell-primary">
          <strong>
            <a href={`/admin/loos/${id}`} style="color: inherit; text-decoration: none;">
              {name}
            </a>
          </strong>
          <div class="table-cell-meta">
            <span>{area}</span>
            {geohash && <span class="table-cell-subtle">{geohash}</span>}
            <span class="table-cell-subtle">#{id.slice(-6)}</span>
          </div>
          <div class="meta-pill-group">
            <span class="meta-pill">{openingLabel}</span>
          </div>
        </div>
      </td>
      <td>
        <div class="detail-stack">
          <span class="status-line">
            <span class={`status-dot status-dot--${statusInfo.tone}`} />
            {statusInfo.label}
          </span>
          <span class="muted-text">{verificationLabel}</span>
        </div>
      </td>
      <td>
        <div class="detail-stack">
          <div class="detail-row">
            <span class="detail-label">Access</span>
            <span class="detail-value">{accessLabel}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Facilities</span>
            <span class="detail-value">{facilityValue}</span>
          </div>
        </div>
      </td>
      <td>
        <div class="detail-stack">
          <div class="detail-row">
            <span class="detail-label">Cost</span>
            <span class="detail-value">{costLabel}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Contributors</span>
            <span class="detail-value">{formatNumber(contributorsCount)}</span>
          </div>
        </div>
      </td>
      <td>
        <div class="detail-stack">
          <div class="detail-row">
            <span class="detail-label">Updated</span>
            <span class="detail-value">{formatDate(updatedAt)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Created</span>
            <span class="detail-value">{formatDate(createdAt)}</span>
          </div>
        </div>
      </td>
    </tr>
  );
}

export function LoosTable({ searchData, loading, error, onRetry }: LoosTableProps) {
  const rows = searchData && Array.isArray(searchData.data) ? searchData.data : [];
  const isEmpty = !loading && !error && rows.length === 0;

  let tableState: "loading" | "error" | "empty" | "data" = "data";
  if (loading) tableState = "loading";
  else if (error) tableState = "error";
  else if (isEmpty) tableState = "empty";

  const shellClasses = ["table-shell"];
  if (tableState === "loading") shellClasses.push("table-shell--loading");
  if (tableState === "error" || tableState === "empty") shellClasses.push("table-shell--muted");
  const shellClassName = shellClasses.join(" ");

  return (
    <div class="table-overflow" data-loos-table-root style="min-height: 600px;">
      <div class={shellClassName}>
        <table class="data-table" data-loos-table>
          <thead>
            <tr>
              <th>Location</th>
              <th>Status</th>
              <th>Access & facilities</th>
              <th>Cost & contributors</th>
              <th>Activity</th>
            </tr>
          </thead>
          <tbody data-loos-table-body>
            {rows.map((row, index) => (
              <LoosTableRow row={row} key={(row.id as string) || index} />
            ))}
          </tbody>
        </table>

        {tableState !== "data" && <LoosTableStates state={tableState} onRetry={onRetry} />}
      </div>
    </div>
  );
}
