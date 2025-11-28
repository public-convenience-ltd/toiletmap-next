# Loos List Client Components

This directory contains the refactored client-side code for the admin loos list page, broken down into modular, reusable components and utilities.

## Directory Structure

```
client/
├── components/          # React-style client components
│   ├── LoosTable.client.tsx          # Main table with row rendering
│   ├── LoosPagination.client.tsx     # Pagination controls
│   ├── LoosMetrics.client.tsx        # Metrics/insights panel
│   ├── LoosFeatureList.client.tsx    # Feature coverage stats
│   ├── LoosAreaList.client.tsx       # Area breakdown list
│   └── LoosTableStates.client.tsx    # Loading/error/empty states
├── hooks/               # Custom hooks for state and data management
│   ├── useLoosData.ts               # Data fetching with AbortController
│   ├── useLoosState.ts              # State management
│   └── useUrlSync.ts                # URL synchronization
├── utils/               # Utility functions and types
│   ├── types.ts                     # TypeScript type definitions
│   ├── formatters.ts                # Date, number, label formatters
│   └── builders.ts                  # URL & API param builders
├── LoosListApp.client.tsx           # Main orchestrator component
├── index.client.tsx                 # Client-side entry point (for future bundling)
└── README.md                        # This file
```

## Components

### LoosTable.client.tsx
**Purpose:** Renders the data table with individual rows.

**Props:**
- `searchData`: Search results from API
- `loading`: Loading state
- `error`: Error state
- `onRetry`: Retry callback function

**Features:**
- Handles empty, loading, and error states
- Renders table headers and rows
- Normalizes data (handles both snake_case and camelCase API responses)
- Rich cell content with badges, dates, and formatted values

---

### LoosPagination.client.tsx
**Purpose:** Pagination controls with page info and navigation.

**Props:**
- `searchData`: Search results containing pagination metadata
- `state`: Current application state
- `currentPath`: Current URL path for building navigation links

**Features:**
- Displays current page range (e.g., "Showing 1-25 of 150")
- Generates smart pagination buttons (max 5 pages visible)
- Prev/Next navigation with disabled states
- Preserves filters and search in pagination URLs

---

### LoosMetrics.client.tsx
**Purpose:** Summary metrics panel with cards, features, and areas.

**Props:**
- `metrics`: Metrics data from API
- `totalCount`: Total record count
- `searchQuery`: Current search query
- `recentWindowDays`: Number of days for "recent" metric
- `areaColors`: Array of colors for area visualization
- `loading`: Loading state
- `error`: Error message

**Features:**
- 4 metric cards: Filtered records, Active coverage, Accessibility, Recent updates
- Composes LoosFeatureList and LoosAreaList sub-components
- Handles error states gracefully

---

### LoosFeatureList.client.tsx
**Purpose:** Feature coverage visualization with progress bars.

**Props:**
- `metrics`: Metrics containing feature totals
- `totalCount`: Total record count for percentage calculation
- `loading`: Loading state

**Features:**
- Progress bars for: Baby changing, RADAR key, Free access, Verified
- Percentage calculations
- Formatted labels and values

---

### LoosAreaList.client.tsx
**Purpose:** Top areas breakdown with colored dots.

**Props:**
- `metrics`: Metrics containing area data
- `areaColors`: Array of colors for visualization
- `loading`: Loading state

**Features:**
- Color-coded dots for each area
- Handles empty state
- Formatted counts

---

### LoosTableStates.client.tsx
**Purpose:** Loading, error, and empty state views.

**Props:**
- `state`: Current view state ('loading' | 'error' | 'empty' | 'data')
- `onRetry`: Retry callback for error state

**Features:**
- Loading spinner
- Error message with retry button
- Empty state message

---

## Hooks

### useLoosState.ts
**Purpose:** Manages application state (search, pagination, sorting, filters).

**Returns:**
```typescript
{
  state: ScriptState,
  setState: (state: ScriptState) => void,
  updateSearch: (search: string) => void,
  updatePage: (page: number) => void,
  updatePageSize: (pageSize: number) => void,
  updateSort: (sortBy: string, sortOrder: SortOrder) => void,
  updateFilter: (filterKey: string, filterValue: string) => void,
  resetFilters: () => void
}
```

---

### useLoosData.ts
**Purpose:** Fetches search and metrics data with AbortController support.

**Parameters:**
- `state`: Current application state
- `searchEndpoint`: API endpoint for search
- `metricsEndpoint`: API endpoint for metrics
- `filterMappings`: Filter configuration
- `recentWindowDays`: Days for recent metric

