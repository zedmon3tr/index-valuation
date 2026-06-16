/* =========================================================================
 * 指数估值 · 行情分析  —  纯前端静态站 (GitHub Pages)
 * 行情/点位：东方财富 JSONP 接口（callback 绕过 CORS，实时）
 * 估值 PE/PB/股息率：data/<code>.json（由 GitHub Actions 每日预生成）
 * ========================================================================= */

const Core = window.ValuationCore;

/* ---------- 0. echarts 按需懒加载 ----------
 * echarts.min.js ~1MB，仅详情页画图用。首页不再同步阻塞加载它（见 index.html）。
 * 首次进入详情页时注入 <script>，promise 缓存确保全程只加载一次；后续重绘直接复用
 * 已就绪的全局 echarts。注入失败（网络/CDN 不可用）时 reject，详情页据此降级提示。 */
const ECHARTS_SRC = "https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.0/echarts.min.js";
let echartsPromise = null;
function loadECharts() {
  if (window.echarts) return Promise.resolve(window.echarts);
  if (echartsPromise) return echartsPromise;
  echartsPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = ECHARTS_SRC;
    s.async = true;
    s.onload = () => (window.echarts ? resolve(window.echarts) : reject(new Error("echarts 未就绪")));
    s.onerror = () => { echartsPromise = null; s.remove(); reject(new Error("echarts 加载失败")); };
    document.head.appendChild(s);
  });
  return echartsPromise;
}

/* ---------- 1. 主流指数清单（单一数据源：indexes.json） ----------
 * 首页卡片、本地搜索、以及数据脚本 scripts/build_data.py 都读这份清单。
 * 想增删首页指数，只改 indexes.json 一处即可，前端与数据抓取自动同步。 */
let POPULAR = [];
async function loadIndexes() {
  try {
    const r = await fetch("./indexes.json", { cache: "no-cache" });
    POPULAR = await r.json();
  } catch (e) {
    console.error("加载 indexes.json 失败：", e);
    POPULAR = [];
  }
}

/* ---------- 2. JSONP 工具 ---------- */
function jsonp(url, cbParam = "cb", timeout = 12000) {
  return new Promise((resolve, reject) => {
    const name = "__jp" + Math.random().toString(36).slice(2);
    const sep = url.includes("?") ? "&" : "?";
    const script = document.createElement("script");
    const timer = setTimeout(() => { cleanup(); reject(new Error("timeout")); }, timeout);
    function cleanup() { clearTimeout(timer); try { delete window[name]; } catch (e) { window[name] = undefined; } script.remove(); }
    window[name] = (data) => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error("network")); };
    script.src = url + sep + cbParam + "=" + name;
    document.head.appendChild(script);
  });
}

/* ---------- 3. 东方财富接口封装 ---------- */
const EM = {
  // 批量行情（首页卡片）
  async batchQuote(secids) {
    const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?secids=${secids.join(",")}&fields=f1,f2,f3,f4,f12,f13,f14`;
    const r = await jsonp(url);
    const diff = r && r.data && r.data.diff ? r.data.diff : [];
    const map = {};
    diff.forEach((d) => {
      const scale = Math.pow(10, d.f1 || 2);
      map[d.f13 + "." + d.f12] = {
        name: d.f14,
        price: d.f2 != null && d.f2 !== "-" ? d.f2 / scale : null,
        pct: d.f3 != null && d.f3 !== "-" ? d.f3 / 100 : null,
        chg: d.f4 != null && d.f4 !== "-" ? d.f4 / scale : null,
      };
    });
    return map;
  },

  // 单指数实时快照（含 PE/PB 当前值）
  async quote(secid) {
    const fields = "f43,f44,f45,f46,f57,f58,f59,f60,f86,f162,f167,f168,f169,f170,f171";
    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=${fields}`;
    const r = await jsonp(url);
    const d = r && r.data;
    if (!d) return null;
    const dec = d.f59 != null ? d.f59 : 2;
    const s = Math.pow(10, dec);
    const num = (v, sc = 1) => (v == null || v === "-" ? null : v / sc);
    return {
      code: d.f57, name: d.f58, decimals: dec,
      price: num(d.f43, s), open: num(d.f46, s), high: num(d.f44, s), low: num(d.f45, s), preClose: num(d.f60, s),
      chg: num(d.f169, s), pct: num(d.f170, 100),
      pe: num(d.f162, 100), pb: num(d.f167, 100),
    };
  },

  // 历史 K 线（日线）
  async kline(secid, klt = 101) {
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=${klt}&fqt=0&beg=0&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`;
    const r = await jsonp(url);
    const d = r && r.data;
    if (!d || !d.klines) return null;
    const rows = d.klines.map((line) => {
      const a = line.split(",");
      return { date: a[0], open: +a[1], close: +a[2], high: +a[3], low: +a[4], pct: +a[8] };
    });
    return { code: d.code, name: d.name, rows };
  },

  // 全网搜索回退（东财）。当前只做【指数】展示，故过滤到 SecurityTypeName==="指数"，
  // 屏蔽个股/ETF/基金（深A/沪A/港股/美股/基金等）。要扩展到个股时，把对应类型加进
  // SEARCH_ALLOWED_TYPES 即可，接口结构不变。
  async suggest(kw) {
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(kw)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=15`;
    try {
      const r = await jsonp(url);
      const data = r && r.QuotationCodeTable && r.QuotationCodeTable.Data ? r.QuotationCodeTable.Data : [];
      return data
        .filter((x) => SEARCH_ALLOWED_TYPES.includes(x.SecurityTypeName))
        .map((x) => ({
          secid: x.QuoteID, code: x.Code, name: x.Name, type: x.SecurityTypeName || "",
        }));
    } catch (e) { return []; }
  },
};

