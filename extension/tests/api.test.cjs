const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/api.ts"), "utf8")
  .replace("import.meta.env.VITE_API_BASE_URL", JSON.stringify("http://api.example.test"));
const bundle = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const request = { place_id: "fixture", scraped_at: "2025-01-01T00:00:00Z", reviews: [] };
const valid = {
  cache_hit: false, analysis_mode: "mock", analyzed_count: 1,
  decision_pros: "Synthetic summary", decision_cons: "", aspect_scores: { food: 4 },
  pros: [{ aspect: "food", sentiment: "positive", summary: "Synthetic evidence", evidence_review_ids: ["r1"] }],
  cons: [], recommended_dishes: [], practical_visit_information: [],
};

function apiWithResponse(response) {
  const scope = { exports: {}, AbortController, Error, TypeError, SyntaxError, setTimeout, clearTimeout,
    fetch: async () => response,
  };
  vm.runInNewContext(bundle, scope);
  return scope.exports.analyzeReviews;
}

test("accepts a valid analysis result without optional model metadata", async () => {
  const analyze = apiWithResponse({ ok: true, json: async () => valid });
  assert.deepEqual(JSON.parse(JSON.stringify(await analyze(request))), valid);
});

test("keeps older results readable when optional sections are absent", async () => {
  const analyze = apiWithResponse({ ok: true, json: async () => ({
    cache_hit: true, analysis_mode: "gemini", analyzed_count: 0,
  }) });
  const result = JSON.parse(JSON.stringify(await analyze(request)));
  assert.deepEqual(result, {
    cache_hit: true, analysis_mode: "gemini", analyzed_count: 0,
    decision_pros: "", decision_cons: "", aspect_scores: {},
    pros: [], cons: [], recommended_dishes: [], practical_visit_information: [],
  });
});

test("rejects malformed successful responses before they reach the side panel", async () => {
  for (const value of [null, {}, { ...valid, pros: {} }, { ...valid, pros: [null] },
    { ...valid, decision_pros: {} }, { ...valid, recommended_dishes: [{ name: "Synthetic dish" }] }]) {
    const analyze = apiWithResponse({ ok: true, json: async () => value });
    await assert.rejects(analyze(request), { message: "分析服務回傳了無法讀取的結果。" });
  }

  const analyze = apiWithResponse({ ok: true, json: async () => { throw new SyntaxError("Synthetic raw response"); } });
  await assert.rejects(analyze(request), { message: "分析服務回傳了無法讀取的結果。" });
});

test("preserves the structured API error message on an unsuccessful response", async () => {
  const analyze = apiWithResponse({ ok: false, status: 429, json: async () => ({
    detail: { code: "RATE_LIMIT_EXCEEDED", message: "Please try again later." },
  }) });
  await assert.rejects(analyze(request), { message: "Please try again later." });
});
