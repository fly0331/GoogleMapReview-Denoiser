import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";

function readApiOrigin(mode: string): string {
  const value = loadEnv(mode, ".", "VITE_API_BASE_URL").VITE_API_BASE_URL?.trim();
  const setting = `VITE_API_BASE_URL (${mode} mode)`;
  if (!value) throw new Error(`${setting} is required.`);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${setting} must be an absolute HTTP or HTTPS origin.`);
  }
  if (!/^https?:\/\/[^/?#@\\\s*]+\/?$/i.test(value) || url.hostname.includes("*")) {
    throw new Error(`${setting} must be an HTTP or HTTPS origin without credentials, a path, query, or fragment.`);
  }

  if (mode === "production") {
    if (url.protocol !== "https:") throw new Error(`${setting} must use HTTPS.`);
    const hostname = url.hostname.replace(/\.$/, "");
    if (hostname === "localhost" || hostname.endsWith(".localhost") || /^127\.(?:\d+\.){2}\d+$/.test(hostname) ||
        hostname === "0.0.0.0" || hostname === "[::1]" || hostname === "[::]") {
      throw new Error(`${setting} must not point to a local API host.`);
    }
  }
  return url.origin;
}

export default defineConfig(({ mode }) => {
  const apiOrigin = readApiOrigin(mode);
  return {
    define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify(apiOrigin) },
    plugins: [react(), crx({
      manifest: {
        ...manifest,
        host_permissions: [...manifest.host_permissions, `${apiOrigin}/*`],
      },
    })],
  };
});
