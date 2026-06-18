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

  return { analyze, semanticBands, quantile, sliceByRange, movingAverage, resampleSeries, alignPrevious, hasSeries, calculateDcaLevels, calculateTracking };
});