// 搜索当前只暴露指数（屏蔽个股，保留可扩展：加类型即可放开，如 "沪A"/"深A"/"港股"/"美股"）。
const SEARCH_ALLOWED_TYPES = ["指数"];

/* ---------- 3b. 估值数据（akshare 预生成的 JSON） ---------- */
const valDataCache = {};
async function loadValuation(code) {
  if (code in valDataCache) return valDataCache[code];
  try {
    // no-cache（而非 no-store）：每次仍向服务器校验，保证每天 18:00 数据更新后不读旧；
    // 但靠 ETag/Last-Modified 命中 304，重复访问省掉 ~190KB 正文下载（GitHub Pages 支持 ETag）。
    const r = await fetch("./data/" + code + ".json?v=20260616-11", { cache: "no-cache" });
    if (!r.ok) throw new Error("404");
    const j = await r.json();
    valDataCache[code] = j;
    return j;
  } catch (e) {
    valDataCache[code] = null;
    return null;
  }
}

/* ---------- 4. 格式化 ---------- */
const fmt = (x, d = 2) => (x == null || !isFinite(x) ? "—" : x.toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtPct = (x) => (x == null ? "—" : (x >= 0 ? "+" : "") + x.toFixed(2) + "%");
const cls = (x) => (x == null ? "flat" : x > 0 ? "up" : x < 0 ? "down" : "flat");

/* ---------- 6. 路由 ---------- */
const view = document.getElementById("view");
function router() {
  const hash = location.hash || "#/";
  const m = hash.match(/^#\/idx\/(.+)$/);
  // 详情页展开成宽幅工作台，首页保持窄容器（见 styles.css 的 #view.view-wide）
  view.classList.toggle("view-wide", Boolean(m));
  if (m) renderDetail(decodeURIComponent(m[1]));
  else renderHome();
}
window.addEventListener("hashchange", router);

/* ---------- 7. 首页 ---------- */
async function renderHome() {
  // 首页只展示主表中 home 开关打开的指数（开关在 indexes.json 里逐条配置）
  const homeList = POPULAR.filter((p) => p.home);
  // 按市场分组渲染（顺序 A股 → 港股 → 美股；未标注 market 的归入"其他"）
  const MARKET_ORDER = ["A股", "港股", "美股"];
  const groups = new Map();
  homeList.forEach((p) => {
    const m = p.market || "其他";
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(p);
  });
  const markets = [
    ...MARKET_ORDER.filter((m) => groups.has(m)),
    ...[...groups.keys()].filter((m) => !MARKET_ORDER.includes(m)),
  ];
  const sections = markets
    .map(
      (m) =>
        `<div class="section-title">${m}</div>
    <div class="grid">${groups.get(m).map(cardSkeleton).join("")}</div>`
    )
    .join("");
  view.innerHTML = `
    <section class="hero">
      <h1>指数估值 · 行情分析</h1>
      <p>搜索任意指数，查看实时点位、涨跌，以及历史点位 / PE / PB / 股息率分位分析。</p>
    </section>
    ${sections}
  `;
  try {
    const q = await EM.batchQuote(homeList.map((p) => p.secid));
    homeList.forEach((p) => {
      const el = document.getElementById("c-" + p.secid.replace(".", "_"));
      const d = q[p.secid];
      if (el) el.innerHTML = cardBody(p, d);
    });
  } catch (e) {
    document.querySelectorAll(".card .skeleton").forEach((s) => (s.textContent = "行情加载失败"));
  }
}
function cardSkeleton(p) {
  return `<div class="card" id="c-${p.secid.replace(".", "_")}" onclick="location.hash='#/idx/${p.secid}'">${cardBody(p, null)}</div>`;
}
function cardBody(p, d) {
  if (!d) return `<div class="nm">${p.name}</div><div class="cd">${p.code}</div><div class="px"><span class="skeleton">加载中…</span></div>`;
  return `
    <div class="nm">${d.name || p.name}</div>
    <div class="cd">${p.code}</div>
    <div class="px">
      <span class="price">${fmt(d.price)}</span>
      <span class="chg ${cls(d.pct)}">${fmtPct(d.pct)}</span>
    </div>`;
}

/* ---------- 8. 详情页 ---------- */
const klineCache = {};
let chart = null;
const RANGES = [
  { k: "1Y", label: "1年", days: 365 },
  { k: "3Y", label: "3年", days: 365 * 3 },
  { k: "5Y", label: "5年", days: 365 * 5 },
  { k: "10Y", label: "10年", days: 365 * 10 },
  { k: "ALL", label: "上市以来", days: 1e9 },
  { k: "CUSTOM", label: "自定义", days: null },
];
// 周期：日/周/月。周线=每周最后一个交易日值、月线=每月最后一个交易日值
// （见 valuation-core.js resampleSeries 的分桶取末值规则）。
const PERIODS = [
  { k: "D", label: "日" },
  { k: "W", label: "周" },
  { k: "M", label: "月" },
];
const METRICS = {
  close: { label: "指数点位", short: "点位", current: "当前点位" },
  pe: { label: "市盈率 TTM", short: "市盈率", current: "当前 PE" },
  pb: { label: "市净率 LF", short: "市净率", current: "当前 PB" },
  dy: { label: "股息率", short: "股息率", current: "当前股息率", unit: "%", higherIsBetter: true },
};
const detailState = {
  range: "10Y",
  metric: "close",
  period: "W",  // 默认周线（每周最后交易日值）；用户可在周期分段控件切日/月
  ma: 0,
  view: "stats",
  showQuantiles: true,
  showStd: false,
  customStart: "",
  customEnd: "",
};

async function renderDetail(secid) {
  const known = POPULAR.find((p) => p.secid === secid);
  view.innerHTML = `<div class="loading">加载中…</div>`;
  // 行情（东方财富）与历史 K 线都可能失败：都不致命，逐一降级。
  let quote = null, kdata = null;
  [quote, kdata] = await Promise.all([
    EM.quote(secid).catch(() => null),
    EM.kline(secid).catch(() => null),
  ]);
  const name = (quote && quote.name) || (kdata && kdata.name) || (known && known.name) || secid;
  const code = (quote && quote.code) || (known && known.code) || secid.split(".")[1];

  // 历史点位优先用 CI 预生成的静态 close（多源兜底），实时 kline 仅作补充。
  const val = await loadValuation(code);
  klineCache[secid] = kdata && kdata.rows && kdata.rows.length ? kdata : { rows: [] };
  const hasPoint = !!(val && Core.hasSeries(val.close)) || klineCache[secid].rows.length > 0;
  const hasVal = !!(val && (Core.hasSeries(val.pe) || Core.hasSeries(val.pb) || Core.hasSeries(val.dy)));
  if (!hasPoint && !hasVal) {
    view.innerHTML = `<div class="error">未找到该指数的历史数据，且实时行情接口暂时不可用，请稍后重试。<br><a class="back" href="#/">返回首页</a></div>`;
    return;
  }
  // 优先默认显示估值指标（点位会作为叠加线始终展示）；仅有点位数据的指数才默认点位。
  const defaultMetric = (val && Core.hasSeries(val.pe)) ? "pe" : (val && Core.hasSeries(val.pb)) ? "pb" : (val && Core.hasSeries(val.dy)) ? "dy" : "close";
  Object.assign(detailState, { range: "10Y", metric: defaultMetric, period: "W", ma: 0, view: "stats", showQuantiles: true, showStd: false, customStart: "", customEnd: "" });

  view.innerHTML = `
    <section class="detail-workspace">
      <div class="analysis-toolbar">
        <div class="control-row">
          <div class="control-group range-control">
            <span class="control-label">时间范围</span>
            <div class="segmented" id="rangeTabs">
              ${RANGES.map((r) => `<button class="segment ${r.k === detailState.range ? "active" : ""}" data-range="${r.k}">${r.label}</button>`).join("")}
            </div>
          </div>
          <div class="control-group period-control">
            <span class="control-label">周期</span>
            <div class="segmented" id="periodTabs">
              ${PERIODS.map((p) => `<button class="segment ${p.k === detailState.period ? "active" : ""}" data-period="${p.k}">${p.label}</button>`).join("")}
            </div>
          </div>
          <div class="control-group metric-control">
            <span class="control-label">估值指标</span>
            <div class="segmented" id="metricTabs"></div>
          </div>
        </div>
        <div class="control-row secondary-controls">
          <div class="segmented view-switch" id="viewTabs">
            <button class="segment active" data-view="stats">统计分析</button>
            <button class="segment" data-view="table">明细数据</button>
          </div>
          <label class="toggle-control"><input id="quantileToggle" type="checkbox" checked><span>分位线</span></label>
          <label class="toggle-control"><input id="stdToggle" type="checkbox"><span>标准差</span></label>
          <label class="select-control"><span>移动平均</span><select id="maSelect"><option value="0">无</option><option value="20">20期</option><option value="60">60期</option><option value="120">120期</option></select></label>
          <div class="custom-range" id="customRange" hidden>
            <input id="customStart" type="date" aria-label="开始日期">
            <span>至</span>
            <input id="customEnd" type="date" aria-label="结束日期">
          </div>
        </div>
      </div>

      ${hasPoint ? "" : `<div class="feed-notice">实时行情接口（东方财富）暂时不可用，「指数点位」已置灰，仅展示历史 PE / PB / 股息率分位分析。</div>`}

      <div class="instrument-strip">
        <div>
          <a class="back" href="#/">‹ 返回指数列表</a>
          <div class="instrument-title"><strong>${name}</strong><span>${code} · ${secid}</span></div>
        </div>
        <div class="market-quote">
          <strong class="${cls(quote && quote.pct)}">${fmt(quote && quote.price)}</strong>
          <span class="${cls(quote && quote.pct)}">${quote ? fmtPct(quote.pct) + "  " + (quote.chg >= 0 ? "+" : "") + fmt(quote.chg) : "行情快照暂不可用"}</span>
        </div>
      </div>

      <div class="analysis-card" id="statsView">
        <aside class="stats-pane">
          <div class="pane-title" id="statsTitle">指数点位</div>
          <div class="stats" id="stats"></div>
        </aside>
        <div class="chart-pane">
          <div class="chart-heading">
            <div><strong id="chartTitle">指数点位</strong><span id="coverageBadge"></span></div>
            <span class="source-note" id="sourceNote"></span>
          </div>
          <div id="chart"></div>
          <div class="pct-badge" id="pctBadge"></div>
          <div class="note" id="snapNote"></div>
        </div>
      </div>
      <div class="table-card" id="tableView" hidden>
        <div class="table-heading"><strong id="tableTitle">明细数据</strong><span id="tableCount"></span></div>
        <div class="table-scroll"><table><thead><tr><th>日期</th><th id="metricColumn">指标值</th><th>指数点位</th><th>相对前值</th></tr></thead><tbody id="detailRows"></tbody></table></div>
      </div>
    </section>
  `;

  bindDetailControls(secid, quote);
  buildMetricTabs(secid, quote, val);
  // 进入详情页才按需加载 echarts；失败不致命，renderChart 会降级，统计/明细照常可用。
  await loadECharts().catch(() => {});
  drawDetail(secid, quote);
  window.onresize = () => chart && chart.resize();
}

function bindDetailControls(secid, quote) {
  const redraw = () => drawDetail(secid, quote);
  document.getElementById("rangeTabs").onclick = (event) => {
    const target = event.target.closest("[data-range]");
    if (!target) return;
    detailState.range = target.dataset.range;
    document.querySelectorAll("#rangeTabs .segment").forEach((item) => item.classList.toggle("active", item.dataset.range === detailState.range));
    document.getElementById("customRange").hidden = detailState.range !== "CUSTOM";
    redraw();
  };
  document.getElementById("viewTabs").onclick = (event) => {
    const target = event.target.closest("[data-view]");
    if (!target) return;
    detailState.view = target.dataset.view;
    document.querySelectorAll("#viewTabs .segment").forEach((item) => item.classList.toggle("active", item.dataset.view === detailState.view));
    document.getElementById("statsView").hidden = detailState.view !== "stats";
    document.getElementById("tableView").hidden = detailState.view !== "table";
    if (detailState.view === "stats") requestAnimationFrame(() => chart && chart.resize());
  };
  document.getElementById("periodTabs").onclick = (event) => {
    const target = event.target.closest("[data-period]");
    if (!target) return;
    detailState.period = target.dataset.period;
    document.querySelectorAll("#periodTabs .segment").forEach((item) => item.classList.toggle("active", item.dataset.period === detailState.period));
    redraw();
  };
  document.getElementById("maSelect").onchange = (event) => { detailState.ma = Number(event.target.value); redraw(); };
  document.getElementById("quantileToggle").onchange = (event) => { detailState.showQuantiles = event.target.checked; redraw(); };
  document.getElementById("stdToggle").onchange = (event) => { detailState.showStd = event.target.checked; redraw(); };
  document.getElementById("customStart").onchange = (event) => { detailState.customStart = event.target.value; redraw(); };
  document.getElementById("customEnd").onchange = (event) => { detailState.customEnd = event.target.value; redraw(); };
}

function buildMetricTabs(secid, quote, val) {
  const box = document.getElementById("metricTabs");
  if (!box) return;
  const avail = {
    close: !!pointSeries(secid, quote),
    pe: !!(val && Core.hasSeries(val.pe)),
    pb: !!(val && Core.hasSeries(val.pb)),
    dy: !!(val && Core.hasSeries(val.dy)),
  };
  // 「点位」永不作为估值指标 tab（点位始终作为叠加线展示）。估值指标固定展示
  // PE/PB/股息率，暂无数据的置灰——缺失只是数据源临时问题，后续会补，不隐藏。
  box.innerHTML = ["pe", "pb", "dy"].map((m) => {
    const on = avail[m];
    const active = on && m === detailState.metric ? " active" : "";
    return `<button class="segment${active}" data-metric="${m}"${on ? "" : ' disabled title="暂无数据"'}>${METRICS[m].short}</button>`;
  }).join("");
  box.onclick = (event) => {
    const target = event.target.closest("[data-metric]");
    if (!target || target.disabled) return;
    detailState.metric = target.dataset.metric;
    box.querySelectorAll(".segment").forEach((item) => item.classList.toggle("active", item.dataset.metric === detailState.metric));
    drawDetail(secid, quote);
  };
}

function seriesOptions() {
  return {
    range: detailState.range,
    customStart: detailState.customStart,
    customEnd: detailState.customEnd,
  };
}

// 历史点位序列：优先用静态 close（CI 多源兜底），否则回退浏览器实时 kline。
function pointSeries(secid, quote) {
  const val = valDataCache[secid_to_code(secid, quote)];
  if (val && Core.hasSeries(val.close)) return { dates: val.dates, values: val.close };
  const k = klineCache[secid];
  if (k && k.rows.length) return { dates: k.rows.map((row) => row.date), values: k.rows.map((row) => row.close) };
  return null;
}

function getMetricSeries(secid, quote) {
  if (detailState.metric === "close") return pointSeries(secid, quote);
  const val = valDataCache[secid_to_code(secid, quote)];
  if (!val || !Core.hasSeries(val[detailState.metric])) return null;
  return { dates: val.dates, values: val[detailState.metric] };
}

function prepareSeries(dates, values) {
  const sliced = Core.sliceByRange(dates, values, seriesOptions());
  return Core.resampleSeries(sliced.dates, sliced.values, detailState.period);
}

function firstAvailableMetric(secid, quote) {
  // 优先估值指标，最后才回退点位（与默认 metric 一致）
  const val = valDataCache[secid_to_code(secid, quote)];
  if (val && Core.hasSeries(val.pe)) return "pe";
  if (val && Core.hasSeries(val.pb)) return "pb";
  if (val && Core.hasSeries(val.dy)) return "dy";
  if (pointSeries(secid, quote)) return "close";
  return "close";
}

function drawDetail(secid, quote) {
  const raw = getMetricSeries(secid, quote);
  if (!raw) {
    const fallback = firstAvailableMetric(secid, quote);
    if (fallback === detailState.metric) return; // 无可用序列，避免递归
    detailState.metric = fallback;
    return drawDetail(secid, quote);
  }
  const series = prepareSeries(raw.dates, raw.values);
  const stats = Core.analyze(series.values);
  const metric = METRICS[detailState.metric];
  const point = pointSeries(secid, quote);
  const pointValues = detailState.metric === "close"
    ? series.values
    : (point ? Core.alignPrevious(series.dates, point.dates, point.values) : series.dates.map(() => null));
  const val = valDataCache[secid_to_code(secid, quote)];
  const source = val && val.sources && val.sources[detailState.metric];

  renderStats(stats, metric);
  renderPctBadge(stats, metric);
  renderCoverage(series, metric, source);
  renderDetailTable(series, pointValues, metric);
  renderChart(series, pointValues, stats, metric);
}

// 估值缓存以 code 为键，这里从 secid/quote 推出 code
function secid_to_code(secid, quote) {
  if (quote && quote.code) return quote.code;
  const known = POPULAR.find((p) => p.secid === secid);
  if (known) return known.code;
  return secid.split(".")[1];
}

function renderStats(stats, metric) {
  const box = document.getElementById("stats");
  document.getElementById("statsTitle").textContent = metric.label;
  if (!stats) {
    box.innerHTML = `<div class="empty-state">所选区间没有可用数据</div>`;
    return;
  }
  const value = (number) => fmt(number) + (metric.unit || "");
  const bands = Core.semanticBands(stats, metric.higherIsBetter);
  box.innerHTML = `
    <div class="row primary"><span class="k">${metric.current}</span><span class="v">${value(stats.current)}</span></div>
    <div class="row primary"><span class="k">历史分位</span><span class="v">${stats.percentile.toFixed(2)}%</span></div>
    <div class="row"><span class="k"><span class="line-key danger"></span>危险值 (${metric.higherIsBetter ? "20" : "80"}%)</span><span class="v">${value(bands.danger)}</span></div>
    <div class="row"><span class="k"><span class="line-key median"></span>中位数 (50%)</span><span class="v">${value(stats.median)}</span></div>
    <div class="row"><span class="k"><span class="line-key chance"></span>机会值 (${metric.higherIsBetter ? "80" : "20"}%)</span><span class="v">${value(bands.chance)}</span></div>
    <div class="row divider"><span class="k">最大值</span><span class="v">${value(stats.max)}</span></div>
    <div class="row"><span class="k">平均值</span><span class="v">${value(stats.mean)}</span></div>
    <div class="row"><span class="k">最小值</span><span class="v">${value(stats.min)}</span></div>
    <div class="row"><span class="k">标准差 (+1)</span><span class="v">${value(stats.stdUpper)}</span></div>
    <div class="row"><span class="k">标准差 (-1)</span><span class="v">${value(stats.stdLower)}</span></div>
    <div class="row"><span class="k">标准差</span><span class="v">${value(stats.std)}</span></div>
    <div class="row"><span class="k">z 分数</span><span class="v">${fmt(stats.z)}</span></div>
  `;
}

function renderPctBadge(stats, metric) {
  const box = document.getElementById("pctBadge");
  if (!stats) { box.innerHTML = ""; return; }
  const p = Math.max(0, Math.min(100, stats.percentile));
  let label = "适中", color = "var(--median)";
  if (metric.higherIsBetter) {
    if (p >= 80) { label = "高股息"; color = "var(--chance)"; }
    else if (p <= 20) { label = "低股息"; color = "var(--danger)"; }
  } else {
    if (p >= 80) { label = "偏高估"; color = "var(--danger)"; }
    else if (p <= 20) { label = "偏低估"; color = "var(--chance)"; }
  }
  const gradient = metric.higherIsBetter
    ? "linear-gradient(90deg,var(--danger),var(--median),var(--chance))"
    : "linear-gradient(90deg,var(--chance),var(--median),var(--danger))";
  box.innerHTML =
    `<span>当前分位 <b style="color:${color}">${p.toFixed(1)}% · ${label}</b></span>
     <span class="bar" style="background:${gradient}"><i style="left:${p}%"></i></span>`;
}

function renderCoverage(series, metric, source) {
  const first = series.dates[0];
  const last = series.dates[series.dates.length - 1];
  document.getElementById("chartTitle").textContent = metric.label;
  document.getElementById("coverageBadge").textContent = first ? `${first} 至 ${last}` : "无数据";
  document.getElementById("sourceNote").textContent = source ? `来源 ${source}` : "来源 东方财富";
  const note = metric.note ? ` · ${metric.note}` : "";
  document.getElementById("snapNote").textContent = first
    ? `样本 ${series.values.length} 条 · 实际覆盖 ${first} 至 ${last} · 分位统计仅基于当前筛选后的有效序列${note}`
    : "所选区间没有有效样本";
}

function renderDetailTable(series, pointValues, metric) {
  document.getElementById("tableTitle").textContent = `${metric.label}明细`;
  document.getElementById("tableCount").textContent = `${series.values.length} 条`;
  document.getElementById("metricColumn").textContent = metric.label;
  const rows = series.dates.map((date, index) => {
    const current = series.values[index];
    const previous = index ? series.values[index - 1] : null;
    const change = previous == null || previous === 0 ? null : ((current - previous) / Math.abs(previous)) * 100;
    return { date, current, point: pointValues[index], change };
  }).reverse();
  document.getElementById("detailRows").innerHTML = rows.map((row) => `
    <tr><td>${row.date}</td><td>${fmt(row.current)}${metric.unit || ""}</td><td>${fmt(row.point)}</td><td class="${cls(row.change)}">${row.change == null ? "—" : fmtPct(row.change)}</td></tr>
  `).join("");
}

function renderChart(series, pointValues, stats, metric) {
  const el = document.getElementById("chart");
  // echarts 未就绪时降级：统计与明细仍可用，仅图表占位提示。
  // 区分「加载中」(promise 进行中——慢网下首屏点击控件会走到这里) 与「加载失败」
  // (onerror 已把 echartsPromise 置空)，避免给用户看错误的"失败"字样。
  // 同时清掉可能指向已 dispose/旧页实例的 chart 句柄，防止 onresize 调到死实例报错。
  if (!window.echarts) {
    if (chart) { try { chart.dispose(); } catch (e) {} chart = null; }
    el.innerHTML = `<div class="chart-fallback">${echartsPromise ? "图表组件加载中…" : "图表组件加载失败，统计分析与明细数据仍可查看。"}</div>`;
    return;
  }
  if (chart) chart.dispose();
  chart = echarts.init(el);
  // 行情接口不可用时 pointValues 全为空，不再叠加「指数点位」副轴
  const showPoint = detailState.metric !== "close" && pointValues.some((v) => v != null && Number.isFinite(v));
  const mark = (value, color, name) => ({
    name, yAxis: value, lineStyle: { color, type: "dashed", width: 1.5 },
    label: { formatter: `${name} ${fmt(value)}`, color, position: "insideEndTop", fontSize: 11 },
  });
  const marks = [];
  const bands = Core.semanticBands(stats, metric.higherIsBetter);
  if (bands && detailState.showQuantiles) marks.push(mark(bands.danger, "#c63f36", "危险"), mark(stats.median, "#7b8794", "中位"), mark(bands.chance, "#2f9b62", "机会"));
  if (stats && detailState.showStd) marks.push(mark(stats.stdUpper, "#8b5cf6", "+1σ"), mark(stats.stdLower, "#8b5cf6", "-1σ"));
  const maValues = detailState.ma ? Core.movingAverage(series.values, detailState.ma) : null;
  // 配色——统一「线条」与「图例/tooltip 圆点」：ECharts 折线的图例标记和 tooltip 圆点
  // 取的是 itemStyle.color，只设 lineStyle.color 会让它们回退到默认调色板、与线对不上。
  // 故每条线都把 lineStyle.color 与 itemStyle.color 设成同一颜色。
  const POINT_COLOR = "#7fc8a0";   // 指数点位：浅绿色 + 色块填充
  const METRIC_COLOR = "#2f6190";  // 当前选中的估值指标：深蓝色
  const MA_COLOR = "#8b5cf6";
  const greenArea = { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: "rgba(127,200,160,.42)" }, { offset: 1, color: "rgba(127,200,160,.05)" },
  ]) };
  // 视觉层级：指数点位是"基准"（浅绿填充、占主视觉）；当前估值指标是"会变化的辅助线"
  // （深蓝细线叠加其上）。仅有点位的指数则点位本身即主体（也用浅绿）。
  const metricColor = showPoint ? METRIC_COLOR : POINT_COLOR;
  const metricSeries = {
    name: metric.label, type: "line", data: series.values, showSymbol: false, connectNulls: true,
    lineStyle: { color: metricColor, width: 2 }, itemStyle: { color: metricColor },
    markLine: marks.length ? { symbol: "none", silent: true, data: marks } : undefined,
  };
  if (!showPoint) metricSeries.areaStyle = greenArea;
  const chartSeries = [];
  if (showPoint) chartSeries.push({ name: "指数点位", type: "line", yAxisIndex: 1, data: pointValues, showSymbol: false, connectNulls: true, lineStyle: { color: POINT_COLOR, width: 1 }, itemStyle: { color: POINT_COLOR }, areaStyle: greenArea });
  chartSeries.push(metricSeries);
  if (maValues) chartSeries.push({ name: `${metric.short} MA${detailState.ma}`, type: "line", data: maValues, showSymbol: false, connectNulls: true, lineStyle: { color: MA_COLOR, width: 1.6 }, itemStyle: { color: MA_COLOR } });

  chart.setOption({
    animation: false,
    grid: { left: 64, right: showPoint ? 72 : 28, top: 40, bottom: 72 },
    legend: { bottom: 8, textStyle: { color: "#586473" } },
    tooltip: {
      trigger: "axis",
      formatter: (items) => `${items[0].axisValue}<br>${items.map((item) => `${item.marker}${item.seriesName} <b>${fmt(item.data)}${item.seriesName === metric.label ? metric.unit || "" : ""}</b>`).join("<br>")}`,
    },
    xAxis: {
      type: "category", data: series.dates, boundaryGap: false,
      axisLine: { lineStyle: { color: "#cfd7df" } },
      axisLabel: { color: "#909aa8", fontSize: 11 },
    },
    yAxis: [
      { type: "value", scale: true, name: metric.short, splitLine: { lineStyle: { color: "#e8edf1" } }, axisLabel: { color: "#687482", fontSize: 11 } },
      { type: "value", scale: true, name: "指数点位", show: showPoint, splitLine: { show: false }, axisLabel: { color: "#687482", fontSize: 11 } },
    ],
    dataZoom: [
      { type: "inside", start: 0, end: 100 },
      { type: "slider", height: 18, bottom: 38, borderColor: "#dfe5ea", fillerColor: "rgba(79,178,199,.18)", backgroundColor: "#f4f7f8" },
    ],
    series: chartSeries,
  });
}

