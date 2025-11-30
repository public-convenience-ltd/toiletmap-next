/** @jsxImportSource hono/jsx/dom */

/**
 * Pagination controls component
 */

import { buildNavigationUrl } from "../utils/builders";
import { formatNumber } from "../utils/formatters";
import type { ScriptState, SearchResponse } from "../utils/types";

type LoosPaginationProps = {
  searchData: SearchResponse;
  state: ScriptState;
  currentPath: string;
};

export function LoosPagination({ searchData, state, currentPath }: LoosPaginationProps) {
  const total = Number(searchData.total) || 0;
  const currentPage = Number(searchData.page) || state.page;
  const pageSize = Number(searchData.pageSize) || state.pageSize;
  const rowsCount = Array.isArray(searchData.data) ? searchData.data.length : 0;
  const totalPages = Math.max(1, Math.ceil(total / (pageSize || 1)));
  const startIndex = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endIndex = total === 0 ? 0 : startIndex + rowsCount - 1;

  const paginationInfo =
    total === 0
      ? "No results to display"
      : `Showing ${startIndex}-${endIndex} of ${formatNumber(total)}`;

  const disablePrev = currentPage <= 1;
  const disableNext = !searchData.hasMore || currentPage >= totalPages;

  const prevUrl = buildNavigationUrl(state, currentPath, { page: Math.max(1, currentPage - 1) });
  const nextUrl = buildNavigationUrl(state, currentPath, {
    page: Math.min(totalPages, currentPage + 1),
  });

  let pageButtons: JSX.Element | JSX.Element[];
  if (total === 0) {
    pageButtons = <span class="muted-text">No pages to display</span>;
  } else {
    const buttons = [];
    const visibleCount = Math.min(5, totalPages);
    let startPage = 1;
    if (totalPages > 5) {
      if (currentPage <= 3) {
        startPage = 1;
      } else if (currentPage >= totalPages - 2) {
        startPage = totalPages - 4;
      } else {
        startPage = currentPage - 2;
      }
    }
    for (let i = 0; i < visibleCount; i += 1) {
      const pageNum = startPage + i;
      const isActive = pageNum === currentPage;
      buttons.push(
        <a
          href={buildNavigationUrl(state, currentPath, { page: pageNum })}
          class={`pagination-btn${isActive ? " active" : ""}`}
          key={pageNum}
        >
          {pageNum}
        </a>,
      );
    }
    pageButtons = buttons;
  }

  return (
    <div class="pagination" data-loos-pagination>
      <div class="pagination-info" data-loos-pagination-info>
        {paginationInfo}
      </div>
      <div class="pagination-controls">
        <a
          href={prevUrl}
          class="pagination-btn"
          data-loos-prev
          style={disablePrev ? "pointer-events: none; opacity: 0.4;" : ""}
          aria-label="Previous page"
        >
          <i class="fa-solid fa-chevron-left" aria-hidden="true" />
          <span class="visually-hidden">Previous page</span>
        </a>
        <div class="pagination-dynamic" data-loos-page-buttons>
          {pageButtons}
        </div>
        <a
          href={nextUrl}
          class="pagination-btn"
          data-loos-next
          style={disableNext ? "pointer-events: none; opacity: 0.4;" : ""}
          aria-label="Next page"
        >
          <i class="fa-solid fa-chevron-right" aria-hidden="true" />
          <span class="visually-hidden">Next page</span>
        </a>
      </div>
    </div>
  );
}
