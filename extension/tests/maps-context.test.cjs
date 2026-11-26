const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const {
  previousPlace, selectedPlace, placePath, observedDualPlaceUrl, dualPlaceUrl,
  hotpotPlace, hotpotOverviewUrl, hotpotReviewsUrl,
} = require("./maps-url-fixtures.cjs");

const scope = { exports: {}, URL };
const source = fs.readFileSync(path.join(__dirname, "../src/maps-context.ts"), "utf8");
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, scope);
const { getMapsPlaceId } = scope.exports;

test("reads a single Place ID from an approved Maps /place/ pathname", () => {
  assert.equal(getMapsPlaceId(placePath + "/data=!4m3!3m2!1s" + selectedPlace + "!16s%2Fg"), selectedPlace);
  assert.equal(getMapsPlaceId(placePath + "/data=!1s" + selectedPlace.toUpperCase()), selectedPlace);
});

test("selects IDK Café from the observed dual-place SPA URL instead of the previous place", () => {
  assert.equal(getMapsPlaceId(observedDualPlaceUrl), selectedPlace);
  assert.equal(getMapsPlaceId(observedDualPlaceUrl + "!8m2!3d25.05!4d121.53"), selectedPlace);
});

test("resolves the same selected place in the reported overview and reviews URL data", () => {
  assert.equal(getMapsPlaceId(hotpotOverviewUrl), hotpotPlace);
  assert.equal(getMapsPlaceId(hotpotReviewsUrl), hotpotPlace);
});

test("resolves identity from field paths instead of token position or group length", () => {
  const data = `!4m9!3m3!8m1!3d25.05!1s${selectedPlace}!1m4!3m3!1s${previousPlace}!9m1!1b1`;
  assert.equal(getMapsPlaceId(placePath + "/data=" + data), selectedPlace);
  assert.equal(getMapsPlaceId(placePath + "/data=!3m1!5s" + previousPlace), null);
});

test("does not select the last ID in unrecognized or ambiguous layouts", () => {
  const thirdPlace = "0x5:0x6";
  assert.equal(getMapsPlaceId(placePath + "/data=!1s" + previousPlace + "!1s" + selectedPlace), null);
  assert.equal(getMapsPlaceId(placePath + "/data=!1s" + previousPlace + "!3m5!1s" + selectedPlace), null);
  assert.equal(getMapsPlaceId(observedDualPlaceUrl + "!3m5!1s" + thirdPlace), null);
  assert.equal(getMapsPlaceId(observedDualPlaceUrl + "!1s" + thirdPlace), null);
  assert.equal(getMapsPlaceId(placePath + `/data=!4m4!1m3!3m2!1s${previousPlace}!16s%2Fg`), null);
  assert.equal(getMapsPlaceId(placePath + `/data=!4m4!3m1!1s${selectedPlace}!3m1!1s${thirdPlace}`), null);
  const separateScopes = observedDualPlaceUrl.replace("!4m16", "!4m10").replace("!3m5", "!4m6!3m5");
  assert.equal(getMapsPlaceId(separateScopes), null);
  assert.equal(getMapsPlaceId(observedDualPlaceUrl.replace("!1m9", "!2m9")), null);
  assert.equal(getMapsPlaceId(placePath + `/data=!1m9!3m8!1s${previousPlace}!3m5!1s${selectedPlace}`), null);
  assert.equal(getMapsPlaceId(observedDualPlaceUrl.replace("!4m16", "!4m9")), null);
  assert.equal(getMapsPlaceId(observedDualPlaceUrl.replace("!4m16", "!4m17")), null);
});

test("ignores review, sorting, scroll and query/fragment changes outside the identity fields", () => {
  const base = observedDualPlaceUrl.replace("/data=", "/@25.05,121.53,17z/data=");
  assert.equal(getMapsPlaceId(base + "!9m1!1b1?sort=newest&entry=ttu"), selectedPlace);
  assert.equal(getMapsPlaceId(dualPlaceUrl(previousPlace, selectedPlace, { reviews: true }) + "?sort=newest"), selectedPlace);
  assert.equal(getMapsPlaceId(observedDualPlaceUrl + "?extra=!1s0x7:0x8#scroll=!1s0x9:0xa"), selectedPlace);
  assert.equal(getMapsPlaceId(placePath + "?data=!1s" + previousPlace), null);
  assert.equal(getMapsPlaceId("https://www.google.com/maps/search/test/data=!1s" + previousPlace), null);
  assert.equal(getMapsPlaceId("not a URL"), null);
});
