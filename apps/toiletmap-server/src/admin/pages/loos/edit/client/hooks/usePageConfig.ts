/** @jsxImportSource hono/jsx/dom */

import { useEffect, useState } from "hono/jsx";
import type { EditPageConfig } from "../utils/types";

const parseConfig = (scriptId: string): EditPageConfig | null => {
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
    return JSON.parse(content) as EditPageConfig;
  } catch (error) {
    console.error(`Failed to parse config from script "${scriptId}"`, error);
    return null;
  }
};

/**
 * Hook to load the edit page config from the server-rendered script tag.
 */
export const usePageConfig = () => {
  const [config, setConfig] = useState<EditPageConfig | null>(null);

  useEffect(() => {
    const parsed = parseConfig("loo-edit-config");
    setConfig(parsed);
  }, []);

  return config;
};
