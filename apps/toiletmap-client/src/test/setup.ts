/**
 * Vitest setup for client unit and component tests.
 *
 * - Registers the jest-dom matchers (`toBeInTheDocument`, `toBeDisabled`, …).
 * - Installs an in-memory IndexedDB so code using idb-keyval works in happy-dom.
 * - Unmounts anything rendered with @testing-library/preact after each test.
 */
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { cleanup } from "@testing-library/preact";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
