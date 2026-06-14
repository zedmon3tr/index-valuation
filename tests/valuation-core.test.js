const test = require("node:test");
const assert = require("node:assert/strict");

const Core = require("../valuation-core.js");

test("analyze returns percentile thresholds and standard deviation bands", () => {
  const stats = Core.analyze([1, 2, 3, 4, 5]);
  assert.equal(stats.current, 5);
  assert.equal(stats.percentile, 100);
  assert.equal(stats.median, 3);
  assert.equal(stats.chance, 1.8);
  assert.equal(stats.danger, 4.2);
  assert.equal(stats.stdUpper, stats.mean + stats.std);
  assert.equal(stats.stdLower, stats.mean - stats.std);
});

test("semanticBands reverses chance and danger for metrics where higher is better", () => {
  const stats = Core.analyze([1, 2, 3, 4, 5]);
  assert.deepEqual(Core.semanticBands(stats, false), {
    danger: stats.danger,
    chance: stats.chance,
  });
  assert.deepEqual(Core.semanticBands(stats, true), {
    danger: stats.chance,
    chance: stats.danger,
  });
});

test("sliceByRange filters from the supplied clock instead of the machine clock", () => {
  const result = Core.sliceByRange(
    ["2024-01-01", "2025-07-01", "2026-06-01"],
    [1, 2, 3],
    { range: "1Y", now: "2026-06-14" },
  );
  assert.deepEqual(result, { dates: ["2025-07-01", "2026-06-01"], values: [2, 3] });
});

test("sliceByRange honors an inclusive custom date interval", () => {
  const result = Core.sliceByRange(
    ["2024-01-01", "2024-06-01", "2025-01-01"],
    [1, 2, 3],
    { range: "CUSTOM", customStart: "2024-03-01", customEnd: "2024-12-31" },
  );
  assert.deepEqual(result, { dates: ["2024-06-01"], values: [2] });
});

test("movingAverage leaves leading positions empty and averages complete windows", () => {
  assert.deepEqual(Core.movingAverage([1, 2, null, 4, 5], 2), [null, 1.5, null, null, 4.5]);
});

test("resampleSeries keeps the last observation in each week or month", () => {
  const dates = ["2026-01-01", "2026-01-02", "2026-01-08", "2026-02-02"];
  const values = [1, 2, 3, 4];
  assert.deepEqual(Core.resampleSeries(dates, values, "W"), {
    dates: ["2026-01-02", "2026-01-08", "2026-02-02"],
    values: [2, 3, 4],
  });
  assert.deepEqual(Core.resampleSeries(dates, values, "M"), {
    dates: ["2026-01-08", "2026-02-02"],
    values: [3, 4],
  });
});

test("alignToDates aligns exact trading dates without inventing values", () => {
  assert.deepEqual(
    Core.alignToDates(
      ["2026-01-01", "2026-01-02", "2026-01-03"],
      ["2026-01-02", "2026-01-03"],
      [20, 30],
    ),
    [null, 20, 30],
  );
});

test("alignPrevious maps non-trading dates to the latest earlier observation", () => {
  assert.deepEqual(
    Core.alignPrevious(
      ["2026-01-03", "2026-01-31", "2026-02-01"],
      ["2026-01-02", "2026-01-30", "2026-02-02"],
      [10, 20, 30],
    ),
    [10, 20, 20],
  );
});
