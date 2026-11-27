const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, readdirSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const extensionRoot = path.resolve(__dirname, "..");
const vite = path.join(extensionRoot, "node_modules", "vite", "bin", "vite.js");
const mapsHosts = ["https://www.google.com/maps/*", "https://maps.google.com/*"];
const localOrigin = "http://127.0.0.1:8000";
const productionOrigin = "https://google-map-review-denoiser.onrender.com";

function build(mode, outDir, override) {
  const env = { ...process.env };
  delete env.VITE_API_BASE_URL;
  if (override !== undefined) env.VITE_API_BASE_URL = override;
  const result = spawnSync(process.execPath, [vite, "build", "--mode", mode, "--outDir", outDir], {
    cwd: extensionRoot,
    encoding: "utf8",
    env,
  });
  if (result.error) throw result.error;
  return result;
}

for (const [mode, origin, otherOrigin] of [
  ["development", localOrigin, productionOrigin],
  ["production", productionOrigin, localOrigin],
]) {
  test(`${mode} manifest and service worker use the same API origin`, (t) => {
    const outDir = mkdtempSync(path.join(tmpdir(), "lumora-network-build-"));
    t.after(() => rmSync(outDir, { recursive: true, force: true }));
    const result = build(mode, outDir);
    assert.equal(result.status, 0, result.stderr);

    const output = JSON.parse(readFileSync(path.join(outDir, "manifest.json"), "utf8"));
    assert.deepEqual(output.host_permissions, [...mapsHosts, `${origin}/*`]);
    assert.deepEqual(output.content_scripts.flatMap(({ matches }) => matches), mapsHosts);
    assert.deepEqual(output.permissions, ["activeTab", "sidePanel", "storage"]);

    const assetsDir = path.join(outDir, "assets");
    const workerFiles = readdirSync(assetsDir).filter((name) => name.startsWith("background.ts-") && name.endsWith(".js"));
    assert.equal(workerFiles.length, 1);
    const worker = readFileSync(path.join(assetsDir, workerFiles[0]), "utf8");
    assert.ok(worker.includes(`${origin}/api/v1/analyze`));
    assert.ok(!worker.includes(otherOrigin));
  });
}

test("production rejects missing, invalid, HTTP and loopback API origins", (t) => {
  const outDir = mkdtempSync(path.join(tmpdir(), "lumora-network-invalid-"));
  t.after(() => rmSync(outDir, { recursive: true, force: true }));
  for (const [value, error] of [
    ["", /VITE_API_BASE_URL \(production mode\) is required/],
    ["invalid-url", /must be an absolute HTTP or HTTPS origin/],
    ["https://example.com/api", /without credentials, a path, query, or fragment/],
    ["http://example.com", /must use HTTPS/],
    ["https://127.0.0.1:8000", /must not point to a local API host/],
  ]) {
    const result = build("production", outDir, value);
    assert.notEqual(result.status, 0, value);
    assert.match(result.stderr, error);
  }
});
