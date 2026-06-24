(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ValuationCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const RANGE_DAYS = { "1Y": 365, "3Y": 365 * 3, "5Y": 365 * 5, "10Y": 365 * 10 };

  function finiteValues(values) {
    return values.filter((value) => value != null && Number.isFinite(Number(value))).map(Number);
  }

  function quantile(sortedAsc, percentile) {
    if (!sortedAsc.length) return null;
    const index = (sortedAsc.length - 1) * percentile;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sortedAsc[lower];
    return sortedAsc[lower] + (sortedAsc[upper] - sortedAsc[lower]) * (index - lower);
  }

  function analyze(values) {
    const clean = finiteValues(values);
    if (!clean.length) return null;
    const sorted = [...clean].sort((a, b) => a - b);
    const current = clean[clean.length - 1];
    const mean = clean.reduce((sum, value) => sum + value, 0) / clean.length;
    const std = Math.sqrt(clean.reduce((sum, value) => sum + (value - mean) ** 2, 0) / clean.length);
    // 分位用 mid-rank（并列值各算半个），避免 `<= current` 把所有等于当前值的样本都计入
    // “低于”而高估分位，并与下面 quantile(线性插值) 的危险/中位/机会值口径保持自洽。
    const below = sorted.filter((value) => value < current).length;
    const equal = sorted.filter((value) => value === current).length;
    return {
      current,
      percentile: ((below + equal / 2) / clean.length) * 100,
      danger: quantile(sorted, 0.8),
      median: quantile(sorted, 0.5),
      chance: quantile(sorted, 0.2),
      max: sorted[sorted.length - 1],
      min: sorted[0],
      mean,
      std,
      stdUpper: mean + std,
      stdLower: mean - std,
      z: std ? (current - mean) / std : 0,
    };
  }

  function semanticBands(stats, higherIsBetter = false) {
    if (!stats) return null;
    return higherIsBetter
      ? { danger: stats.chance, chance: stats.danger }
      : { danger: stats.danger, chance: stats.chance };
  }

  function sliceByRange(dates, values, options = {}) {
    const pairs = dates
      .map((date, index) => ({ date, value: values[index] }))
      .filter((item) => item.date && item.value != null && Number.isFinite(Number(item.value)));
    const range = options.range || "ALL";
    let start = null;
    let end = null;
    if (range === "CUSTOM") {
      start = options.customStart || null;
      end = options.customEnd || null;
    } else if (RANGE_DAYS[range]) {
      const now = new Date(options.now || Date.now());
      start = new Date(now.getTime() - RANGE_DAYS[range] * 86400000).toISOString().slice(0, 10);
    }
    const selected = pairs.filter((item) => (!start || item.date >= start) && (!end || item.date <= end));
    return {
      dates: selected.map((item) => item.date),
      values: selected.map((item) => Number(item.value)),
    };
  }

  function movingAverage(values, windowSize) {
    const size = Number(windowSize);
    if (!Number.isInteger(size) || size <= 1) return values.map((value) => value == null ? null : Number(value));
    return values.map((_, index) => {
      if (index < size - 1) return null;
      const window = values.slice(index - size + 1, index + 1);
      if (window.some((value) => value == null || !Number.isFinite(Number(value)))) return null;
      return window.reduce((sum, value) => sum + Number(value), 0) / size;
    });
  }

  function periodKey(date, period) {
    if (period === "M") return date.slice(0, 7);
    if (period !== "W") return date;
    const current = new Date(date + "T00:00:00Z");
    const day = current.getUTCDay() || 7;
    current.setUTCDate(current.getUTCDate() - day + 1);
    return current.toISOString().slice(0, 10);
  }

  function resampleSeries(dates, values, period = "D") {
    if (period === "D") return { dates: [...dates], values: [...values] };
    // 先按日期升序，再分桶——同桶取“最后写入”即该周/月内最晚交易日的值；不依赖入参已有序。
    const pairs = dates
      .map((date, index) => ({ date, value: values[index] }))
      .filter((item) => item.date && item.value != null && Number.isFinite(Number(item.value)))
      .sort((a, b) => a.date.localeCompare(b.date));
    const buckets = new Map();
    pairs.forEach((item) => buckets.set(periodKey(item.date, period), { date: item.date, value: Number(item.value) }));
    const selected = [...buckets.values()];
    return { dates: selected.map((item) => item.date), values: selected.map((item) => item.value) };
  }

  function alignPrevious(targetDates, sourceDates, sourceValues) {
    const source = sourceDates
      .map((date, index) => ({ date, value: sourceValues[index] }))
      .filter((item) => item.date && item.value != null && Number.isFinite(Number(item.value)))
      .sort((a, b) => a.date.localeCompare(b.date));
    let index = 0;
    let latest = null;
    return targetDates.map((targetDate) => {
      while (index < source.length && source[index].date <= targetDate) {
        latest = Number(source[index].value);
        index += 1;
      }
      return latest;
    });
  }

  function hasSeries(values, minimum = 1) {
    return Array.isArray(values) && finiteValues(values).length >= minimum;
  }

  function calculateDcaLevels(options = {}) {
    const initialPrice = Number(options.initialPrice);
    const maxCount = Number.isFinite(Number(options.maxCount)) ? Math.max(1, Math.floor(Number(options.maxCount))) : 60;
    const count = Math.min(Math.floor(Number(options.count)), maxCount);
    const dropPct = Number(options.dropPct);
    if (!Number.isFinite(initialPrice) || initialPrice <= 0) return [];
    if (!Number.isInteger(count) || count <= 0) return [];
    if (!Number.isFinite(dropPct) || dropPct <= 0 || dropPct >= 100) return [];
    return Array.from({ length: count }, (_, index) => {
      const price = initialPrice * (1 - dropPct / 100) ** index;
      return {
        round: index + 1,
        price,
        dropFromPreviousPct: index === 0 ? 0 : dropPct,
        dropFromInitialPct: ((initialPrice - price) / initialPrice) * 100,
      };
    });
  }

  const ANNUAL_FACTOR = 242; // A股年均交易日，用于跟踪误差年化

  // 基金净值序列与指数 close 序列对齐后，计算近 years 年的年化跟踪误差与累计偏离。
  // 任何数据不足（交集<2、全空）一律返回 null，绝不抛错或产生 NaN。
  function calculateTracking(fundDates, fundNav, indexDates, indexClose, options) {
    const opts = options || {};
    const years = opts.years != null ? Number(opts.years) : 1;
    if (!Array.isArray(fundDates) || !Array.isArray(fundNav) || !Array.isArray(indexDates) || !Array.isArray(indexClose)) return null;

    const fundMap = new Map();
    fundDates.forEach((d, i) => {
      const v = Number(fundNav[i]);
      if (d && fundNav[i] != null && Number.isFinite(v) && v > 0) fundMap.set(d, v);
    });
    const pairs = [];
    indexDates.forEach((d, i) => {
      const c = Number(indexClose[i]);
      if (d && indexClose[i] != null && Number.isFinite(c) && c > 0 && fundMap.has(d)) {
        pairs.push({ date: d, fund: fundMap.get(d), index: c });
      }
    });
    pairs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (pairs.length < 2) return null;

    // 近 years 年窗口；窗口起点早于数据范围则自然退化为全部可得点
    const now = new Date(opts.now || Date.now());
    const startDate = new Date(now.getTime() - years * 365 * 86400000).toISOString().slice(0, 10);
    let windowed = pairs.filter((p) => p.date >= startDate);
    if (windowed.length < 2) windowed = pairs; // 数据比窗口短，用全部
    if (windowed.length < 2) return null;

    const diffs = [];
    for (let i = 1; i < windowed.length; i++) {
      const rFund = windowed[i].fund / windowed[i - 1].fund - 1;
      const rIndex = windowed[i].index / windowed[i - 1].index - 1;
      const d = rFund - rIndex;
      if (Number.isFinite(d)) diffs.push(d);
    }
    if (diffs.length < 2) return null;

    const mean = diffs.reduce((s, v) => s + v, 0) / diffs.length;
    const variance = diffs.reduce((s, v) => s + (v - mean) ** 2, 0) / (diffs.length - 1); // 样本方差 n-1
    const annualizedTE = Math.sqrt(variance) * Math.sqrt(ANNUAL_FACTOR);

    const first = windowed[0], last = windowed[windowed.length - 1];
    const fundReturn = last.fund / first.fund - 1;
    const indexReturn = last.index / first.index - 1;
    const deviation = fundReturn - indexReturn;
    if (![annualizedTE, fundReturn, indexReturn, deviation].every(Number.isFinite)) return null;

    return { annualizedTE, deviation, fundReturn, indexReturn, n: diffs.length };
  }

  // 板块热力图色阶：红涨绿跌。涨跌幅 pct → 单元格填充色。
  // **只用不透明度区分强弱**：单一纯红(涨)/纯绿(跌)，仅按 |pct| 改 alpha——绝不混色、不叠加、
  // 不在通道间插值（那是旧版"脏"的根因）。淡到浓铺在白底上：近 0% 几乎透明、满档为纯色。
  // |pct|≥maxAbs 截断；缺失/非法返回淡灰。配套 heatmapTextColor 据复合后亮度选黑/白字保证可读。
  const HEAT_UP_RGB = [224, 82, 74];    // 红涨（与 --up #e0524a 同源）
  const HEAT_DOWN_RGB = [42, 171, 107]; // 绿跌（与 --down #2bab6b 同源）
  const HEAT_MISSING = "rgba(150,160,170,0.16)";
  function heatAlpha(pct, span) {
    const t = Math.min(Math.abs(Number(pct)) / span, 1); // 强度 0..1（满档截断）
    return 0.16 + 0.84 * t;                              // 近 0 很淡 → 满档不透明
  }
  function heatmapColor(pct, maxAbs = 4) {
    if (pct == null || !Number.isFinite(Number(pct))) return HEAT_MISSING;
    const span = Number(maxAbs) > 0 ? Number(maxAbs) : 4;
    const rgb = Number(pct) >= 0 ? HEAT_UP_RGB : HEAT_DOWN_RGB;
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${heatAlpha(pct, span).toFixed(3)})`;
  }
  // 单元格 = 纯色 over 白底，复合后算感知亮度：淡格（高亮度）用深字、浓格（低亮度）用白字，
  // 解决"特定不透明度背景下文字看不清"的问题。返回十六进制文字色。
  function heatmapTextColor(pct, maxAbs = 4) {
    if (pct == null || !Number.isFinite(Number(pct))) return "#1f2733";
    const span = Number(maxAbs) > 0 ? Number(maxAbs) : 4;
    const rgb = Number(pct) >= 0 ? HEAT_UP_RGB : HEAT_DOWN_RGB;
    const a = heatAlpha(pct, span);
    const lum = [0.299, 0.587, 0.114].reduce((sum, w, i) => sum + w * (rgb[i] * a + 255 * (1 - a)), 0);
    return lum > 150 ? "#1f2733" : "#ffffff";
  }

  return { analyze, semanticBands, quantile, sliceByRange, movingAverage, resampleSeries, alignPrevious, hasSeries, calculateDcaLevels, calculateTracking, heatmapColor, heatmapTextColor };
});
