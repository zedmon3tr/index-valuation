const assert = require("assert");
const Core = require("../valuation-core");

function approxEqual(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.000001, `${message}: expected ${expected}, got ${actual}`);
}

/* ---------- calculateDcaLevels ---------- */
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
  assert.deepStrictEqual(levels.map((level) => level.price), [3000, 2850]);
}
{
  const levels = Core.calculateDcaLevels({ initialPrice: 100, count: 1000, dropPct: 4 });
  assert.strictEqual(levels.length, 60);
}
{
  assert.deepStrictEqual(Core.calculateDcaLevels({ initialPrice: "", count: 10, dropPct: 4 }), []);
  assert.deepStrictEqual(Core.calculateDcaLevels({ initialPrice: 100, count: 0, dropPct: 4 }), []);
  assert.deepStrictEqual(Core.calculateDcaLevels({ initialPrice: 100, count: 10, dropPct: 100 }), []);
  // 数字或 null 都应安全（详情页定投 state 现统一存数字/null）
  assert.deepStrictEqual(Core.calculateDcaLevels({ initialPrice: null, count: 10, dropPct: 4 }), []);
  assert.deepStrictEqual(Core.calculateDcaLevels({ initialPrice: 100, count: null, dropPct: 4 }), []);
}

/* ---------- analyze ---------- */
{
  const s = Core.analyze([5, 4, 3, 2, 1]); // current = 最后一个 = 1（最小）
  approxEqual(s.current, 1, "current 取输入末值，而非排序后");
  approxEqual(s.min, 1, "min");
  approxEqual(s.max, 5, "max");
  approxEqual(s.median, 3, "median = quantile 0.5");
  approxEqual(s.mean, 3, "mean");
  approxEqual(s.percentile, 10, "mid-rank：(0 + 1/2)/5 = 10%");
}
{
  // 并列值：mid-rank 不再把等于当前值的样本全算进“低于”
  const s = Core.analyze([10, 10, 10, 20, 20]); // current = 20
  approxEqual(s.percentile, 80, "mid-rank 并列：(3 + 2/2)/5 = 80%（旧 `<=` 会得 100%）");
}
{
  assert.strictEqual(Core.analyze([]), null, "空序列返回 null");
  const s = Core.analyze([null, 7, NaN, 7]); // 过滤非有限值后 [7,7]，current=7
  approxEqual(s.percentile, 50, "全相等：(0 + 2/2)/2 = 50%");
  approxEqual(s.std, 0, "全相等标准差为 0");
  approxEqual(s.z, 0, "std=0 时 z 兜底为 0");
}

/* ---------- quantile ---------- */
{
  approxEqual(Core.quantile([1, 2, 3, 4, 5], 0.5), 3, "奇数个取中位");
  approxEqual(Core.quantile([1, 2, 3, 4], 0.5), 2.5, "偶数个线性插值");
  approxEqual(Core.quantile([1, 2, 3, 4, 5], 0.2), 1.8, "20 分位插值");
  assert.strictEqual(Core.quantile([], 0.5), null, "空数组返回 null");
}

/* ---------- sliceByRange ---------- */
{
  const dates = ["2020-01-01", "2021-01-01", "2022-01-01"];
  const values = [1, 2, 3];
  const all = Core.sliceByRange(dates, values, { range: "ALL" });
  assert.deepStrictEqual(all.dates, dates, "ALL 保留全部");
  const custom = Core.sliceByRange(dates, values, { range: "CUSTOM", customStart: "2020-06-01", customEnd: "2021-06-01" });
  assert.deepStrictEqual(custom.dates, ["2021-01-01"], "CUSTOM 区间过滤");
  assert.deepStrictEqual(custom.values, [2], "CUSTOM 值跟随");
  const withNull = Core.sliceByRange(["2020-01-01", "2020-01-02"], [null, 5], { range: "ALL" });
  assert.deepStrictEqual(withNull.values, [5], "null 值被剔除");
}
{
  // 相对区间按 now 截断
  const dates = ["2024-01-01", "2025-06-01", "2026-06-01"];
  const values = [1, 2, 3];
  // now-365d = 2025-06-18，故 2025-06-01 落在窗口外，仅 2026-06-01 入选
  const oneY = Core.sliceByRange(dates, values, { range: "1Y", now: "2026-06-18" });
  assert.deepStrictEqual(oneY.dates, ["2026-06-01"], "1Y 截近一年（365 天）");
}