**Returns:**
```typescript
{
  searchData: SearchResponse | null,
  metricsData: MetricsResponse | null,
  loading: boolean,
  error: boolean,
  metricsError: string | null,
  refetch: () => void
}
```

**Features:**
- Automatic data fetching on state changes
- Request cancellation with AbortController
- Separate error handling for search vs metrics
- Refetch functionality

---

### useUrlSync.ts
**Purpose:** Synchronizes application state with URL query parameters (read-only).

**Parameters:**
- `setState`: State setter function

**Features:**
- Reads initial state from URL on mount
- Parses search, pagination, sorting, and filter params

---

## Utilities

### types.ts
Defines all TypeScript types:
- `ScriptState`: Application state shape
- `SearchResponse`: API search response
- `MetricsResponse`: API metrics response
- `FilterMappings`: Filter configuration
- `LooRecord`: Individual loo record
- `PageConfig`: Page configuration from server

---

### formatters.ts
Formatting functions:
- `escapeHtml(value)`: Prevents XSS
- `formatDate(value)`: British locale date format
- `formatNumber(value)`: Locale-aware number formatting
- `percentage(value, total)`: Calculate percentage
- `getOpeningLabel(openingTimes)`: Human-readable hours
- `getStatusInfo(active)`: Status label and tone
- `getVerificationLabel(date)`: Verification status
- `getAccessLabel(accessible)`: Accessibility label
- `getFacilitiesLabel(babyChange, radar)`: Facilities description
- `getCostLabel(noPayment)`: Cost/payment label

---

### builders.ts
URL and API parameter builders:
- `sanitizeSortColumn(column)`: Validate sort columns
- `mapSortToApiSort(column, order)`: Map UI sort to API format
- `getEffectiveSort(state)`: Calculate effective sort
- `buildSearchParams(state, filterMappings)`: Build search query params
- `buildMetricsParams(state, filterMappings, days)`: Build metrics query params
- `buildNavigationUrl(state, path, overrides)`: Build navigation URLs

---

## Current Implementation ✅

The refactored code is now **fully implemented** with client-side rendering using `hono/jsx/dom`!

### Build Setup

**Client bundling:** Configured via `vite.config.client.ts`
- Entry point: `index.client.tsx`
- Output: `public/admin/loos-list.js` (30KB bundled, 11KB gzipped)
- JSX runtime: `hono/jsx/dom`
- Minifier: esbuild

**Build scripts:**
```bash
npm run build:client    # Build client bundle only
npm run build:worker    # Build worker only
npm run build           # Build both (client first, then worker)
```

**Static assets:** Served from `public/` directory via Wrangler's assets feature

### How It Works

1. **Server-side (list.tsx):**
   - Renders HTML structure with data attributes
   - Embeds page configuration as JSON in `#loos-page-config`
   - Adds `<div id="loos-app-root"></div>` mount point
   - References bundled script: `<script type="module" src="/admin/loos-list.js"></script>`

2. **Client-side (index.client.tsx):**
   - Reads configuration from DOM
   - Renders `<LoosListApp />` into `#loos-app-root`
   - Uses Hono hooks (useState, useEffect) for reactivity
   - Manages data fetching, pagination, and UI updates

3. **Deployment:**
   - Client bundle is built to `public/admin/`
   - Wrangler serves static assets from `public/`
   - Worker serves HTML with script reference
   - Browser fetches and executes bundled client code

## Benefits of This Refactoring

### Before (scripts.ts)
- ❌ Single 672-line function
- ❌ String-based HTML generation
- ❌ No component reusability
- ❌ Manual state synchronization
- ❌ Hard to test
- ❌ Mixed concerns (formatting, fetching, rendering)

### After (client/)
- ✅ Modular, focused components
- ✅ Type-safe JSX rendering
- ✅ Reusable hooks and utilities
- ✅ Clear separation of concerns
- ✅ Easy to test each piece
- ✅ Maintainable and extensible

## Testing

The refactored code passes TypeScript type checking:

```bash
npm run typecheck
```

To test the full implementation, run the dev server:

```bash
npm run dev
```

Navigate to the admin loos list page and verify:
- Data loads correctly
- Pagination works
- Filters apply
- Metrics display
- Refresh button works
- Error handling functions

## Contributing

When adding new features:

1. **Components**: Add to `components/` with `.client.tsx` extension
2. **Hooks**: Add to `hooks/` for shared state logic
3. **Utilities**: Add to `utils/` for pure functions
4. **Types**: Update `utils/types.ts` for new data shapes

Follow the existing patterns:
- Use TypeScript for type safety
- Export named functions/components
- Add JSDoc comments for complex logic
- Keep components focused and small