/* ---------- 9. 搜索框 ---------- */
const searchInput = document.getElementById("searchInput");
const suggestBox = document.getElementById("suggestBox");
let searchTimer = null, activeIdx = -1, curResults = [];

function localSearch(kw) {
  kw = kw.trim().toLowerCase();
  if (!kw) return [];
  return POPULAR.filter((p) => p.name.toLowerCase().includes(kw) || p.code.toLowerCase().includes(kw))
    .map((p) => ({ secid: p.secid, code: p.code, name: p.name, type: "指数" }));
}
function renderSuggest(list) {
  curResults = list; activeIdx = -1;
  if (!list.length) { suggestBox.innerHTML = `<div class="suggest-empty">未找到匹配指数</div>`; suggestBox.hidden = false; return; }
  suggestBox.innerHTML = list.map((x, i) =>
    `<div class="suggest-item" data-i="${i}" onmousedown="goto('${x.secid}')">
       <span class="nm">${x.name}</span><span class="cd">${x.code}</span>
       ${x.type ? `<span class="tag">${x.type}</span>` : ""}
     </div>`).join("");
  suggestBox.hidden = false;
}
window.goto = (secid) => { suggestBox.hidden = true; searchInput.value = ""; location.hash = "#/idx/" + secid; };

searchInput.addEventListener("input", () => {
  const kw = searchInput.value.trim();
  if (!kw) { suggestBox.hidden = true; return; }
  // 先查本地主表（indexes.json）；命中就直接用，不打外部接口
  const local = localSearch(kw);
  if (local.length) { clearTimeout(searchTimer); renderSuggest(local); return; }
  // 表里没有 → 防抖后回退到外部接口（东方财富全网搜索）
  suggestBox.innerHTML = `<div class="suggest-empty">搜索中…</div>`;
  suggestBox.hidden = false;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const remote = await EM.suggest(kw);
    if (searchInput.value.trim() === kw) renderSuggest(remote.slice(0, 15));
  }, 280);
});
searchInput.addEventListener("keydown", (e) => {
  if (suggestBox.hidden || !curResults.length) return;
  if (e.key === "ArrowDown") { activeIdx = (activeIdx + 1) % curResults.length; }
  else if (e.key === "ArrowUp") { activeIdx = (activeIdx - 1 + curResults.length) % curResults.length; }
  else if (e.key === "Enter") { if (curResults[activeIdx]) window.goto(curResults[activeIdx].secid); return; }
  else return;
  e.preventDefault();
  document.querySelectorAll(".suggest-item").forEach((el, i) => el.classList.toggle("active", i === activeIdx));
});
document.addEventListener("click", (e) => { if (!e.target.closest("#navSearch")) suggestBox.hidden = true; });

/* ---------- 启动 ---------- */
loadIndexes().then(router);
