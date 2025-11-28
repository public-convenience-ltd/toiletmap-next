/**
 * State management hook for Loos List
 */

import { useState } from 'hono/jsx';
import type { ScriptState, SortOrder } from '../utils/types';

export function useLoosState(initialState: ScriptState) {
    const [state, setState] = useState<ScriptState>(initialState);

    const updateSearch = (search: string) => {
        setState({ ...state, search, page: 1 });
    };

    const updatePage = (page: number) => {
        setState({ ...state, page });
    };

    const updatePageSize = (pageSize: number) => {
        setState({ ...state, pageSize, page: 1 });
    };

    const updateSort = (sortBy: string, sortOrder: SortOrder) => {
        setState({ ...state, sortBy, sortOrder, hasCustomSort: true });
    };

    const updateFilter = (filterKey: string, filterValue: string) => {
        setState({
            ...state,
            filters: { ...state.filters, [filterKey]: filterValue },
            page: 1,
        });
    };

    const resetFilters = () => {
        setState({ ...state, filters: {}, page: 1 });
    };

    return {
        state,
        setState,
        updateSearch,
        updatePage,
        updatePageSize,
        updateSort,
        updateFilter,
        resetFilters,
    };
}
