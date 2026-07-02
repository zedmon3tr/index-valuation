/* =========================================================================
 * i18n —— 站内 UI 文案的中/英字典与翻译函数（纯静态，无外部依赖）。
 * 只翻译界面文案；标的名称（indexes.json / funds.json）与东财返回的数据保持原文。
 * 用法：I18N.t("key") / I18N.t("key", {name: "..."})（{name} 占位插值）。
 * 语言偏好存 localStorage("pref-lang")，默认中文；切换由 app.js 重渲染页面生效。
 * ========================================================================= */
(function (root) {
  "use strict";

  const DICT = {
    zh: {
      /* ---- 全局 ---- */
      "doc.title": "指数估值 · 行情分析",
      "doc.description": "搜索股票指数，查看实时行情与点位、PE、PB、股息率历史分位分析",
      "brand.name": "指数估值",
      "footer.text": "数据来源：东方财富（实时行情/点位）、乐咕乐股 / 中证指数 / 理杏仁（历史 PE/PB/股息率）。本页仅供研究参考，不构成投资建议。",
      "common.loading": "加载中…",
      "theme.toggle": "切换亮色 / 暗色模式",
      "lang.label": "切换语言",

      /* ---- 搜索 ---- */
      "search.placeholder": "搜索指数名称或代码，如 沪深300 / 000300 / 半导体",
      "search.empty": "未找到匹配的指数或基金",
      "search.searching": "搜索中…",
      "type.index": "指数",
      "type.fund": "基金",

      /* ---- 首页 ---- */
      "hero.title": "指数估值 · 行情分析",
      "hero.sub": "搜索任意指数或基金（ETF），查看实时点位、涨跌，以及历史点位 / PE / PB / 股息率分位分析。",
      "home.indices": "全球市场指数",
      "home.funds": "基金 / ETF",
      "home.quoteFailed": "行情加载失败",
      "market.cn": "A股",
      "market.hk": "港股",
      "market.us": "美股",

      /* ---- 热力图 ---- */
      "heat.title": "A股板块热力图",
      "heat.sub": "面积=涨跌幅度（离 0 越远越大）· 颜色=涨跌（红涨绿跌）",
      "heat.dim": "维度",
      "heat.dim.industry": "行业",
      "heat.dim.concept": "主题",
      "heat.filter": "筛选",
      "heat.filter.all": "全部",
      "heat.filter.up": "仅看上涨",
      "heat.filter.down": "仅看下跌",
      "heat.search": "搜索",
      "heat.searchPh": "板块名称",
      "heat.refresh": "刷新",
      "heat.loading": "板块行情加载中…",
      "heat.unavailable": "板块行情接口暂不可用，请稍后刷新重试。",
      "heat.emptyFilter": "没有符合当前筛选条件的板块",
      "heat.foot": "显示 {n}/{total} 个板块 · <span class=\"up\">涨 {up}</span> / <span class=\"down\">跌 {down}</span> · 更新于 {time}",
      "heat.tip.pct": "涨跌幅",
      "heat.tip.price": "点位",
      "heat.tip.cap": "总市值",
      "heat.tip.turnover": "换手",
      "heat.tip.lead": "领涨股",

      /* ---- 详情页工具栏 ---- */
      "toolbar.range": "时间范围",
      "range.1Y": "1年",
      "range.3Y": "3年",
      "range.5Y": "5年",
      "range.10Y": "10年",
      "range.ALL": "上市以来",
      "range.CUSTOM": "自定义",
      "toolbar.period": "周期",
      "period.D": "日",
      "period.W": "周",
      "period.M": "月",
      "toolbar.metric": "估值指标",
      "view.stats": "统计分析",
      "view.table": "明细数据",
      "toggle.quantiles": "分位线",
      "toggle.std": "标准差",
      "toggle.band": "通道带",
      "toolbar.ma": "移动平均",
      "ma.none": "无",
      "ma.n": "{n}期",
      "custom.to": "至",
      "custom.start": "开始日期",
      "custom.end": "结束日期",

      /* ---- 指标 ---- */
      "metric.close.label": "指数点位",
      "metric.close.short": "点位",
      "metric.close.current": "当前点位",
      "metric.pe.label": "市盈率 TTM",
      "metric.pe.short": "市盈率",
      "metric.pe.current": "当前 PE",
      "metric.pb.label": "市净率 LF",
      "metric.pb.short": "市净率",
      "metric.pb.current": "当前 PB",
      "metric.dy.label": "股息率",
      "metric.dy.short": "股息率",
      "metric.dy.current": "当前股息率",
      "metric.noData": "暂无数据",

      /* ---- 详情页 ---- */
      "detail.notFound": "未找到该标的的历史数据，且实时行情接口暂时不可用，请稍后重试。",
      "back.home": "‹ 返回首页",
      "back.list": "‹ 返回指数列表",
      "backLink.home": "返回首页",
      "quote.pending": "实时行情加载中…",
      "quote.unavailable": "行情快照暂不可用",
      "feed.noPoint": "实时行情接口（东方财富）暂时不可用，「指数点位」已置灰，仅展示历史 PE / PB / 股息率分位分析。",
      "feed.fund": "「{name}」是 ETF，下方估值分位 / 机会线基于其跟踪指数 <b>{track}（{code}）</b>；上方为基金自身实时价格。",

      /* ---- 统计概览 ---- */
      "stats.title": "统计概览",
      "stats.empty": "所选区间没有可用数据",
      "stats.percentile": "历史分位",
      "stats.danger": "危险值 ({p}%)",
      "stats.median": "中位数 (50%)",
      "stats.chance": "机会值 ({p}%)",
      "stats.max": "最大值",
      "stats.mean": "平均值",
      "stats.min": "最小值",
      "stats.stdUpper": "标准差 (+1)",
      "stats.stdLower": "标准差 (-1)",
      "stats.std": "标准差",
      "stats.z": "z 分数",

      /* ---- 分位结论 ---- */
      "badge.text": "当前{short} <b style=\"color:{color}\">{verdict}</b> · 历史分位 {p}%",
      "verdict.dy.high": "股息偏高",
      "verdict.dy.low": "股息偏低",
      "verdict.dy.mid": "股息适中",
      "verdict.close.high": "处于历史高位",
      "verdict.close.low": "处于历史低位",
      "verdict.close.mid": "处于历史中位",
      "verdict.val.high": "估值偏高",
      "verdict.val.low": "估值偏低",
      "verdict.val.mid": "估值合理",
      "verdict.tk.high": "偏高估",
      "verdict.tk.low": "偏低估",
      "verdict.tk.mid": "估值合理",

      /* ---- 覆盖与来源 ---- */
      "coverage.range": "{first} 至 {last}",
      "coverage.none": "无数据",
      "source.label": "来源 {s}",
      "source.default": "东方财富",
      "snap.note": "样本 {n} 条 · 实际覆盖 {first} 至 {last} · 分位统计仅基于当前筛选后的有效序列",
      "snap.empty": "所选区间没有有效样本",

      /* ---- 明细表 ---- */
      "table.title": "{label}明细",
      "table.titleDefault": "明细数据",
      "table.count": "{n} 条",
      "table.date": "日期",
      "table.value": "指标值",
      "table.point": "指数点位",
      "table.change": "相对前值",

      /* ---- 定投点位 ---- */
      "dca.title": "定投点位",
      "dca.sub": "按上一次买入点位继续下跌计算",
      "dca.reset": "重置",
      "dca.initial": "初次买入点位",
      "dca.initialPh": "输入点位",
      "dca.count": "定投次数",
      "dca.drop": "每次跌幅",
      "dca.round": "次数",
      "dca.buyLevel": "买入点位",
      "dca.fromPrev": "较上次下跌",
      "dca.fromFirst": "较首次下跌",
      "dca.roundN": "第 {n} 次",
      "dca.empty": "输入初次买入点位后，会自动生成 10 个买入点位。",

      /* ---- 跟踪关联卡片 ---- */
      "tracking.title": "跟踪关联",
      "tracking.loading": "跟踪数据加载中…",
      "tk.index": "追踪指数",
      "tk.valuation": "指数估值",
      "tk.valuationPct": "指数估值 ({kind} 分位 {p})",
      "tk.point": "指数当前点位",
      "tk.premium": "溢价率(实时)",
      "tk.te": "近1年跟踪误差(年化)",
      "tk.teDev": "近1年偏离",
      "tk.snapshot": "快照",
      "tk.na": "暂不可用",
      "tk.insufficient": "数据不足",
      "tk.premiumUp": "溢价 {x}%",
      "tk.premiumDown": "折价 {x}%",

      /* ---- 图表 ---- */
      "chart.loading": "图表组件加载中…",
      "chart.failed": "图表组件加载失败，统计分析与明细数据仍可查看。",
      "chart.failedShort": "图表组件加载失败",
      "chart.noK": "暂无 K 线数据",
      "mark.danger": "危险",
      "mark.median": "中位",
      "mark.chance": "机会",

      /* ---- 板块详情 ---- */
      "board.notFound": "未找到该板块的行情数据，请稍后重试。",
      "board.turnover": "换手率",
      "board.cap": "总市值",
      "board.inflow": "主力净流入",
      "board.updown": "涨跌家数",
      "board.lead": "领涨股",
      "board.chart": "板块走势（日K）",
    },

    en: {
      /* ---- Global ---- */
      "doc.title": "Index Valuation · Market Analysis",
      "doc.description": "Search stock indices; view real-time quotes and historical percentile analysis of level, PE, PB, and dividend yield",
      "brand.name": "Index Valuation",
      "footer.text": "Data sources: Eastmoney (real-time quotes / levels); Legulegu / CSI / Lixinger (historical PE / PB / dividend yield). For research only — not investment advice.",
      "common.loading": "Loading…",
      "theme.toggle": "Toggle light / dark mode",
      "lang.label": "Switch language",

      /* ---- Search ---- */
      "search.placeholder": "Search index name or code, e.g. CSI 300 / 000300",
      "search.empty": "No matching index or fund",
      "search.searching": "Searching…",
      "type.index": "Index",
      "type.fund": "Fund",

      /* ---- Home ---- */
      "hero.title": "Index Valuation · Market Analysis",
      "hero.sub": "Search any index or fund (ETF) to view real-time levels and historical percentile analysis of level / PE / PB / dividend yield.",
      "home.indices": "Global Market Indices",
      "home.funds": "Funds / ETFs",
      "home.quoteFailed": "Failed to load quotes",
      "market.cn": "CN",
      "market.hk": "HK",
      "market.us": "US",

      /* ---- Heatmap ---- */
      "heat.title": "A-share Sector Heatmap",
      "heat.sub": "Area = |% change| · Color = direction (red up, green down)",
      "heat.dim": "Dimension",
      "heat.dim.industry": "Industry",
      "heat.dim.concept": "Theme",
      "heat.filter": "Filter",
      "heat.filter.all": "All",
      "heat.filter.up": "Gainers",
      "heat.filter.down": "Losers",
      "heat.search": "Search",
      "heat.searchPh": "Sector name",
      "heat.refresh": "Refresh",
      "heat.loading": "Loading sector data…",
      "heat.unavailable": "Sector data is temporarily unavailable. Please refresh later.",
      "heat.emptyFilter": "No sectors match the current filter",
      "heat.foot": "Showing {n}/{total} sectors · <span class=\"up\">{up} up</span> / <span class=\"down\">{down} down</span> · Updated {time}",
      "heat.tip.pct": "Change",
      "heat.tip.price": "Level",
      "heat.tip.cap": "Market cap",
      "heat.tip.turnover": "Turnover",
      "heat.tip.lead": "Top gainer",

      /* ---- Detail toolbar ---- */
      "toolbar.range": "Range",
      "range.1Y": "1Y",
      "range.3Y": "3Y",
      "range.5Y": "5Y",
      "range.10Y": "10Y",
      "range.ALL": "All",
      "range.CUSTOM": "Custom",
      "toolbar.period": "Period",
      "period.D": "Daily",
      "period.W": "Weekly",
      "period.M": "Monthly",
      "toolbar.metric": "Metric",
      "view.stats": "Statistics",
      "view.table": "Data table",
      "toggle.quantiles": "Quantiles",
      "toggle.std": "Std dev",
      "toggle.band": "Channels",
      "toolbar.ma": "Moving avg",
      "ma.none": "None",
      "ma.n": "{n}",
      "custom.to": "to",
      "custom.start": "Start date",
      "custom.end": "End date",

      /* ---- Metrics ---- */
      "metric.close.label": "Index level",
      "metric.close.short": "Level",
      "metric.close.current": "Current level",
      "metric.pe.label": "PE (TTM)",
      "metric.pe.short": "PE",
      "metric.pe.current": "Current PE",
      "metric.pb.label": "PB (LF)",
      "metric.pb.short": "PB",
      "metric.pb.current": "Current PB",
      "metric.dy.label": "Dividend yield",
      "metric.dy.short": "Div. yield",
      "metric.dy.current": "Current yield",
      "metric.noData": "No data",

      /* ---- Detail page ---- */
      "detail.notFound": "No historical data found for this instrument and the real-time quote API is unavailable. Please try again later.",
      "back.home": "‹ Back to home",
      "back.list": "‹ Back to indices",
      "backLink.home": "Back to home",
      "quote.pending": "Loading real-time quote…",
      "quote.unavailable": "Quote snapshot unavailable",
      "feed.noPoint": "Real-time quotes (Eastmoney) are temporarily unavailable. “Index level” is disabled; only historical PE / PB / dividend-yield percentiles are shown.",
      "feed.fund": "“{name}” is an ETF. Valuation percentiles below are based on its tracked index <b>{track} ({code})</b>; the price above is the fund's own.",

      /* ---- Stats ---- */
      "stats.title": "Statistics",
      "stats.empty": "No data available in the selected range",
      "stats.percentile": "Percentile",
      "stats.danger": "Danger ({p}%)",
      "stats.median": "Median (50%)",
      "stats.chance": "Opportunity ({p}%)",
      "stats.max": "Max",
      "stats.mean": "Mean",
      "stats.min": "Min",
      "stats.stdUpper": "Std dev (+1)",
      "stats.stdLower": "Std dev (-1)",
      "stats.std": "Std dev",
      "stats.z": "z-score",

      /* ---- Verdicts ---- */
      "badge.text": "{short}: <b style=\"color:{color}\">{verdict}</b> · percentile {p}%",
      "verdict.dy.high": "high yield",
      "verdict.dy.low": "low yield",
      "verdict.dy.mid": "moderate yield",
      "verdict.close.high": "near historical high",
      "verdict.close.low": "near historical low",
      "verdict.close.mid": "in historical mid-range",
      "verdict.val.high": "overvalued",
      "verdict.val.low": "undervalued",
      "verdict.val.mid": "fairly valued",
      "verdict.tk.high": "Overvalued",
      "verdict.tk.low": "Undervalued",
      "verdict.tk.mid": "Fairly valued",

      /* ---- Coverage / source ---- */
      "coverage.range": "{first} – {last}",
      "coverage.none": "No data",
      "source.label": "Source: {s}",
      "source.default": "Eastmoney",
      "snap.note": "{n} samples · coverage {first} – {last} · percentiles computed on the filtered series only",
      "snap.empty": "No valid samples in the selected range",

      /* ---- Data table ---- */
      "table.title": "{label} details",
      "table.titleDefault": "Data table",
      "table.count": "{n} rows",
      "table.date": "Date",
      "table.value": "Value",
      "table.point": "Index level",
      "table.change": "vs prev",

      /* ---- DCA ---- */
      "dca.title": "DCA Levels",
      "dca.sub": "Each level drops from the previous buy level",
      "dca.reset": "Reset",
      "dca.initial": "First buy level",
      "dca.initialPh": "Enter level",
      "dca.count": "Number of buys",
      "dca.drop": "Drop per step",
      "dca.round": "Round",
      "dca.buyLevel": "Buy level",
      "dca.fromPrev": "vs previous",
      "dca.fromFirst": "vs first",
      "dca.roundN": "#{n}",
      "dca.empty": "Enter the first buy level to generate 10 buy levels automatically.",

      /* ---- Tracking card ---- */
      "tracking.title": "Tracking",
      "tracking.loading": "Loading tracking data…",
      "tk.index": "Tracked index",
      "tk.valuation": "Index valuation",
      "tk.valuationPct": "Index valuation ({kind} pct {p})",
      "tk.point": "Index level",
      "tk.premium": "Premium (live)",
      "tk.te": "1Y tracking error (ann.)",
      "tk.teDev": "1Y deviation",
      "tk.snapshot": "snapshot",
      "tk.na": "N/A",
      "tk.insufficient": "Insufficient data",
      "tk.premiumUp": "Premium {x}%",
      "tk.premiumDown": "Discount {x}%",

      /* ---- Chart ---- */
      "chart.loading": "Chart library loading…",
      "chart.failed": "Chart library failed to load; statistics and the data table are still available.",
      "chart.failedShort": "Chart library failed to load",
      "chart.noK": "No K-line data",
      "mark.danger": "Danger",
      "mark.median": "Median",
      "mark.chance": "Opportunity",

      /* ---- Sector detail ---- */
      "board.notFound": "No market data found for this sector. Please try again later.",
      "board.turnover": "Turnover",
      "board.cap": "Market cap",
      "board.inflow": "Net inflow",
      "board.updown": "Advancers / Decliners",
      "board.lead": "Top gainer",
      "board.chart": "Sector trend (daily)",
    },
  };

  const STORAGE_KEY = "pref-lang";
  let lang = "zh";
  try { if (localStorage.getItem(STORAGE_KEY) === "en") lang = "en"; } catch (e) { /* 隐私模式等场景忽略 */ }

  // t(key, vars)：取当前语言文案，缺失回退中文再回退 key 本身；{name} 形式占位插值。
  function t(key, vars) {
    let s = DICT[lang][key];
    if (s == null) s = DICT.zh[key];
    if (s == null) return key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
    return s;
  }

  function setLang(next) {
    lang = next === "en" ? "en" : "zh";
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
  }

  root.I18N = { t, setLang, get lang() { return lang; } };
})(window);
