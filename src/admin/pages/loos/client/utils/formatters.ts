/**
 * Formatting utilities for Loos List client components
 */

const numberFormatter = new Intl.NumberFormat('en-GB');

/**
 * Format a date string in British locale format (DD Mon YYYY)
 */
export const formatDate = (value?: string | null): string => {
    if (!value) return '—';
    const date = new Date(value);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * Calculate percentage with rounding
 */
export const percentage = (value: number, total: number): number => {
    if (!total) return 0;
    return Math.round((value / total) * 100);
};

/**
 * Format a number using British locale
 */
export const formatNumber = (value: number): string => {
    return numberFormatter.format(value);
};

/**
 * Get a human-readable label for opening times
 */
export const getOpeningLabel = (openingTimes: unknown): string => {
    if (!Array.isArray(openingTimes) || openingTimes.length === 0) {
        return 'Hours unknown';
    }
    const normalized = openingTimes.filter(
        (slot) => Array.isArray(slot) && slot.length === 2 && slot[0] && slot[1],
    );
    if (
        normalized.length === openingTimes.length &&
        normalized.every((slot) => slot[0] === '00:00' && slot[1] === '00:00')
    ) {
        return 'Open 24h';
    }
    if (normalized.length > 0) {
        return 'Custom hours';
    }
    return 'Hours unknown';
};

/**
 * Get status label and tone from active flag
 */
export const getStatusInfo = (active: boolean | null): { label: string; tone: string } => {
    if (active === true) return { label: 'Active', tone: 'positive' };
    if (active === false) return { label: 'Inactive', tone: 'negative' };
    return { label: 'Status unknown', tone: 'muted' };
};

/**
 * Get verification label from verification date
 */
export const getVerificationLabel = (verificationDate: string | null): string => {
    return verificationDate ? `Verified ${formatDate(verificationDate)}` : 'Awaiting verification';
};

/**
 * Get access label from accessible flag
 */
export const getAccessLabel = (accessible: boolean | null): string => {
    if (accessible === true) return 'Accessible';
    if (accessible === false) return 'Limited access';
    return 'Unknown';
};

/**
 * Get facilities description from facility flags
 */
export const getFacilitiesLabel = (babyChange: boolean | null, radar: boolean | null): string => {
    const facilities: string[] = [];
    if (babyChange === true) facilities.push('Baby change');
    if (babyChange === false) facilities.push('No baby change');
    if (radar === true) facilities.push('RADAR key');
    if (radar === false) facilities.push('Open access');
    return facilities.length ? facilities.join(' / ') : 'Details unavailable';
};

/**
 * Get cost label from payment flag
 */
export const getCostLabel = (noPayment: boolean | null): string => {
    if (noPayment === true) return 'Free to use';
    if (noPayment === false) return 'Paid access';
    return 'Unknown';
};
