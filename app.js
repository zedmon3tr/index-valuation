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
// 子资源完整性（SRI，cdnjs 官方发布的 sha512）：CDN 被篡改/投毒时浏览器拒绝执行。
// crossorigin 必须有，否则跨源脚本无法做完整性校验。
const ECHARTS_SRI = "sha512-k37wQcV4v2h6jgYf5IUz1MoSKPpDs630XGSmCaCCOXxy2awgAWKHGZWr9nMyGgk3IOxA1NxdkN8r1JHgkUtMoQ==";
let echartsPromise = null;
function loadECharts() {
  if (window.echarts) return Promise.resolve(window.echarts);
  if (echartsPromise) return echartsPromise;
  echartsPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = ECHARTS_SRC;
    s.integrity = ECHARTS_SRI;
    s.crossOrigin = "anonymous";
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
// 基金（ETF）主表：funds.json。每只基金通过 trackIndex 借用其跟踪指数的估值数据
// （ETF 自身无独立 PE/PB），详情页的分位 / 机会线即来自该指数。
let FUNDS = [];
async function loadIndexes() {
  const [idx, funds] = await Promise.all([
    fetch("./indexes.json", { cache: "no-cache" }).then((r) => r.json()).catch((e) => { console.error("加载 indexes.json 失败：", e); return []; }),
    fetch("./funds.json", { cache: "no-cache" }).then((r) => r.json()).catch((e) => { console.error("加载 funds.json 失败：", e); return []; }),
  ]);
  POPULAR = idx;
  FUNDS = funds;
}

/* ---------- 2. JSONP 工具 ---------- */
function jsonp(url, cbParam = "cb", timeout = 8000) {
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

  // 全网搜索回退（东财）。当前放开【指数 + 基金】（ETF/LOF 在接口里统一是 SecurityTypeName==="基金"），
  // 仍屏蔽个股（沪A/深A/港股/美股）与板块。要再扩展时，把对应类型加进
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

// 搜索暴露指数 + 基金（ETF/LOF 均为 "基金"），屏蔽个股/板块。可扩展：加类型即可放开，如 "沪A"/"深A"/"港股"/"美股"。
const SEARCH_ALLOWED_TYPES = ["指数", "基金"];

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

/* ---------- 3c. 基金净值 JSON（两份：快照 + 历史净值） ---------- */
let fundNavSnapshot = undefined;   // funds_nav.json：{code → {nav, estimate, …}}
let fundNavHist = undefined;       // funds_nav_hist.json：{code → {navDates, nav}}

async function loadFundNav() {
  if (fundNavSnapshot !== undefined) return fundNavSnapshot;
  try {
    const r = await fetch("./data/funds_nav.json?v=20260618-tracking", { cache: "no-cache" });
    if (!r.ok) throw new Error("404");
    const j = await r.json();
    fundNavSnapshot = {};
    (j.funds || []).forEach((f) => { fundNavSnapshot[f.code] = f; });
  } catch (e) { fundNavSnapshot = null; }
  return fundNavSnapshot;
}

async function loadFundNavHist() {
  if (fundNavHist !== undefined) return fundNavHist;
  try {
    const r = await fetch("./data/funds_nav_hist.json?v=20260618-tracking", { cache: "no-cache" });
    if (!r.ok) throw new Error("404");
    const j = await r.json();
    fundNavHist = {};
    (j.funds || []).forEach((f) => { fundNavHist[f.code] = f; });
  } catch (e) { fundNavHist = null; }
  return fundNavHist;
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
// 首页行情短 TTL 缓存：详情页 ↔ 首页来回切时，TTL 内复用上次快照，免重复打东财。
let homeQuoteCache = { ts: 0, q: null };
const HOME_QUOTE_TTL = 15000;

async function renderHome() {
  // 首页展示主表中 home 开关打开的标的（指数在 indexes.json、基金在 funds.json 逐条配置）
  const homeList = POPULAR.concat(FUNDS).filter((p) => p.home);
  // 按市场分组渲染（顺序 A股 → 港股 → 美股 → 基金/ETF；未标注 market 的归入"其他"）
  const MARKET_ORDER = ["A股", "港股", "美股", "基金 / ETF"];
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
      <p>搜索任意指数或基金（ETF），查看实时点位、涨跌，以及历史点位 / PE / PB / 股息率分位分析。</p>
    </section>
    ${sections}
  `;
  try {
    let q = homeQuoteCache.q;
    if (!q || Date.now() - homeQuoteCache.ts > HOME_QUOTE_TTL) {
      q = await EM.batchQuote(homeList.map((p) => p.secid));
      homeQuoteCache = { ts: Date.now(), q };
    }
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
// 定投计算器 state：三个字段统一持数字或 null（清空/非法即 null），不存输入框原始字符串，
// 避免「初始化是数字、sync 后变字符串」的类型漂移（calculateDcaLevels 自身再做校验）。
const dcaState = {
  initialPrice: null,
  count: 10,
  dropPct: 4,
};
const DCA_MAX_COUNT = 60;

// 顶部实时行情区的 HTML。quote 有值显示价格；为空时按是否仍在加载显示「加载中」或「不可用」。
function marketQuoteHTML(quote, pending) {
  if (quote && quote.price != null) {
    // chg 缺失时只显示涨跌幅、不拼出 "—" 脏字符；price 缺失则视作无快照，走下方占位分支。
    const chg = quote.chg == null ? "" : `  ${quote.chg >= 0 ? "+" : ""}${fmt(quote.chg)}`;
    return `<strong class="${cls(quote.pct)}">${fmt(quote.price)}</strong>
          <span class="${cls(quote.pct)}">${fmtPct(quote.pct)}${chg}</span>`;
  }
  return `<span class="quote-pending">${pending ? "实时行情加载中…" : "行情快照暂不可用"}</span>`;
}
function updateMarketQuote(quote) {
  const el = document.getElementById("marketQuote");
  if (el) el.innerHTML = marketQuoteHTML(quote, false);
}

async function renderDetail(secid) {
  const reqHash = location.hash;
  const known = POPULAR.find((p) => p.secid === secid);
  const fund = FUNDS.find((f) => f.secid === secid);
  view.innerHTML = `<div class="loading">加载中…</div>`;

  // 实时行情 + K 线（push2，可能很慢甚至失败）：后台拉取，绝不阻塞首屏渲染。
  const livePromise = Promise.all([
    EM.quote(secid).catch(() => null),
    EM.kline(secid).catch(() => null),
  ]);

  // 估值 / 历史点位（本地静态 JSON，快且稳）：先加载它来渲染首屏。
  // 基金借用跟踪指数的估值数据；已知标的无需实时行情即可解析估值 code。
  const val = await loadValuation(secid_to_code(secid, null));
  if (location.hash !== reqHash) return;
  const localName = (fund && fund.name) || (known && known.name);
  const hasVal = !!(val && (Core.hasSeries(val.pe) || Core.hasSeries(val.pb) || Core.hasSeries(val.dy)));
  const hasLocalData = hasVal || !!(val && Core.hasSeries(val.close));

  // 已知标的或本地有数据 → 立即渲染，实时行情后台补；
  // 否则（未知 secid 且无本地数据）只能等实时接口才知道有没有数据。
  let quote = null, kdata = null;
  const renderedFromLocal = hasLocalData || !!localName;
  if (!renderedFromLocal) {
    [quote, kdata] = await livePromise;
    if (location.hash !== reqHash) return;
  }

  const name = (quote && quote.name) || (kdata && kdata.name) || localName || secid;
  // 展示用 code 取标的自身（基金显示自己的代码）；估值用 code 走 secid_to_code（基金→跟踪指数）。
  const code = (quote && quote.code) || (fund && fund.code) || (known && known.code) || secid.split(".")[1];
  const trackName = fund ? ((POPULAR.find((p) => p.code === fund.trackIndex) || {}).name || fund.trackIndex) : "";
  klineCache[secid] = kdata && kdata.rows && kdata.rows.length ? kdata : { rows: [] };
  const hasPoint = !!(val && Core.hasSeries(val.close)) || klineCache[secid].rows.length > 0;
  if (!hasPoint && !hasVal) {
    view.innerHTML = `<div class="error">未找到该标的的历史数据，且实时行情接口暂时不可用，请稍后重试。<br><a class="back" href="#/">返回首页</a></div>`;
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
      ${fund ? `<div class="feed-notice">「${name}」是 ETF，下方估值分位 / 机会线基于其跟踪指数 <b>${trackName}（${fund.trackIndex}）</b>；上方为基金自身实时价格。</div>` : ""}
      ${fund ? `<section class="tracking-card" id="trackingCard" aria-label="跟踪关联"><div class="tracking-loading">跟踪数据加载中…</div></section>` : ""}

      <div class="instrument-strip">
        <div>
          <a class="back" href="#/">‹ 返回${fund ? "首页" : "指数列表"}</a>
          <div class="instrument-title"><strong>${name}</strong><span>${code} · ${secid}</span></div>
        </div>
        <div class="market-quote" id="marketQuote">${marketQuoteHTML(quote, renderedFromLocal)}</div>
      </div>

      <div class="analysis-card" id="statsView">
        <aside class="stats-pane">
          <div class="pane-title" id="statsTitle">统计概览</div>
          <div class="stats" id="stats"></div>
        </aside>
        <div class="chart-pane">
          <div class="chart-heading">
            <div><strong id="chartTitle">指数点位</strong><span id="coverageBadge"></span></div>
            <span class="source-note" id="sourceNote"></span>
          </div>
          <div class="pct-badge" id="pctBadge"></div>
          <div id="chart"></div>
          <div class="note" id="snapNote"></div>
        </div>
      </div>
      <section class="dca-card" id="dcaCalculator" aria-labelledby="dcaTitle">
        <div class="dca-heading">
          <div>
            <strong id="dcaTitle">定投点位</strong>
            <span>按上一次买入点位继续下跌计算</span>
          </div>
          <button class="reset-button" id="dcaReset" type="button">重置</button>
        </div>
        <div class="dca-controls">
          <label>
            <span>初次买入点位</span>
            <input id="dcaInitialPrice" type="number" min="0" step="0.01" inputmode="decimal" placeholder="输入点位">
          </label>
          <label>
            <span>定投次数</span>
            <input id="dcaCount" type="number" min="1" max="60" step="1" inputmode="numeric" value="10">
          </label>
          <label>
            <span>每次跌幅</span>
            <div class="suffix-input">
              <input id="dcaDropPct" type="number" min="0.01" max="99.99" step="0.01" inputmode="decimal" value="4">
              <span>%</span>
            </div>
          </label>
        </div>
        <div class="dca-table-wrap">
          <table class="dca-table">
            <thead><tr><th>次数</th><th>买入点位</th><th>较上次下跌</th><th>较首次下跌</th></tr></thead>
            <tbody id="dcaRows"></tbody>
          </table>
          <div class="dca-empty" id="dcaEmpty">输入初次买入点位后，会自动生成 10 个买入点位。</div>
        </div>
      </section>
      <div class="table-card" id="tableView" hidden>
        <div class="table-heading"><strong id="tableTitle">明细数据</strong><span id="tableCount"></span></div>
        <div class="table-scroll"><table><thead><tr><th>日期</th><th id="metricColumn">指标值</th><th>指数点位</th><th>相对前值</th></tr></thead><tbody id="detailRows"></tbody></table></div>
      </div>
    </section>
  `;

  bindDetailControls(secid, quote);
  bindDcaCalculator();
  buildMetricTabs(secid, quote, val);
  // 进入详情页才按需加载 echarts；失败不致命，renderChart 会降级，统计/明细照常可用。
  await loadECharts().catch(() => {});
  if (location.hash !== reqHash) return;
  drawDetail(secid, quote);
  // 故意用赋值（单例）而非 addEventListener：每次进详情页覆盖上一个，天然避免反复进出累积监听泄漏。
  window.onresize = () => chart && chart.resize();

  // 基金详情页：渲染跟踪关联卡片（本地数据先点亮，实时点位后台补）
  // 先把卡片骨架渲染出来（含 #trackPoint / #trackPremium），再后台补实时点位与溢价率，
  // 避免 refresh* 在卡片 DOM 就位前查不到元素。
  if (fund) renderTrackingCard(fund, val).then(() => { refreshTrackPoint(fund); refreshPremium(fund); });

  // 首屏已用本地数据渲染完成；实时行情/K线到了再补价格与最新点位，不让它拖慢页面。
  if (renderedFromLocal) {
    livePromise.then(([q, k]) => {
      if (location.hash !== reqHash) return;
      updateMarketQuote(q);
      if (k && k.rows && k.rows.length) { klineCache[secid] = k; drawDetail(secid, q); }
    });
  }
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
    document.getElementById("dcaCalculator").hidden = detailState.view !== "stats";
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

function bindDcaCalculator() {
  const initialInput = document.getElementById("dcaInitialPrice");
  const countInput = document.getElementById("dcaCount");
  const dropInput = document.getElementById("dcaDropPct");
  const resetButton = document.getElementById("dcaReset");
  if (!initialInput || !countInput || !dropInput || !resetButton) return;
  Object.assign(dcaState, { initialPrice: null, count: 10, dropPct: 4 });
  const normalizeCountInput = () => {
    const count = Math.floor(Number(countInput.value));
    return Number.isFinite(count) ? Math.max(1, Math.min(DCA_MAX_COUNT, count)) : null;
  };
  const parseNumber = (raw) => (raw === "" || !Number.isFinite(Number(raw)) ? null : Number(raw));
  const sync = () => {
    const normalizedCount = normalizeCountInput();
    if (normalizedCount != null && countInput.value !== String(normalizedCount)) countInput.value = String(normalizedCount);
    dcaState.initialPrice = parseNumber(initialInput.value);
    dcaState.count = normalizedCount;
    dcaState.dropPct = parseNumber(dropInput.value);
    renderDcaRows();
  };
  initialInput.value = "";
  countInput.value = "10";
  dropInput.value = "4";
  [initialInput, countInput, dropInput].forEach((input) => input.addEventListener("input", sync));
  resetButton.addEventListener("click", () => {
    initialInput.value = "";
    countInput.value = "10";
    dropInput.value = "4";
    sync();
    initialInput.focus();
  });
  renderDcaRows();
}

function renderDcaRows() {
  const rowsEl = document.getElementById("dcaRows");
  const emptyEl = document.getElementById("dcaEmpty");
  if (!rowsEl || !emptyEl) return;
  const levels = Core.calculateDcaLevels(dcaState);
  emptyEl.hidden = levels.length > 0;
  rowsEl.innerHTML = levels.map((level) => `
    <tr>
      <td>第 ${level.round} 次</td>
      <td>${fmt(level.price)}</td>
      <td>${level.round === 1 ? "—" : "-" + level.dropFromPreviousPct.toFixed(2) + "%"}</td>
      <td>${level.round === 1 ? "—" : "-" + level.dropFromInitialPct.toFixed(2) + "%"}</td>
    </tr>
  `).join("");
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

// 估值缓存以 code 为键，这里仅从 secid 推出 code（不依赖易变的实时 quote）。
// 基金（ETF）自身无估值数据，统一映射到它跟踪的指数 code（trackIndex），借用该指数的
// data/<code>.json。键只由 secid 决定，保证 loadValuation(首屏 quote=null) 的写入键与之后
// 各处带 quote 查询时的键完全一致——否则远程搜索进入、且 quote.code≠secid 后缀的指数会因
// 写/读键不同而把已加载的估值当成“无数据”静默丢失。
function secid_to_code(secid) {
  const fund = FUNDS.find((f) => f.secid === secid);
  if (fund) return fund.trackIndex;
  const known = POPULAR.find((p) => p.secid === secid);
  if (known) return known.code;
  return secid.split(".")[1];
}

function renderStats(stats, metric) {
  const box = document.getElementById("stats");
  document.getElementById("statsTitle").textContent = "统计概览";
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
  const zone = p >= 80 ? "high" : p <= 20 ? "low" : "mid";
  // 估值类（PE/PB）分位越高越贵；股息率越高越好；点位无估值含义，只描述高低位。
  let verdict, color;
  if (metric.higherIsBetter) {                // 股息率
    verdict = zone === "high" ? "股息偏高" : zone === "low" ? "股息偏低" : "股息适中";
    color = zone === "high" ? "var(--chance)" : zone === "low" ? "var(--danger)" : "var(--median)";
  } else if (metric.short === "点位") {        // 指数点位
    verdict = zone === "high" ? "处于历史高位" : zone === "low" ? "处于历史低位" : "处于历史中位";
    color = zone === "high" ? "var(--danger)" : zone === "low" ? "var(--chance)" : "var(--median)";
  } else {                                     // 市盈率 / 市净率
    verdict = zone === "high" ? "估值偏高" : zone === "low" ? "估值偏低" : "估值合理";
    color = zone === "high" ? "var(--danger)" : zone === "low" ? "var(--chance)" : "var(--median)";
  }
  box.innerHTML = `当前${metric.short} <b style="color:${color}">${verdict}</b> · 历史分位 ${p.toFixed(1)}%`;
}

// 估值状态语义：与 renderPctBadge 同口径（PE/PB 越高越贵）
function valuationVerdict(stats) {
  if (!stats) return { text: "—", color: "var(--ink-3)" };
  const p = Math.max(0, Math.min(100, stats.percentile));
  const zone = p >= 80 ? "high" : p <= 20 ? "low" : "mid";
  const text = zone === "high" ? "偏高估" : zone === "low" ? "偏低估" : "估值合理";
  const color = zone === "high" ? "var(--danger)" : zone === "low" ? "var(--chance)" : "var(--median)";
  return { text, color, pct: p };
}

// 渲染基金「跟踪关联」卡片。val=已加载的指数估值；fund=funds.json 条目。
async function renderTrackingCard(fund, val) {
  const box = document.getElementById("trackingCard");
  if (!box || !fund) return;
  const idxObj = POPULAR.find((p) => p.code === fund.trackIndex);
  const idxName = (idxObj && idxObj.name) || fund.trackIndex;
  const idxSecid = idxObj && idxObj.secid;

  // 1) 估值状态（指数 PE 优先，缺则 PB）；缺数据则置灰
  const peStats = val && Core.hasSeries(val.pe) ? Core.analyze(val.pe) : null;
  const pbStats = !peStats && val && Core.hasSeries(val.pb) ? Core.analyze(val.pb) : null;
  const vStats = peStats || pbStats;
  const vKind = peStats ? "PE" : pbStats ? "PB" : "";
  const verdict = valuationVerdict(vStats);
  const verdictHTML = vStats
    ? `<b style="color:${verdict.color}">${verdict.text}</b>`
    : `<b class="tk-muted">—</b>`;
  const verdictLabel = vKind && vStats
    ? `指数估值 (${vKind} 分位 ${verdict.pct != null ? verdict.pct.toFixed(1) + "%" : "—"})`
    : "指数估值";

  // 2) 溢价率：基金实时市价 vs 盘中估值(IOPV≈estimate)。市价由 refreshPremium 后台补；
  //    这里先放占位。快照里连 estimate(IOPV) 都没有才直接「暂不可用」置灰。
  const snap = await loadFundNav();
  const s = snap && snap[fund.code];
  const premiumHTML = (s && s.estimate != null)
    ? `<b id="trackPremium" class="tk-muted">加载中…</b>`
    : `<b id="trackPremium" class="tk-muted">暂不可用</b>`;

  // 3) 跟踪误差（净值历史 × 指数 close）；无 close 或无净值历史则置灰
  const histAll = await loadFundNavHist();
  const h = histAll && histAll[fund.code];
  let teHTML;
  if (h && h.navDates && h.nav && h.nav.length > 0 && val && Core.hasSeries(val.close)) {
    const t = Core.calculateTracking(h.navDates, h.nav, val.dates, val.close, { years: 1 });
    if (t) {
      const devKlass = t.deviation >= 0 ? "up" : "down";
      teHTML = `<b>${(t.annualizedTE * 100).toFixed(2)}%</b>`
        + `<span class="te-dev">近1年偏离 <i class="${devKlass}">${t.deviation >= 0 ? "+" : ""}${(t.deviation * 100).toFixed(2)}%</i></span>`;
    } else {
      teHTML = `<b class="tk-muted">数据不足</b>`;
    }
  } else {
    // 缺指数历史点位(如纳指/标普无静态 close)或缺基金净值历史，两种情况统一置灰
    teHTML = `<b class="tk-muted">暂不可用</b>`;
  }

  // 4) 点位占位：先用静态 close 末值 + 「快照」标签；refreshTrackPoint 后台补实时值
  const lastClose = val && Core.hasSeries(val.close) ? val.close[val.close.length - 1] : null;
  const pointHTML = lastClose != null
    ? `<span id="trackPoint">${fmt(lastClose)} <span class="point-tag">快照</span></span>`
    : `<span id="trackPoint" class="tk-muted">—</span>`;

  box.innerHTML = `
    <div class="tracking-title">跟踪关联</div>
    <div class="tracking-grid">
      <div class="tk-cell">
        <span class="tk-k">追踪指数</span>
        <span class="tk-v">${idxSecid ? `<a href="#/idx/${idxSecid}">${idxName}</a>` : idxName} <i class="tk-code">${fund.trackIndex}</i></span>
      </div>
      <div class="tk-cell">
        <span class="tk-k">${verdictLabel}</span>
        <span class="tk-v">${verdictHTML}</span>
      </div>
      <div class="tk-cell">
        <span class="tk-k">指数当前点位</span>
        <span class="tk-v">${pointHTML}</span>
      </div>
      <div class="tk-cell">
        <span class="tk-k">溢价率(实时)</span>
        <span class="tk-v">${premiumHTML}</span>
      </div>
      <div class="tk-cell tk-te">
        <span class="tk-k">近1年跟踪误差(年化)</span>
        <span class="tk-v">${teHTML}</span>
      </div>
    </div>`;
}

// 指数实时点位后台补：行情到了就更新 #trackPoint，覆盖静态快照值。
async function refreshTrackPoint(fund) {
  if (!fund) return;
  const idxObj = POPULAR.find((p) => p.code === fund.trackIndex);
  if (!idxObj) return;
  const q = await EM.quote(idxObj.secid).catch(() => null);
  const el = document.getElementById("trackPoint");
  if (!el || !q || q.price == null) return;
  el.className = cls(q.pct);
  el.innerHTML = `${fmt(q.price)} <span class="point-tag ${cls(q.pct)}">${fmtPct(q.pct)}</span>`;
}

// 溢价率后台补：基金实时市价(EM.quote 自身 secid) vs 盘中估值(IOPV≈快照 estimate)。
// (市价 - IOPV)/IOPV 才是真·溢价/折价率；缺市价或缺 IOPV 则保持置灰。
async function refreshPremium(fund) {
  if (!fund) return;
  const snap = await loadFundNav();
  const s = snap && snap[fund.code];
  const el = document.getElementById("trackPremium");
  if (!el || !s || s.estimate == null) return;          // 无 IOPV，保持「暂不可用」
  const q = await EM.quote(fund.secid).catch(() => null);
  if (!q || q.price == null) { el.textContent = "—"; el.className = "tk-muted"; return; }
  const prem = (q.price - s.estimate) / s.estimate * 100;
  el.className = prem > 0 ? "up" : prem < 0 ? "down" : "flat";
  el.innerHTML = `${prem >= 0 ? "溢价 " : "折价 "}${Math.abs(prem).toFixed(2)}%`;
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
  const hit = (arr, type) => arr
    .filter((p) => p.name.toLowerCase().includes(kw) || p.code.toLowerCase().includes(kw))
    .map((p) => ({ secid: p.secid, code: p.code, name: p.name, type }));
  return hit(POPULAR, "指数").concat(hit(FUNDS, "基金"));
}
function renderSuggest(list) {
  curResults = list; activeIdx = -1;
  if (!list.length) { suggestBox.innerHTML = `<div class="suggest-empty">未找到匹配的指数或基金</div>`; suggestBox.hidden = false; return; }
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
  // 本地主表（indexes.json）命中先秒出，保证离线/快速；
  const local = localSearch(kw);
  if (local.length) renderSuggest(local);
  else { suggestBox.innerHTML = `<div class="suggest-empty">搜索中…</div>`; suggestBox.hidden = false; }
  // 始终再拉一次远程（含基金），返回后与本地按 secid 去重合并——
  // 否则关键词命中某个指数时会短路掉基金结果（如「科创50」搜不到对应 ETF）。
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const remote = await EM.suggest(kw);
    if (searchInput.value.trim() !== kw) return;  // 输入已变，丢弃过期结果
    const seen = new Set(local.map((x) => x.secid));
    const merged = local.concat(remote.filter((x) => !seen.has(x.secid)));
    renderSuggest(merged.slice(0, 15));
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
