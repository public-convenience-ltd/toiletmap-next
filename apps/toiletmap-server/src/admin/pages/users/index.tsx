import { Context } from "hono";
import { Layout } from "../../components/Layout";
import { Button, Badge, CollapsibleCard } from "../../components/DesignSystem";
import { AppVariables, Env, RequestUser } from "../../../types";
import { extractContributor } from "../../../utils/auth-utils";
import { createPrismaClient } from "../../../prisma";
import {
  ContributorReport,
  ContributorStats,
  ContributorSuggestion,
  UserInsightsService,
} from "../../../services/contributor";
import { RECENT_WINDOW_DAYS } from "../../../common/constants";
import { logger } from "../../../utils/logger";

type AdminContext = Context<{ Bindings: Env; Variables: AppVariables }>;

const numberFormatter = new Intl.NumberFormat("en-GB");
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const formatNumber = (value: number) => numberFormatter.format(value);
const formatDate = (value: string | null) =>
  value ? dateFormatter.format(new Date(value)) : "—";
const formatDateTime = (value: string | null) =>
  value ? dateTimeFormatter.format(new Date(value)) : "—";

const formatDiffValue = (value: unknown) => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return numberFormatter.format(value);
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const buildUserName = (user: RequestUser | undefined) =>
  user?.name || user?.nickname || user?.email || user?.sub || "Signed-in user";

const buildAffordanceMessage = (
  summary: ContributorStats["summary"]
): string => {
  if (summary.totalEvents === 0 && summary.totalLoos === 0) {
    return "We have not recorded any edits for this contributor yet.";
  }
  if (!summary.lastSeenAt) {
    return "Edits detected, but we have no timestamp available.";
  }
  return `Latest activity recorded on ${formatDateTime(summary.lastSeenAt)}.`;
};

const buildSuggestionLinks = (
  suggestions: ContributorSuggestion[],
  selectedHandle: string,
  searchTerm: string
) =>
  suggestions.map((entry) => {
    const link = new URL("/admin/users/statistics", "http://localhost");
    link.searchParams.set("handle", entry.handle);
    if (searchTerm) {
      link.searchParams.set("search", searchTerm);
    }
    return {
      ...entry,
      href: `${link.pathname}${link.search}`,
      isActive: entry.handle === selectedHandle,
    };
  });

const buildReportDiffPreview = (report: ContributorReport) => {
  if (!report.diff) {
    return null;
  }
  const entries = Object.entries(report.diff);
  const preview = entries.slice(0, 4);
  const remaining = Math.max(entries.length - preview.length, 0);
  return { preview, remaining, total: entries.length };
};

const diffLabelMap: Record<string, string> = {
  accessible: "Accessible",
  active: "Active status",
  notes: "Public notes",
  paymentDetails: "Payment details",
  payment_details: "Payment details",
  removalReason: "Removal reason",
  removal_reason: "Removal reason",
  verifiedAt: "Verification date",
  verified_at: "Verification date",
  updated_at: "Last updated",
  openingTimes: "Opening hours",
  opening_times: "Opening hours",
  noPayment: "Free to use",
  no_payment: "Free to use",
  babyChange: "Baby change",
  baby_change: "Baby change",
  radar: "Radar key",
  area_id: "Area",
};

