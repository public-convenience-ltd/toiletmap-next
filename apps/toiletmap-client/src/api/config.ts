/**
 * Centralized API configuration for the Toilet Map client.
 * Provides pure functions for constructing API URLs without mutable state.
 */

/**
 * Constructs a full API URL by combining the base URL with the given path.
 * Handles trailing slashes and ensures proper path formatting.
 *
 * @param baseUrl - The base URL for the API server
 * @param path - The API endpoint path (e.g., '/api/loos/dump' or 'api/loos/123')
 * @returns The full API URL
 *
 * @example
 * ```typescript
 * getApiUrl('https://api.example.com', '/api/loos/dump')
 * // Returns: 'https://api.example.com/api/loos/dump'
 * ```
 */
export function getApiUrl(baseUrl: string, path: string): string {
  // Ensure path starts with /
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  // Remove trailing slash from base URL if present
  const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${cleanBaseUrl}${normalizedPath}`;
}
