export const invalidateDumpCache = async (requestUrl: string): Promise<void> => {
  const cache =
    typeof caches !== "undefined"
      ? (caches as unknown as { default: Cache | undefined }).default
      : undefined;
  if (!cache) return;
  const { origin } = new URL(requestUrl);
  await Promise.all([
    cache.delete(`${origin}/api/loos/dump`),
    cache.delete(`${origin}/api/loos/dump?rich=true`),
  ]);
};