const formatDiffLabel = (field: string) => {
  if (diffLabelMap[field]) return diffLabelMap[field];
  return field
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const renderDiffValue = (value: unknown, variant: "previous" | "current") => (
  <span class={`diff-chip diff-chip--${variant}`}>
    <span class="diff-chip__label">
      {variant === "previous" ? "Was" : "Now"}
    </span>
    <span class="diff-chip__value">{formatDiffValue(value)}</span>
  </span>
);

export const userStatistics = async (c: AdminContext) => {
  const requestUser = c.get("user");
  const defaultHandle =
    extractContributor(requestUser, c.env.AUTH0_PROFILE_KEY) ?? "";
  const selectedHandleParam = (c.req.query("handle") ?? "").trim();
  const selectedHandle = selectedHandleParam || defaultHandle;
  const searchTerm = (c.req.query("search") ?? "").trim();
  const connectionString =
    c.env.HYPERDRIVE?.connectionString ??
    c.env.TEST_HYPERDRIVE?.connectionString;
  if (!connectionString) {
    throw new Error("No database connection string available");
  }
  const prisma = createPrismaClient(connectionString);
  const insightsService = new UserInsightsService(prisma);

  let suggestions: ContributorSuggestion[] = [];
  let suggestionsError: string | null = null;
  try {
    suggestions = searchTerm
      ? await insightsService.searchContributors(searchTerm, 8)
      : await insightsService.getPopularContributors(8);
  } catch (error) {
    if (error instanceof Error) {
      logger.logError(error, { searchTerm });
    } else {
      logger.error("Failed to load contributor suggestions in admin page", {
        searchTerm,
        errorMessage: String(error),
      });
    }
    suggestionsError =
      error instanceof Error ? error.message : "Unable to load suggestions.";
  }

  let stats: ContributorStats | null = null;
  let statsError: string | null = null;
  if (selectedHandle) {
    try {
      stats = await insightsService.getContributorStats(selectedHandle);
    } catch (error) {
      if (error instanceof Error) {
        logger.logError(error, { contributor: selectedHandle });
      } else {
        logger.error("Failed to load contributor stats in admin page", {
          contributor: selectedHandle,
          errorMessage: String(error),
        });
      }
      statsError =
        error instanceof Error
          ? error.message
          : "Unable to load contributor statistics.";
    }
  }

  const viewingSelf =
    Boolean(defaultHandle) && selectedHandle === defaultHandle;
  const suggestionLinks = buildSuggestionLinks(
    suggestions,
    selectedHandle,
    searchTerm
  );
  const handleDisplay = selectedHandle || "Not configured";

  const statsContext = stats
    ? buildAffordanceMessage(stats.summary)
    : "Select a contributor to see their details.";

  return c.html(
    <Layout title="User Statistics">
      <style>
        {`
          .search-card {
            margin-bottom: var(--space-l);
          }
          .suggestions-list {
            list-style: none;
            padding: 0;
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: var(--space-xs);
          }
          .suggestions-item {
            display: flex;
            justify-content: space-between;
            gap: var(--space-s);
            align-items: center;
            padding: var(--space-xs);
            border: 1px solid rgba(10, 22, 94, 0.1);
            border-radius: 12px;
          }
          .suggestions-item--active {
            border-color: var(--color-turquoise);
            box-shadow: 0 0 0 1px rgba(146, 249, 219, 0.6);
          }
          .suggestions-item strong {
            display: block;
          }
          .insights-stack {
            display: flex;
            flex-direction: column;
            gap: var(--space-s);
          }
          .insights-section {
            border: 1px solid rgba(10, 22, 94, 0.12);
            border-radius: 16px;
            padding: var(--space-2xs) var(--space-s) var(--space-s);
            background: #f8fafc;
          }
          .insights-section summary {
            cursor: pointer;
            list-style: none;
            font-weight: 600;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-s);
            padding: var(--space-xs) 0;
          }
          .insights-section summary::-webkit-details-marker {
            display: none;
          }
          .insights-section summary::after {
            content: '\\f078';
            font-family: 'Font Awesome 6 Free';
            font-weight: 900;
            color: var(--color-neutral-grey);
            transition: transform 0.2s ease;
          }
          .insights-section[open] summary::after {
            transform: rotate(180deg);
          }
          .insights-section__label {
            font-size: var(--text-0);
            display: flex;
            flex-direction: column;
            gap: var(--space-3xs);
          }
          .insights-section__hint {
            font-size: var(--text--1);
            color: var(--color-neutral-grey);
            font-weight: 400;
          }
          .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: var(--space-m);
          }
          .metrics-grid .metric-card {
            background: #f8fafc;
          }
          .loo-list,
          .area-list {
            list-style: none;
            padding: 0;
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: var(--space-s);
          }
          .loo-list li {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: var(--space-s);
            border: 1px solid rgba(10, 22, 94, 0.1);
            border-radius: 12px;
            padding: var(--space-s);
          }
          .area-list li {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: var(--space-xs);
            border-radius: 8px;
            background: #f7f8fb;
          }
          .timeline-stack {
            display: flex;
            flex-direction: column;
            gap: var(--space-s);
          }
          .timeline-node {
            border: 1px solid rgba(10, 22, 94, 0.12);
            border-radius: 16px;
            padding: var(--space-xs) var(--space-s);
            background: var(--color-white);
          }
          .timeline-node summary {
            list-style: none;
            display: flex;
            flex-direction: column;
            gap: var(--space-2xs);
          }
          .timeline-node summary::-webkit-details-marker {
            display: none;
          }
          .timeline-summary {
            display: flex;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: var(--space-s);
            align-items: flex-start;
          }
          .timeline-summary__heading {
            margin: 0;
            font-size: var(--text-0);
          }
          .timeline-summary__meta {
            font-size: var(--text--1);
            color: var(--color-neutral-grey);
          }
          .diff-tags {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-3xs);
          }
          .diff-tag {
            background: #edf2f7;
            border-radius: 999px;
            padding: 0 var(--space-3xs);
            font-size: var(--text--2);
            font-weight: 600;
          }
          .diff-tag--muted {
            color: var(--color-neutral-grey);
            background: transparent;
          }
          .timeline-body {
            border-top: 1px solid rgba(10, 22, 94, 0.08);
            margin-top: var(--space-s);
            padding-top: var(--space-s);
            display: flex;
            flex-direction: column;
            gap: var(--space-s);
          }
          .timeline-links {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-xs);
          }
          .timeline-links a {
            font-size: var(--text--1);
            text-decoration: none;
            color: var(--color-primary-navy);
            font-weight: 600;
          }
          .diff-list {
            list-style: none;
            padding: 0;
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: var(--space-s);
          }
          .diff-entry {
            display: flex;
            flex-direction: column;
            gap: var(--space-3xs);
          }
          .diff-entry__field {
            font-weight: 600;
            color: var(--color-primary-navy);
          }
          .diff-entry__values {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: var(--space-3xs);
          }
          .diff-chip {
            display: inline-flex;
            flex-direction: column;
            border-radius: 10px;
            padding: var(--space-3xs) var(--space-xs);
            min-width: 120px;
            border: 1px solid rgba(10, 22, 94, 0.1);
            background: #fff;
          }
          .diff-chip--previous {
            background: #fff5f7;
            border-color: rgba(237, 61, 98, 0.4);
          }
          .diff-chip--current {
            background: #f0fffa;
            border-color: rgba(146, 249, 219, 0.7);
          }
          .diff-chip__label {
            font-size: var(--text--2);
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--color-neutral-grey);
          }
          .diff-chip__value {
            font-weight: 600;
          }
          .diff-arrow {
            color: var(--color-neutral-grey);
            font-weight: 600;
          }
          .profile-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: var(--space-s);
            margin-top: var(--space-s);
          }
          .profile-grid dt {
            font-weight: 600;
            font-size: var(--text--1);
            color: var(--color-neutral-grey);
          }
          .profile-grid dd {
            margin: 0;
            font-weight: 600;
          }
          .form-card--subtle {
            border-style: dashed;
            background: #f7f9ff;
          }
          .admin-profile-card {
            margin-top: var(--space-l);
          }
        `}
      </style>

      <div class="page-header">
        <div>
          <p class="form-label" style="margin: 0;">
            Contributor statistics
          </p>
          <h1 style="margin: var(--space-3xs) 0;">User statistics</h1>
          <p style="color: var(--color-neutral-grey); margin: 0;">
            Viewing contributions recorded for <strong>{handleDisplay}</strong>
          </p>
          <p style="color: var(--color-neutral-grey); margin: var(--space-3xs) 0 0;">
            {statsContext}
          </p>
        </div>
        <div style="display: flex; gap: var(--space-s); flex-wrap: wrap;">
          {defaultHandle && !viewingSelf && (
            <Button
              variant="secondary"
              href={`/admin/users/statistics?handle=${encodeURIComponent(
                defaultHandle
              )}`}
            >
              Jump to my stats
            </Button>
          )}
          <Button variant="secondary" href="/admin/users/admin">
            User administration
          </Button>
          <Button variant="secondary" href="/admin/loos">
            Back to dataset
          </Button>
        </div>
      </div>

      <CollapsibleCard
        id="user-search-panel"
        eyebrow="Search contributors"
        title="Find a contributor"
        description="Start typing a name or handle to jump into a contributor’s audit history."
        showLabel="Show search"
        hideLabel="Hide search"
        className="search-card"
      >
        <form
          method="get"
          data-autosubmit="search"
          data-allow-empty="true"
          class="search-form"
          style="margin-bottom: var(--space-m);"
        >
          {selectedHandle && (
            <input type="hidden" name="handle" value={selectedHandle} />
          )}
          <label class="form-label" for="user-search">
            Contributor name or handle
          </label>
          <div class="search-input-wrapper">
            <input
              class="input search-input"
              type="text"
              id="user-search"
              name="search"
              placeholder="e.g. Jess Cooper"
              value={searchTerm}
              autocomplete="off"
            />
            {searchTerm && (
              <button
                type="button"
                class="search-clear-btn"
                data-clear-search
                aria-label="Clear search"
              >
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
              </button>
            )}
          </div>
        </form>

        {suggestionsError && (
          <div class="notification notification--error">
            <div class="notification__icon">
              <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
            </div>
            <div class="notification__content">
              <p class="notification__title">Suggestions unavailable</p>
              <p class="notification__message">{suggestionsError}</p>
            </div>
          </div>
        )}

        {!suggestionsError && (
          <>
            <div style="margin-bottom: var(--space-xs); display: flex; justify-content: space-between; align-items: center;">
              <strong>
                {searchTerm
                  ? `Matches for “${searchTerm}”`
                  : "Recently active contributors"}
              </strong>
              <span class="muted-text">
                {suggestions.length
                  ? "Select a contributor to load their statistics"
                  : "No contributors to show"}
              </span>
            </div>
            {suggestions.length ? (
              <ul class="suggestions-list">
                {suggestionLinks.map((entry) => (
                  <li
                    class={`suggestions-item${
                      entry.isActive ? " suggestions-item--active" : ""
                    }`}
                    key={entry.handle}
                  >
                    <div>
                      <strong>{entry.handle}</strong>
                      <span class="muted-text">
                        {formatNumber(entry.contributions)} edits recorded
                      </span>
                    </div>
                    <a class="button" href={entry.href}>
                      View
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="muted-text" style="margin: 0;">
                {searchTerm
                  ? "No contributors match this search."
                  : "We have not recorded any contributors yet."}
              </p>
            )}
          </>
        )}
      </CollapsibleCard>

      {statsError && (
        <div
          class="notification notification--error"
          style="margin-bottom: var(--space-l);"
        >
          <div class="notification__icon">
            <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
          </div>
          <div class="notification__content">
            <p class="notification__title">
              Contributor statistics unavailable
            </p>
            <p class="notification__message">{statsError}</p>
          </div>
        </div>
      )}

      {!stats && !statsError && (
        <div class="empty-state">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
          <p>Select a contributor to load detailed statistics.</p>
        </div>
      )}

      {stats && (
        <>
          <section class="form-card" style="margin-bottom: var(--space-l);">
            <div class="section-header">
              <div>
                <p class="section-eyebrow">Contribution snapshot</p>
                <h2 class="section-title">{stats.summary.handle}</h2>
                <p class="section-description">
                  Recent activity window: last {RECENT_WINDOW_DAYS} days.
                </p>
              </div>
            </div>
            <div class="metrics-grid">
              <div class="metric-card">
                <p class="metric-label">Unique loos touched</p>
                <p class="metric-value">
                  {formatNumber(stats.summary.totalLoos)}
                </p>
                <p class="metric-meta">All-time distinct loos</p>
              </div>
              <div class="metric-card">
                <p class="metric-label">Total audit events</p>
                <p class="metric-value">
                  {formatNumber(stats.summary.totalEvents)}
                </p>
                <p class="metric-meta">
                  First seen: {formatDate(stats.summary.firstSeenAt)}
                </p>
              </div>
              <div class="metric-card">
                <p class="metric-label">Active loos</p>
                <p class="metric-value">
                  {formatNumber(stats.summary.activeLoos)}
                </p>
                <p class="metric-meta">
                  Verified: {formatNumber(stats.summary.verifiedLoos)}
                </p>
              </div>
              <div class="metric-card">
                <p class="metric-label">Recently updated</p>
                <p class="metric-value">
                  {formatNumber(stats.summary.recentLoos)}
                </p>
                <p class="metric-meta">within {RECENT_WINDOW_DAYS} days</p>
              </div>
            </div>
            <p style="margin-top: var(--space-m); color: var(--color-neutral-grey);">
              {buildAffordanceMessage(stats.summary)}
            </p>
          </section>

          <section class="form-card insights-stack">
            <details class="insights-section" open>
              <summary>
                <div class="insights-section__label">
                  <span>Coverage</span>
                  <span class="insights-section__hint">
                    Top areas touched by this contributor
                  </span>
                </div>
              </summary>
              {stats.areas.length ? (
                <ul class="area-list">
                  {stats.areas.map((area) => (
                    <li
                      key={`${area.areaId ?? "unassigned"}-${
                        area.name ?? "unknown"
                      }`}
                    >
                      <span>
                        {area.name || "Unassigned"}{" "}
                        <span class="muted-text">
                          (
                          {area.areaId
                            ? `#${area.areaId.slice(-6)}`
                            : "no-area"}
                          )
                        </span>
                      </span>
                      <strong>{formatNumber(area.count)}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p class="muted-text" style="margin: 0;">
                  No areas recorded for this contributor yet.
                </p>
              )}
            </details>

            <details class="insights-section">
              <summary>
                <div class="insights-section__label">
                  <span>Places they touch</span>
                  <span class="insights-section__hint">
                    Most recently updated loos
                  </span>
                </div>
              </summary>
              {stats.loos.length ? (
                <ul class="loo-list">
                  {stats.loos.map((loo) => (
                    <li key={loo.id}>
                      <div>
                        <strong>
                          <a
                            href={`/admin/loos/${loo.id}`}
                            style="text-decoration: none; color: inherit;"
                          >
                            {loo.name || "Unnamed loo"}
                          </a>
                        </strong>
                        <p class="muted-text" style="margin: 0;">
                          {loo.areaName || "Area unknown"} • Updated{" "}
                          {formatDateTime(loo.updatedAt)}
                        </p>
                      </div>
                      <div style="display: flex; gap: var(--space-2xs); flex-wrap: wrap;">
                        <a
                          class="button button--secondary"
                          href={`/admin/loos/${loo.id}`}
                        >
                          Open admin view
                        </a>
                        <a
                          class="button button--secondary"
                          href={`/api/loos/${loo.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          JSON
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p class="muted-text" style="margin: 0;">
                  No loos have been attributed to this contributor yet.
                </p>
              )}
            </details>

            <details class="insights-section" open>
              <summary>
                <div class="insights-section__label">
                  <span>Audit trail</span>
                  <span class="insights-section__hint">
                    Latest 20 recorded edits
                  </span>
                </div>
              </summary>
              {stats.recentReports.length ? (
                <div class="timeline-stack">
                  {stats.recentReports.map((report, index) => {
                    const diffPreview = buildReportDiffPreview(report);
                    const eventTime = formatDateTime(
                      report.occurredAt || report.createdAt
                    );
                    return (
                      <details
                        class="timeline-node"
                        key={report.id}
                        open={index === 0}
                      >
                        <summary>
                          <div class="timeline-summary">
                            <div>
                              <p class="timeline-summary__heading">
                                {eventTime}
                              </p>
                              <span class="timeline-summary__meta">
                                {report.looId
                                  ? `Loo #${report.looId.slice(-6)}`
                                  : "Snapshot"}
                              </span>
                            </div>
                            {diffPreview && (
                              <span class="timeline-summary__meta">
                                {diffPreview.total} field
                                {diffPreview.total > 1 ? "s" : ""} changed
                              </span>
                            )}
                          </div>
                          {diffPreview && (
                            <div class="diff-tags">
                              {diffPreview.preview.map(([field]) => (
                                <span class="diff-tag" key={field}>
                                  {formatDiffLabel(field)}
                                </span>
                              ))}
                              {diffPreview.remaining > 0 && (
                                <span class="diff-tag diff-tag--muted">
                                  +{diffPreview.remaining} more
                                </span>
                              )}
                            </div>
                          )}
                        </summary>
                        <div class="timeline-body">
                          <div>
                            {report.looId ? (
                              <a
                                href={`/admin/loos/${report.looId}`}
                                style="font-weight: 600; text-decoration: none; color: var(--color-primary-navy);"
                              >
                                {report.looName || "Unnamed loo"}
                              </a>
                            ) : (
                              <span style="font-weight: 600;">
                                {report.looName || "Unnamed loo"}
                              </span>
                            )}
                          </div>
                          {report.diff ? (
                            <ul class="diff-list">
                              {Object.entries(report.diff).map(
                                ([field, value]) => (
                                  <li class="diff-entry" key={field}>
                                    <div class="diff-entry__field">
                                      {formatDiffLabel(field)}
                                    </div>
                                    <div class="diff-entry__values">
                                      {renderDiffValue(
                                        value.previous,
                                        "previous"
                                      )}
                                      <span
                                        class="diff-arrow"
                                        aria-hidden="true"
                                      >
                                        &rarr;
                                      </span>
                                      {renderDiffValue(
                                        value.current,
                                        "current"
                                      )}
                                    </div>
                                  </li>
                                )
                              )}
                            </ul>
                          ) : (
                            <p class="muted-text" style="margin: 0;">
                              Snapshot recorded (no field level diff)
                            </p>
                          )}
                          {report.looId && (
                            <div class="timeline-links">
                              <a href={`/admin/loos/${report.looId}`}>
                                View in admin
                              </a>
                              <a
                                href={`/api/loos/${report.looId}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open API response
                              </a>
                            </div>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              ) : (
                <p class="muted-text" style="margin: 0;">
                  No audit events recorded for this contributor yet.
                </p>
              )}
            </details>
          </section>
        </>
      )}

      <section class="form-card form-card--subtle admin-profile-card">
        <div class="section-header" style="margin-bottom: var(--space-s);">
          <div>
            <p class="section-eyebrow">Signed-in administrator</p>
            <h2 class="section-title" style="font-size: var(--text-1);">
              {buildUserName(requestUser)}
            </h2>
            <p class="section-description">
              Private reference only – lets you confirm how your edits are
              attributed.
            </p>
          </div>
          {defaultHandle && (
            <Badge variant="neutral" title="Preferred contributor handle">
              Handle: {defaultHandle}
            </Badge>
          )}
        </div>
        <dl class="profile-grid">
          <div>
            <dt>Email</dt>
            <dd>{requestUser?.email || "—"}</dd>
          </div>
          <div>
            <dt>Auth0 subject</dt>
            <dd style="word-break: break-all;">{requestUser?.sub || "—"}</dd>
          </div>
          <div>
            <dt>Nickname</dt>
            <dd>{requestUser?.nickname || "—"}</dd>
          </div>
        </dl>
        {!defaultHandle && (
          <p
            class="notification notification--info"
            style="margin-top: var(--space-m);"
          >
            <i class="fa-solid fa-circle-info" aria-hidden="true"></i>&nbsp; Set{" "}
            <code>AUTH0_PROFILE_KEY</code> or ensure your Auth0 profile has a
            nickname to automatically attribute your edits.
          </p>
        )}
      </section>
    </Layout>
  );
};
