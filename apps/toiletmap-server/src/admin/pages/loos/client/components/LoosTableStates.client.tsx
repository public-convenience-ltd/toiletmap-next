/** @jsxImportSource hono/jsx/dom */

/**
 * Loading, error, and empty state views for the Loos table
 */

type LoosTableStatesProps = {
    state: 'loading' | 'error' | 'empty' | 'data';
    onRetry?: () => void;
};

export function LoosTableStates({ state, onRetry }: LoosTableStatesProps) {
    if (state === 'loading') {
        return (
            <div
                class="table-overlay table-overlay--loading"
                data-loos-table-loading
                role="status"
                aria-live="polite"
            >
                <div class="loading-indicator">
                    <span class="loading-spinner" aria-hidden="true"></span>
                    <p>Refreshing loos…</p>
                </div>
            </div>
        );
    }

    if (state === 'error') {
        return (
            <div class="table-overlay" data-loos-table-error role="alert">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>We couldn’t load the loos right now</h3>
                <p>Check your filters or try again.</p>
                {onRetry && (
                    <div class="table-overlay__actions">
                        <button type="button" class="button" data-loos-retry onClick={onRetry}>
                            Try again
                        </button>
                    </div>
                )}
            </div>
        );
    }

    if (state === 'empty') {
        return (
            <div class="table-overlay" data-loos-table-empty role="status" aria-live="polite">
                <i class="fa-solid fa-inbox" aria-hidden="true"></i>
                <h3>No results match this filter set</h3>
                <p>Try broadening your filters or resetting pagination.</p>
            </div>
        );
    }

    return null;
}
