import { PAGE_SIZE_OPTIONS } from './constants';

export const clampPageSize = (value: number) => {
    return PAGE_SIZE_OPTIONS.includes(value as typeof PAGE_SIZE_OPTIONS[number]) ? value : 25;
};

export const toBoolOrNull = (val?: string | null) => {
    if (val === 'true') return true;
    if (val === 'false') return false;
    return null;
};

export const toNullableString = (val?: string | null) => {
    if (!val) return null;
    const trimmed = val.trim();
    return trimmed.length ? trimmed : null;
};

export const serializeConfig = (payload: unknown) => {
    return JSON.stringify(payload)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
};
