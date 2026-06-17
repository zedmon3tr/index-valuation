const assert = require("assert");
const Core = require("../valuation-core");

function approxEqual(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.000001, `${message}: expected ${expected}, got ${actual}`);
}

{
  const levels = Core.calculateDcaLevels({ initialPrice: 1, count: 3, dropPct: 4 });
  assert.strictEqual(levels.length, 3);
  assert.strictEqual(levels[0].round, 1);
  approxEqual(levels[0].price, 1, "first level keeps initial price");
  approxEqual(levels[1].price, 0.96, "second level drops 4 percent");
  approxEqual(levels[2].price, 0.9216, "third level compounds from previous level");
  approxEqual(levels[2].dropFromInitialPct, 7.84, "drop from initial is cumulative");
}

{
  const levels = Core.calculateDcaLevels({ initialPrice: 3000, count: 2, dropPct: 5 });
  assert.deepStrictEqual(
    levels.map((level) => level.price),
    [3000, 2850]
  );
}

{
  const levels = Core.calculateDcaLevels({ initialPrice: 100, count: 1000, dropPct: 4 });
  assert.strictEqual(levels.length, 60);
}

{
  assert.deepStrictEqual(Core.calculateDcaLevels({ initialPrice: "", count: 10, dropPct: 4 }), []);
  assert.deepStrictEqual(Core.calculateDcaLevels({ initialPrice: 100, count: 0, dropPct: 4 }), []);
  assert.deepStrictEqual(Core.calculateDcaLevels({ initialPrice: 100, count: 10, dropPct: 100 }), []);
}

console.log("valuation-core tests passed");
