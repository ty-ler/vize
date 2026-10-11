import path from "node:path";
import { splitViteIdQuery } from "@vizejs/native";
import type { VizePluginState } from "./state.ts";

// Vite pre-bundles into `<cacheDir>/deps` (also `deps_ssr`, `deps_temp_*`). When
// the Vite resolver answered with such an entry, vize must leave it alone: pinning
// the raw `vue` file instead gives the page a second Vue runtime beside the one
// pre-bundled dependencies import, and Vapor effects stop seeing ref updates.
export function isOptimizedVueDependency(
  state: Pick<VizePluginState, "viteCacheDir">,
  id: string,
): boolean {
  const { request } = splitViteIdQuery(id);
  const normalized = request.split(path.sep).join("/");
  const cacheDir = state.viteCacheDir?.split(path.sep).join("/").replace(/\/+$/, "");
  if (cacheDir) {
    const prefix = `${cacheDir}/deps`;
    if (normalized.startsWith(prefix)) {
      const rest = normalized.slice(prefix.length);
      return /^(?:_[^/]*)?\/vue\./.test(rest);
    }
  }
  return normalized.includes("/node_modules/.vite/deps/vue.");
}