/* ---------- resampleSeries ---------- */
{
  const day = Core.resampleSeries(["2021-01-01"], [1], "D");
  assert.deepStrictEqual(day.values, [1], "D 周期原样返回");
  const monthly = Core.resampleSeries(
    ["2021-01-05", "2021-01-20", "2021-02-10"], [1, 2, 3], "M"
  );
  assert.deepStrictEqual(monthly.dates, ["2021-01-20", "2021-02-10"], "月内取最晚交易日");
  assert.deepStrictEqual(monthly.values, [2, 3], "月内取该日的值");
  // 乱序输入也应得到同样（升序）结果——#9 排序契约
  const unordered = Core.resampleSeries(
    ["2021-02-10", "2021-01-20", "2021-01-05"], [3, 2, 1], "M"
  );
  assert.deepStrictEqual(unordered.dates, ["2021-01-20", "2021-02-10"], "乱序输入排序后分桶");
  assert.deepStrictEqual(unordered.values, [2, 3], "乱序输入取值正确");
}

/* ---------- alignPrevious ---------- */
{
  const out = Core.alignPrevious(
    ["2020-12-31", "2021-01-01", "2021-01-02", "2021-01-03"],
    ["2021-01-01", "2021-01-03"],
    [10, 30]
  );
  assert.deepStrictEqual(out, [null, 10, 10, 30], "首个源日期前为 null，其后前向填充");
}

