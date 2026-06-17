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
    const below = sorted.filter((value) => value <= current).length;
    return {
      current,
      percentile: (below / clean.length) * 100,
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
    const buckets = new Map();
    dates.forEach((date, index) => {
      const value = values[index];
      if (!date || value == null || !Number.isFinite(Number(value))) return;
      buckets.set(periodKey(date, period), { date, value: Number(value) });
    });
    const selected = [...buckets.values()];
    return { dates: selected.map((item) => item.date), values: selected.map((item) => item.value) };
  }

  function alignToDates(targetDates, sourceDates, sourceValues) {
    const lookup = new Map(sourceDates.map((date, index) => [date, sourceValues[index]]));
    return targetDates.map((date) => {
      const value = lookup.get(date);
      return value == null || !Number.isFinite(Number(value)) ? null : Number(value);
    });
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

  return { analyze, semanticBands, quantile, sliceByRange, movingAverage, resampleSeries, alignToDates, alignPrevious, hasSeries, calculateDcaLevels };
});
