/** @jsxImportSource hono/jsx/dom */

import { useEffect, useState } from "hono/jsx";

const parseConfig = <T>(scriptId: string): T | null => {
  if (typeof document === "undefined") return null;

  const script = document.getElementById(scriptId);
  if (!script) {
    console.error(`Config script with id "${scriptId}" not found`);
    return null;
  }

  const content = script.textContent ?? "";
  if (!content.trim()) {
    console.error(`Config script with id "${scriptId}" is empty`);
    return null;
  }

  try {
    return JSON.parse(content) as T;
  } catch (error) {
    console.error(`Failed to parse config from script "${scriptId}"`, error);
    return null;
  }
};

/**
 * Generic hook to load page config from a server-rendered script tag.
 * @param scriptId - The ID of the script tag containing the config JSON (default: 'loo-create-config')
 */
export const usePageConfig = <T = unknown>(scriptId = "loo-create-config") => {
  const [config, setConfig] = useState<T | null>(null);

  useEffect(() => {
    const parsed = parseConfig<T>(scriptId);
    setConfig(parsed);
  }, [scriptId]);

  return config;
};