/* ---------- movingAverage ---------- */
{
  assert.deepStrictEqual(Core.movingAverage([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5], "窗口 2");
  assert.deepStrictEqual(Core.movingAverage([1, 2, 3], 1), [1, 2, 3], "窗口<=1 原样");
  assert.deepStrictEqual(Core.movingAverage([1, null, 3, 4], 2), [null, null, null, 3.5], "窗口含 null 置空");
}

/* ---------- calculateTracking ---------- */
{
  // 构造 8 个交易日，基金与指数收益率完全一致 → 跟踪误差≈0、偏离≈0
  const dates = ["2025-06-02","2025-06-03","2025-06-04","2025-06-05","2025-06-06","2025-06-09","2025-06-10","2025-06-11"];
  const idx  = [100, 101, 102, 101, 103, 104, 103, 105];
  const fund = idx.map((v) => v / 50); // 恒定缩放：每日收益率与指数完全相同
  const r = Core.calculateTracking(dates, fund, dates, idx, { now: "2025-06-11", years: 5 });
  assert.ok(r, "完全同步应返回对象");
  approxEqual(r.annualizedTE, 0, "同步收益率年化跟踪误差≈0");
  approxEqual(r.deviation, 0, "同步累计偏离≈0");
  assert.strictEqual(r.n, 7, "8 点 → 7 个日收益率差");
}
{
  // 基金每日比指数多涨/少涨制造波动 → 跟踪误差 > 0
  const dates = ["2025-06-02","2025-06-03","2025-06-04","2025-06-05"];
  const idx  = [100, 110, 121, 133.1];          // 每日 +10%
  const fund = [1.0, 1.0, 1.21, 1.21];          // 收益率 0%,0%,+21%,0% → 与指数差异大
  const r = Core.calculateTracking(dates, fund, dates, idx, { now: "2025-06-05", years: 5 });
  assert.ok(r.annualizedTE > 0, "不同步应有正跟踪误差");
}
{
  // 日期部分错位：只取交集
  const fundDates = ["2025-06-02","2025-06-03","2025-06-04","2025-06-05"];
  const fundNav   = [1, 1.01, 1.02, 1.03];
  const idxDates  = ["2025-06-03","2025-06-04","2025-06-05","2025-06-06"];
  const idxClose  = [200, 202, 204, 206];
  const r = Core.calculateTracking(fundDates, fundNav, idxDates, idxClose, { now: "2025-06-06", years: 5 });
  assert.strictEqual(r.n, 2, "交集 3 个交易日 → 2 个日收益率差");
}
{
  // 含 null / NaN / 0：剔除非法点，不产生 NaN
  const dates = ["2025-06-02","2025-06-03","2025-06-04","2025-06-05"];
  const r = Core.calculateTracking(dates, [1, null, 1.02, 1.03], dates, [100, 101, NaN, 103], { now: "2025-06-05", years: 5 });
  assert.ok(r === null || Number.isFinite(r.annualizedTE), "含非法值不得产生 NaN");
}
{
  // 不足 2 个交集点 → null
  assert.strictEqual(Core.calculateTracking(["2025-06-02"], [1], ["2025-06-02"], [100], { now: "2025-06-02", years: 5 }), null, "单点 → null");
  assert.strictEqual(Core.calculateTracking([], [], [], [], {}), null, "空序列 → null");
  assert.strictEqual(Core.calculateTracking(undefined, undefined, undefined, undefined, {}), null, "undefined 入参 → null");
}
{
  // years 窗口早于数据范围 → 用可得最早点，仍有限
  const dates = ["2025-06-02","2025-06-03","2025-06-04"];
  const r = Core.calculateTracking(dates, [1, 1.01, 1.02], dates, [100, 101, 102], { now: "2025-06-04", years: 10 });
  assert.ok(r && Number.isFinite(r.annualizedTE), "窗口过大仍返回有限值");
}

/* ---------- heatmapColor / heatmapTextColor（只用不透明度区分、红涨绿跌） ---------- */
{
  const parse = (s) => s.match(/[\d.]+/g).map(Number); // [r,g,b,a]
  // 缺失/非法 → 固定淡灰 rgba
  assert.strictEqual(Core.heatmapColor(null), "rgba(150,160,170,0.16)", "null → 缺失灰");
  assert.strictEqual(Core.heatmapColor(NaN), "rgba(150,160,170,0.16)", "NaN → 缺失灰");
  assert.strictEqual(Core.heatmapColor(undefined), "rgba(150,160,170,0.16)", "undefined → 缺失灰");
  // 涨用固定红基色、跌用固定绿基色（RGB 恒定，只有 alpha 变）
  const up = parse(Core.heatmapColor(3)), down = parse(Core.heatmapColor(-3));
  assert.deepStrictEqual(up.slice(0, 3), [224, 82, 74], "涨 → 纯红基色");
  assert.deepStrictEqual(down.slice(0, 3), [42, 171, 107], "跌 → 纯绿基色");
  // 同方向不同幅度：RGB 不变，只有 alpha 变（绝不混色/叠加）
  const weakUp = parse(Core.heatmapColor(0.5)), strongUp = parse(Core.heatmapColor(3.5));
  assert.deepStrictEqual(weakUp.slice(0, 3), strongUp.slice(0, 3), "同向只改 alpha、不改 RGB");
  assert.ok(strongUp[3] > weakUp[3], "涨幅越大越不透明");
  // |pct|≥maxAbs 截断到满档：超过与等于同色（alpha 同为 1.0）
  assert.strictEqual(Core.heatmapColor(50), Core.heatmapColor(4), "涨远超档位 → 截断满档");
  assert.strictEqual(Core.heatmapColor(-50), Core.heatmapColor(-4), "跌远超档位 → 截断满档");
  assert.strictEqual(parse(Core.heatmapColor(50))[3], 1, "满档 alpha = 1");
  // 自定义 maxAbs：+10@max10 与 +4@max4 都是满档 → 同色
  assert.strictEqual(Core.heatmapColor(10, 10), Core.heatmapColor(4, 4), "自定义 maxAbs 满档一致");
  // 文字色随背景深浅自适应：淡格（小波动）用深字、浓格（大波动）用白字
  assert.strictEqual(Core.heatmapTextColor(0.2), "#1f2733", "淡格 → 深色字");
  assert.strictEqual(Core.heatmapTextColor(4), "#ffffff", "满档浓格 → 白字");
  assert.strictEqual(Core.heatmapTextColor(-4), "#ffffff", "满档浓格(跌) → 白字");
  assert.strictEqual(Core.heatmapTextColor(null), "#1f2733", "缺失 → 深色字");
  // 复合基底可传暗色画布（暗色主题）：淡格复合到暗底上整体偏暗 → 白字
  const darkBase = [23, 30, 40];
  assert.strictEqual(Core.heatmapTextColor(0.2, 4, darkBase), "#ffffff", "暗底淡格 → 白字");
  assert.strictEqual(Core.heatmapTextColor(null, 4, darkBase), "#ffffff", "暗底缺失灰 → 白字");
  assert.strictEqual(Core.heatmapTextColor(4, 4, darkBase), "#ffffff", "暗底满档浓格 → 白字");
  assert.strictEqual(Core.heatmapTextColor(0.2, 4, "bogus"), "#1f2733", "非法 base 回退白底行为");
}

/* ---------- ema ---------- */
{
  // N=1 → α=1 → 原样
  assert.deepStrictEqual(Core.ema([1, 2, 3, 4, 5], 1), [1, 2, 3, 4, 5], "N=1 原样");
  // N=3 → α=0.5，首值播种后递推
  const e = Core.ema([1, 2, 3, 4, 5], 3);
  approxEqual(e[0], 1, "EMA 首值=首价");
  approxEqual(e[1], 1.5, "EMA 第二档 .5*2+.5*1");
  approxEqual(e[2], 2.25, "EMA 第三档");
  approxEqual(e[3], 3.125, "EMA 第四档");
  approxEqual(e[4], 4.0625, "EMA 第五档");
  // 前导 null：播种推迟到首个有效值
  const withNull = Core.ema([null, 2, 4], 3);
  assert.strictEqual(withNull[0], null, "首个有效值前为 null");
  approxEqual(withNull[1], 2, "首个有效值播种");
  approxEqual(withNull[2], 3, ".5*4+.5*2");
  // 非法 N → 全 null
  assert.deepStrictEqual(Core.ema([1, 2, 3], 0), [null, null, null], "N<1 全 null");
  assert.deepStrictEqual(Core.ema([1, 2, 3], NaN), [null, null, null], "N 非数 全 null");
}

/* ---------- resampleOhlc ---------- */
{
  const rows = [
    { date: "2021-01-04", open: 10, high: 12, low: 9, close: 11 },
    { date: "2021-01-05", open: 11, high: 15, low: 8, close: 14 },
    { date: "2021-02-01", open: 14, high: 16, low: 13, close: 15 },
  ];
  // D 原样
  assert.deepStrictEqual(Core.resampleOhlc(rows, "D").map((r) => r.date), rows.map((r) => r.date), "D 原样");
  // 月：高=桶内最高、低=桶内最低、close/date=最晚交易日、open=最早
  const monthly = Core.resampleOhlc(rows, "M");
  assert.deepStrictEqual(monthly.map((r) => r.date), ["2021-01-05", "2021-02-01"], "月桶取最晚交易日");
  assert.deepStrictEqual(monthly[0], { date: "2021-01-05", open: 10, high: 15, low: 8, close: 14 }, "1 月桶聚合 high/low/open/close");
  assert.deepStrictEqual(monthly[1], { date: "2021-02-01", open: 14, high: 16, low: 13, close: 15 }, "2 月桶单根");
  // 乱序输入先排序再分桶
  const unordered = Core.resampleOhlc([rows[2], rows[0], rows[1]], "M");
  assert.deepStrictEqual(unordered.map((r) => r.date), ["2021-01-05", "2021-02-01"], "乱序输入排序后分桶");
}

console.log("valuation-core tests passed");
