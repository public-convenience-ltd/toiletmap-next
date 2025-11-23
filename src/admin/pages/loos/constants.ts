export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export const AREA_COLORS = ['#0a165e', '#ed3d62', '#92f9db', '#f4c430', '#7b61ff'];

export const TABLE_FILTERS = [
    {
        key: 'status',
        label: 'Status',
        options: [
            { value: 'all', label: 'Any status' },
            { value: 'active', label: 'Active only' },
            { value: 'inactive', label: 'Inactive only' },
        ],
    },
    {
        key: 'access',
        label: 'Accessibility',
        options: [
            { value: 'all', label: 'All toilets' },
            { value: 'accessible', label: 'Accessible' },
            { value: 'not_accessible', label: 'Not accessible' },
        ],
    },
    {
        key: 'payment',
        label: 'Payment',
        options: [
            { value: 'all', label: 'Free & paid' },
            { value: 'free', label: 'Free to use' },
            { value: 'paid', label: 'Requires payment' },
        ],
    },
    {
        key: 'verification',
        label: 'Verification',
        options: [
            { value: 'all', label: 'Any verification state' },
            { value: 'verified', label: 'Verified' },
            { value: 'unverified', label: 'Awaiting verification' },
        ],
    },
] as const;

export type FilterDefinition = typeof TABLE_FILTERS[number];
export type FilterKey = FilterDefinition['key'];
export type FilterOption = FilterDefinition['options'][number];

export const FILTER_TO_API_PARAM: Record<
    FilterKey,
    { param: string; mapping: Record<string, 'true' | 'false'> }
> = {
    status: { param: 'active', mapping: { active: 'true', inactive: 'false' } },
    access: { param: 'accessible', mapping: { accessible: 'true', not_accessible: 'false' } },
    payment: { param: 'noPayment', mapping: { free: 'true', paid: 'false' } },
    verification: { param: 'verified', mapping: { verified: 'true', unverified: 'false' } },
};

export const CURRENT_PATH = '/admin/loos';
