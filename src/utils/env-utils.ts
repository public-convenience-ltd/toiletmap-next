/**
 * Gets a required environment variable
 * Throws an error if the variable is not set
 */
export function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Gets an optional environment variable
 * Returns null if not set or empty
 */
export function getOptionalEnv(key: string): string | null {
  const value = process.env[key];
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Validates that all required environment variables are set
 * Should be called at application startup
 */
export function validateRequiredEnvVars() {
  const requiredVars = [
    'POSTGRES_URI',
    'AUTH0_ISSUER_BASE_URL',
    'AUTH0_AUDIENCE',
  ] as const;

  const missingVars = requiredVars.filter((key) => !process.env[key]);

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(', ')}`,
    );
  }
}
