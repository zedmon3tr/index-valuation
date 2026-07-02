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

  // 板块列表（行业 / 概念）——东方财富板块行情。一次返回每个板块的点位、涨跌幅、总市值、
  // 换手、主力净流入、涨跌家数、领涨股，喂热力图（面积=|涨跌幅|、颜色=涨跌方向）与板块详情。
  // fltt=2&invt=2：数值已格式化为真实小数（涨跌幅如 2.34、市值为元），无需再缩放。
  // dim: "industry"→ t:2（行业，含申万各级板块）、"concept"→ t:3（概念板块）。板块 K 线 secid = f13.f12（如 90.BK1201）。
  // ⚠️ 东财 clist 单页上限 100 条。多页**并行**取（Promise.allSettled）——早先行业串行取 3 页、
  //    每次 12s 超时，弱网下累积超时常导致整体拉取失败；并行后总耗时≈单页、且单页失败不连坐。
  //  - 行业：按市值(fid=f20)倒序取前 3 页仅为「覆盖」（保证申万一级 31 个都在内，下游按名称白名单挑出）；
  //    面积已不看市值，故此排序只影响取全、不影响展示。
  //  - 概念：约 500 个，分批翻 6 页取全集（下游按精选主题白名单挑出约 34 个，确保半导体/AI 等主题恒在）。
  async boards(dim) {
    const t = dim === "concept" ? 3 : 2;
    const fields = "f2,f3,f4,f8,f12,f13,f14,f20,f62,f104,f105,f128,f136,f140,f141";
    const num = (v) => (v == null || v === "-" || !isFinite(v) ? null : Number(v));
    const mapRow = (x) => ({
      secid: `${x.f13}.${x.f12}`, code: x.f12, name: x.f14,
      price: num(x.f2), pct: num(x.f3), chg: num(x.f4), turnover: num(x.f8),
      cap: num(x.f20), inflow: num(x.f62), up: num(x.f104), down: num(x.f105),
      leadName: x.f128 && x.f128 !== "-" ? x.f128 : "", leadPct: num(x.f136),
      leadSecid: x.f140 && x.f141 != null ? `${x.f141}.${x.f140}` : "",
    });
    // po=1 降序 / po=0 升序。fid=f20 市值、fid=f3 涨跌幅。
    const page = (pn, fid, po) => {
      const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=${pn}&pz=100&po=${po}&np=1&fltt=2&invt=2&fid=${fid}&fs=m:90+t:${t}&fields=${fields}&_=${Date.now()}`;
      return jsonp(url, "cb", 12000).then((r) => {
        const d = (r && r.data) || {};
        return Array.isArray(d.diff) ? d.diff : Object.values(d.diff || {});
      });
    };
    // 行业市值前 3 页（含全部申万一级）；概念 6 页 = **全量**（东财概念总数 <600、无第 7 页，故白名单
    // 里的中小市值主题也必在内——勿为省请求把页数砍小，那会重新漏掉中等波动的主题、即最初的 bug）。
    const pageNums = dim === "concept" ? [1, 2, 3, 4, 5, 6] : [1, 2, 3];
    // 限并发 BATCH（与行业同档）——一次性 6 个并行易被东财限流；分批串行、批内并行，单页失败不连坐。
    const BATCH = 3;
    const seen = new Set();
    const all = [];
    for (let i = 0; i < pageNums.length; i += BATCH) {
      const settled = await Promise.allSettled(pageNums.slice(i, i + BATCH).map((pn) => page(pn, "f20", 1)));
      settled.forEach((s) => {
        if (s.status !== "fulfilled" || !Array.isArray(s.value)) return;
        s.value.forEach((x) => {
          if (!x || !x.f12 || !x.f14) return;
          const secid = `${x.f13}.${x.f12}`;
          if (seen.has(secid)) return;   // 去重
          seen.add(secid);
          all.push(mapRow(x));
        });
      });
    }
    return all;
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

/* ---------- 4. 格式化 / 主题与文案辅助 ---------- */
// UI 文案统一走 i18n.js 的字典（默认中文，可切英文）；t() 只翻界面文案，不翻数据。
const t = window.I18N.t;
// 读 design token（styles.css 的 --* 变量）——ECharts 不认 CSS 变量，画图时按当前主题取值。
// 每次绘制现读（而非启动时缓存），主题切换后重绘自然拿到新色。
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
// "#rrggbb" → [r,g,b]（热力图文字色需要画布底色的 RGB 复合基底）
const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const fmt = (x, d = 3) => (x == null || !isFinite(x) ? "—" : x.toFixed(d));
// 东财等外部接口返回的字符串（name/code/secid 等）转义后才能拼进 innerHTML，
// 防止接口被污染或异常返回时注入脚本（本地主表 indexes.json/funds.json 是受信数据，无需转义）。
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtPct = (x) => (x == null ? "—" : (x >= 0 ? "+" : "") + x.toFixed(2) + "%");
const cls = (x) => (x == null ? "flat" : x > 0 ? "up" : x < 0 ? "down" : "flat");

/* ---------- 6. 路由 ---------- */
const view = document.getElementById("view");
// 归一化 hash：首页可能是 "" / "#" / "#/" 三种形态，统一成 "#/"。热力图内嵌首页后，
// 其异步守卫若按 location.hash 严格相等比较，会因首页 hash 形态不同而误判"已离开"、把
// 切维度/刷新的结果整批丢弃。用本函数比较即可消除这种空 hash 抖动。
function routeHash() {
  const h = location.hash;
  return h === "" || h === "#" ? "#/" : h;
}
function router() {
  // preserve flag 在这里统一消费：只有语言/主题切换触发的原地重渲染才为 true，
  // 且只对详情页有意义；其他路由也要把它清掉，否则会漏到下一次进详情页（错保旧状态）。
  const preserve = consumePreserveFlag();
  const hash = location.hash || "#/";
  const mIdx = hash.match(/^#\/idx\/(.+)$/);
  const mBoard = hash.match(/^#\/board\/(.+)$/);
  // 详情页 / 板块详情展开成宽幅工作台，首页保持窄容器（热力图已内嵌首页，无独立页面）。
  view.classList.toggle("view-wide", Boolean(mIdx || mBoard));
  if (mIdx) renderDetail(decodeURIComponent(mIdx[1]), preserve);
  else if (mBoard) renderBoard(decodeURIComponent(mBoard[1]));
  else renderHome();
}
window.addEventListener("hashchange", router);

/* ---------- 7. 首页 ---------- */
// 首页行情短 TTL 缓存：详情页 ↔ 首页来回切时，TTL 内复用上次快照，免重复打东财。
let homeQuoteCache = { ts: 0, q: null };
const HOME_QUOTE_TTL = 15000;

async function renderHome() {
  const reqHash = routeHash();
  // 指数不再按市场分节，统一「全球市场指数」一组（市场由卡片右上角彩色 tag 标注）；基金/ETF 单独一组。
  const indices = POPULAR.filter((p) => p.home);
  const funds = FUNDS.filter((f) => f.home);
  const groupHTML = (title, list) => (list.length
    ? `<div class="section-title">${title}</div><div class="grid">${list.map(cardSkeleton).join("")}</div>` : "");
  view.innerHTML = `
    <section class="hero">
      <h1>${t("hero.title")}</h1>
      <p>${t("hero.sub")}</p>
    </section>
    <section class="home-heatmap">${heatmapModuleHTML()}</section>
    ${groupHTML(t("home.indices"), indices)}
    ${groupHTML(t("home.funds"), funds)}
  `;
  // 热力图：绑定控件并异步加载（不阻塞指数行情；echarts 就绪后再画）
  bindHeatmapControls(reqHash);
  loadECharts().then(() => { if (routeHash() === reqHash) loadBoards(reqHash, false); });
  // 指数 / 基金行情卡片
  const homeList = indices.concat(funds);
  try {
    let q = homeQuoteCache.q;
    if (!q || Date.now() - homeQuoteCache.ts > HOME_QUOTE_TTL) {
      q = await EM.batchQuote(homeList.map((p) => p.secid));
      homeQuoteCache = { ts: Date.now(), q };
    }
    if (routeHash() !== reqHash) return;
    homeList.forEach((p) => {
      const el = document.getElementById("c-" + p.secid.replace(".", "_"));
      const d = q[p.secid];
      if (el) el.innerHTML = cardBody(p, d);
    });
  } catch (e) {
    document.querySelectorAll(".card .skeleton").forEach((s) => (s.textContent = t("home.quoteFailed")));
  }
}
// 市场 tag：A股/港股/美股 用不同颜色小标签；基金（市场="基金 / ETF"）已单独成组、不标。
// 主表 market 字段固定中文（"A股"等），这里映射到样式类与译文（英文界面显示 CN/HK/US）。
function marketTag(market) {
  const k = { "A股": "a", "港股": "hk", "美股": "us" }[market];
  const label = { a: t("market.cn"), hk: t("market.hk"), us: t("market.us") }[k];
  return k ? `<span class="mkt-tag mkt-${k}">${label}</span>` : "";
}
function cardSkeleton(p) {
  return `<div class="card" id="c-${p.secid.replace(".", "_")}" onclick="location.hash='#/idx/${p.secid}'">${cardBody(p, null)}</div>`;
}
function cardBody(p, d) {
  const head = `<div class="card-head"><span class="nm">${escapeHtml((d && d.name) || p.name)}</span>${marketTag(p.market)}</div><div class="cd">${p.code}</div>`;
  if (!d) return `${head}<div class="px"><span class="skeleton">${t("common.loading")}</span></div>`;
  return `${head}
    <div class="px">
      <span class="price">${fmt(d.price)}</span>
      <span class="chg ${cls(d.pct)}">${fmtPct(d.pct)}</span>
    </div>`;
}

/* ---------- 8. 详情页 ---------- */
const klineCache = {};
let chart = null;
// 文案统一在渲染时经 t("range.<k>") / t("period.<k>") / mtx() 取当前语言。
const RANGES = [
  { k: "1Y", days: 365 },
  { k: "3Y", days: 365 * 3 },
  { k: "5Y", days: 365 * 5 },
  { k: "10Y", days: 365 * 10 },
  { k: "ALL", days: 1e9 },
  { k: "CUSTOM", days: null },
];
// 周期：日/周/月。周线=每周最后一个交易日值、月线=每月最后一个交易日值
// （见 valuation-core.js resampleSeries 的分桶取末值规则）。
const PERIODS = [{ k: "D" }, { k: "W" }, { k: "M" }];
const METRICS = {
  close: { key: "close" },
  pe: { key: "pe" },
  pb: { key: "pb" },
  dy: { key: "dy", unit: "%", higherIsBetter: true },
};
// 指标文案：mtx(metric, "label"|"short"|"current") → 当前语言文本
const mtx = (metric, field) => t(`metric.${metric.key}.${field}`);
const detailState = {
  range: "10Y",
  metric: "close",
  period: "W",  // 默认周线（每周最后交易日值）；用户可在周期分段控件切日/月
  ma: 0,
  view: "stats",
  showQuantiles: true,
  showStd: false,
  showBand: false,   // 通道带（双 EMA 价格通道）默认关，勾选才叠加
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

// 语言/主题切换会原地重渲染当前页（rerenderForPrefs → router）。这个一次性 flag 让
// renderDetail 跳过状态重置、并在渲染后把控件回放到 detailState/dcaState 的当前值。
let preserveDetailStateOnce = false;
function consumePreserveFlag() {
  const v = preserveDetailStateOnce;
  preserveDetailStateOnce = false;
  return v;
}
// 详情页模板默认渲染"统计视图 + 分位线开"，preserve 重渲染后按 state 回放二级控件。
// （时间范围/周期/指标的 active 态已由模板按 detailState 输出，无需在此处理。）
function syncDetailControls() {
  document.querySelectorAll("#viewTabs .segment").forEach((item) => item.classList.toggle("active", item.dataset.view === detailState.view));
  document.getElementById("statsView").hidden = detailState.view !== "stats";
  document.getElementById("dcaCalculator").hidden = detailState.view !== "stats";
  document.getElementById("tableView").hidden = detailState.view !== "table";
  document.getElementById("quantileToggle").checked = detailState.showQuantiles;
  document.getElementById("stdToggle").checked = detailState.showStd;
  document.getElementById("bandToggle").checked = detailState.showBand;
  document.getElementById("maSelect").value = String(detailState.ma);
  document.getElementById("customRange").hidden = detailState.range !== "CUSTOM";
  document.getElementById("customStart").value = detailState.customStart;
  document.getElementById("customEnd").value = detailState.customEnd;
}

// 顶部实时行情区的 HTML。quote 有值显示价格；为空时按是否仍在加载显示「加载中」或「不可用」。
function marketQuoteHTML(quote, pending) {
  if (quote && quote.price != null) {
    // chg 缺失时只显示涨跌幅、不拼出 "—" 脏字符；price 缺失则视作无快照，走下方占位分支。
    const chg = quote.chg == null ? "" : `  ${quote.chg >= 0 ? "+" : ""}${fmt(quote.chg)}`;
    return `<strong class="${cls(quote.pct)}">${fmt(quote.price)}</strong>
          <span class="${cls(quote.pct)}">${fmtPct(quote.pct)}${chg}</span>`;
  }
  return `<span class="quote-pending">${pending ? t("quote.pending") : t("quote.unavailable")}</span>`;
}
function updateMarketQuote(quote) {
  const el = document.getElementById("marketQuote");
  if (el) el.innerHTML = marketQuoteHTML(quote, false);
}

async function renderDetail(secid, preserve) {
  const reqHash = location.hash;
  const known = POPULAR.find((p) => p.secid === secid);
  const fund = FUNDS.find((f) => f.secid === secid);
  view.innerHTML = `<div class="loading">${t("common.loading")}</div>`;

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

  const name = escapeHtml((quote && quote.name) || (kdata && kdata.name) || localName || secid);
  // 展示用 code 取标的自身（基金显示自己的代码）；估值用 code 走 secid_to_code（基金→跟踪指数）。
  const code = (quote && quote.code) || (fund && fund.code) || (known && known.code) || secid.split(".")[1];
  const trackName = fund ? ((POPULAR.find((p) => p.code === fund.trackIndex) || {}).name || fund.trackIndex) : "";
  klineCache[secid] = kdata && kdata.rows && kdata.rows.length ? kdata : { rows: [] };
  const hasPoint = !!(val && Core.hasSeries(val.close)) || klineCache[secid].rows.length > 0;
  if (!hasPoint && !hasVal) {
    view.innerHTML = `<div class="error">${t("detail.notFound")}<br><a class="back" href="#/">${t("backLink.home")}</a></div>`;
    return;
  }
  // 优先默认显示估值指标（点位会作为叠加线始终展示）；仅有点位数据的指数才默认点位。
  // 语言/主题切换触发的原地重渲染（preserve，由 router 传入）保留用户当前筛选状态，不回到默认。
  if (!preserve) {
    const defaultMetric = (val && Core.hasSeries(val.pe)) ? "pe" : (val && Core.hasSeries(val.pb)) ? "pb" : (val && Core.hasSeries(val.dy)) ? "dy" : "close";
    Object.assign(detailState, { range: "10Y", metric: defaultMetric, period: "W", ma: 0, view: "stats", showQuantiles: true, showStd: false, showBand: false, customStart: "", customEnd: "" });
  }

  view.innerHTML = `
    <section class="detail-workspace">
      <div class="analysis-toolbar">
        <div class="control-row">
          <div class="control-group range-control">
            <span class="control-label">${t("toolbar.range")}</span>
            <div class="segmented" id="rangeTabs">
              ${RANGES.map((r) => `<button class="segment ${r.k === detailState.range ? "active" : ""}" data-range="${r.k}">${t("range." + r.k)}</button>`).join("")}
            </div>
          </div>
          <div class="control-group period-control">
            <span class="control-label">${t("toolbar.period")}</span>
            <div class="segmented" id="periodTabs">
              ${PERIODS.map((p) => `<button class="segment ${p.k === detailState.period ? "active" : ""}" data-period="${p.k}">${t("period." + p.k)}</button>`).join("")}
            </div>
          </div>
          <div class="control-group metric-control">
            <span class="control-label">${t("toolbar.metric")}</span>
            <div class="segmented" id="metricTabs"></div>
          </div>
        </div>
        <div class="control-row secondary-controls">
          <div class="segmented view-switch" id="viewTabs">
            <button class="segment active" data-view="stats">${t("view.stats")}</button>
            <button class="segment" data-view="table">${t("view.table")}</button>
          </div>
          <label class="toggle-control"><input id="quantileToggle" type="checkbox" checked><span>${t("toggle.quantiles")}</span></label>
          <label class="toggle-control"><input id="stdToggle" type="checkbox"><span>${t("toggle.std")}</span></label>
          <label class="toggle-control"><input id="bandToggle" type="checkbox"><span>${t("toggle.band")}</span></label>
          <label class="select-control"><span>${t("toolbar.ma")}</span><select id="maSelect"><option value="0">${t("ma.none")}</option><option value="20">${t("ma.n", { n: 20 })}</option><option value="60">${t("ma.n", { n: 60 })}</option><option value="120">${t("ma.n", { n: 120 })}</option></select></label>
          <div class="custom-range" id="customRange" hidden>
            <input id="customStart" type="date" aria-label="${t("custom.start")}">
            <span>${t("custom.to")}</span>
            <input id="customEnd" type="date" aria-label="${t("custom.end")}">
          </div>
        </div>
      </div>

      ${hasPoint ? "" : `<div class="feed-notice">${t("feed.noPoint")}</div>`}
      ${fund ? `<div class="feed-notice">${t("feed.fund", { name, track: trackName, code: fund.trackIndex })}</div>` : ""}
      ${fund ? `<section class="tracking-card" id="trackingCard" aria-label="${t("tracking.title")}"><div class="tracking-loading">${t("tracking.loading")}</div></section>` : ""}

      <div class="instrument-strip">
        <div>
          <a class="back" href="#/">${fund ? t("back.home") : t("back.list")}</a>
          <div class="instrument-title"><strong>${name}</strong>${marketTag((known && known.market) || (fund && fund.market) || "")}<span class="instrument-code">${escapeHtml(code)}</span></div>
        </div>
        <div class="market-quote" id="marketQuote">${marketQuoteHTML(quote, renderedFromLocal)}</div>
      </div>

      <div class="analysis-card" id="statsView">
        <aside class="stats-pane">
          <div class="pane-title" id="statsTitle">${t("stats.title")}</div>
          <div class="stats" id="stats"></div>
        </aside>
        <div class="chart-pane">
          <div class="chart-heading">
            <div><strong id="chartTitle">${t("metric.close.label")}</strong><span id="coverageBadge"></span></div>
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
            <strong id="dcaTitle">${t("dca.title")}</strong>
            <span>${t("dca.sub")}</span>
          </div>
          <button class="reset-button" id="dcaReset" type="button">${t("dca.reset")}</button>
        </div>
        <div class="dca-controls">
          <label>
            <span>${t("dca.initial")}</span>
            <input id="dcaInitialPrice" type="number" min="0" step="0.01" inputmode="decimal" placeholder="${t("dca.initialPh")}">
          </label>
          <label>
            <span>${t("dca.count")}</span>
            <input id="dcaCount" type="number" min="1" max="60" step="1" inputmode="numeric" value="10">
          </label>
          <label>
            <span>${t("dca.drop")}</span>
            <div class="suffix-input">
              <input id="dcaDropPct" type="number" min="0.01" max="99.99" step="0.01" inputmode="decimal" value="4">
              <span>%</span>
            </div>
          </label>
        </div>
        <div class="dca-table-wrap">
          <table class="dca-table">
            <thead><tr><th>${t("dca.round")}</th><th>${t("dca.buyLevel")}</th><th>${t("dca.fromPrev")}</th><th>${t("dca.fromFirst")}</th></tr></thead>
            <tbody id="dcaRows"></tbody>
          </table>
          <div class="dca-empty" id="dcaEmpty">${t("dca.empty")}</div>
        </div>
      </section>
      <div class="table-card" id="tableView" hidden>
        <div class="table-heading"><strong id="tableTitle">${t("table.titleDefault")}</strong><span id="tableCount"></span></div>
        <div class="table-scroll"><table><thead><tr><th>${t("table.date")}</th><th id="metricColumn">${t("table.value")}</th><th>${t("table.point")}</th><th>${t("table.change")}</th></tr></thead><tbody id="detailRows"></tbody></table></div>
      </div>
    </section>
  `;

  bindDetailControls(secid, quote);
  bindDcaCalculator(preserve);
  if (preserve) syncDetailControls();
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
  if (fund) renderTrackingCard(fund, val, reqHash).then(() => { refreshTrackPoint(fund, reqHash); refreshPremium(fund, reqHash); });

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
  document.getElementById("bandToggle").onchange = (event) => { detailState.showBand = event.target.checked; redraw(); };
  document.getElementById("customStart").onchange = (event) => { detailState.customStart = event.target.value; redraw(); };
  document.getElementById("customEnd").onchange = (event) => { detailState.customEnd = event.target.value; redraw(); };
}

function bindDcaCalculator(preserve) {
  const initialInput = document.getElementById("dcaInitialPrice");
  const countInput = document.getElementById("dcaCount");
  const dropInput = document.getElementById("dcaDropPct");
  const resetButton = document.getElementById("dcaReset");
  if (!initialInput || !countInput || !dropInput || !resetButton) return;
  if (!preserve) Object.assign(dcaState, { initialPrice: null, count: 10, dropPct: 4 });
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
  initialInput.value = preserve && dcaState.initialPrice != null ? String(dcaState.initialPrice) : "";
  countInput.value = preserve && dcaState.count != null ? String(dcaState.count) : "10";
  dropInput.value = preserve && dcaState.dropPct != null ? String(dcaState.dropPct) : "4";
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
      <td>${t("dca.roundN", { n: level.round })}</td>
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
    return `<button class="segment${active}" data-metric="${m}"${on ? "" : ` disabled title="${t("metric.noData")}"`}>${mtx(METRICS[m], "short")}</button>`;
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
  renderChart(series, pointValues, stats, metric, secid);
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
  document.getElementById("statsTitle").textContent = t("stats.title");
  if (!stats) {
    box.innerHTML = `<div class="empty-state">${t("stats.empty")}</div>`;
    return;
  }
  const value = (number) => fmt(number) + (metric.unit || "");
  const bands = Core.semanticBands(stats, metric.higherIsBetter);
  box.innerHTML = `
    <div class="row primary"><span class="k">${mtx(metric, "current")}</span><span class="v">${value(stats.current)}</span></div>
    <div class="row primary"><span class="k">${t("stats.percentile")}</span><span class="v">${stats.percentile.toFixed(2)}%</span></div>
    <div class="row"><span class="k"><span class="line-key danger"></span>${t("stats.danger", { p: metric.higherIsBetter ? 20 : 80 })}</span><span class="v">${value(bands.danger)}</span></div>
    <div class="row"><span class="k"><span class="line-key median"></span>${t("stats.median")}</span><span class="v">${value(stats.median)}</span></div>
    <div class="row"><span class="k"><span class="line-key chance"></span>${t("stats.chance", { p: metric.higherIsBetter ? 80 : 20 })}</span><span class="v">${value(bands.chance)}</span></div>
    <div class="row divider"><span class="k">${t("stats.max")}</span><span class="v">${value(stats.max)}</span></div>
    <div class="row"><span class="k">${t("stats.mean")}</span><span class="v">${value(stats.mean)}</span></div>
    <div class="row"><span class="k">${t("stats.min")}</span><span class="v">${value(stats.min)}</span></div>
    <div class="row"><span class="k">${t("stats.stdUpper")}</span><span class="v">${value(stats.stdUpper)}</span></div>
    <div class="row"><span class="k">${t("stats.stdLower")}</span><span class="v">${value(stats.stdLower)}</span></div>
    <div class="row"><span class="k">${t("stats.std")}</span><span class="v">${value(stats.std)}</span></div>
    <div class="row"><span class="k">${t("stats.z")}</span><span class="v">${fmt(stats.z)}</span></div>
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
    verdict = t(`verdict.dy.${zone}`);
    color = zone === "high" ? "var(--chance)" : zone === "low" ? "var(--danger)" : "var(--median)";
  } else if (metric.key === "close") {         // 指数点位
    verdict = t(`verdict.close.${zone}`);
    color = zone === "high" ? "var(--danger)" : zone === "low" ? "var(--chance)" : "var(--median)";
  } else {                                     // 市盈率 / 市净率
    verdict = t(`verdict.val.${zone}`);
    color = zone === "high" ? "var(--danger)" : zone === "low" ? "var(--chance)" : "var(--median)";
  }
  box.innerHTML = t("badge.text", { short: mtx(metric, "short"), color, verdict, p: p.toFixed(1) });
}

// 估值状态语义：与 renderPctBadge 同口径（PE/PB 越高越贵）
function valuationVerdict(stats) {
  if (!stats) return { text: "—", color: "var(--ink-3)" };
  const p = Math.max(0, Math.min(100, stats.percentile));
  const zone = p >= 80 ? "high" : p <= 20 ? "low" : "mid";
  const text = t(`verdict.tk.${zone}`);
  const color = zone === "high" ? "var(--danger)" : zone === "low" ? "var(--chance)" : "var(--median)";
  return { text, color, pct: p };
}

// 渲染基金「跟踪关联」卡片。val=已加载的指数估值；fund=funds.json 条目。
async function renderTrackingCard(fund, val, reqHash) {
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
    ? t("tk.valuationPct", { kind: vKind, p: verdict.pct != null ? verdict.pct.toFixed(1) + "%" : "—" })
    : t("tk.valuation");

  // 2) 溢价率：基金实时市价 vs 盘中估值(IOPV≈estimate)。市价由 refreshPremium 后台补；
  //    这里先放占位。快照里连 estimate(IOPV) 都没有才直接「暂不可用」置灰。
  const snap = await loadFundNav();
  const s = snap && snap[fund.code];
  const premiumHTML = (s && s.estimate != null)
    ? `<b id="trackPremium" class="tk-muted">${t("common.loading")}</b>`
    : `<b id="trackPremium" class="tk-muted">${t("tk.na")}</b>`;

  // 3) 跟踪误差（净值历史 × 指数 close）；无 close 或无净值历史则置灰
  const histAll = await loadFundNavHist();
  const h = histAll && histAll[fund.code];
  let teHTML;
  if (h && h.navDates && h.nav && h.nav.length > 0 && val && Core.hasSeries(val.close)) {
    // 变量名避开 trk→t：全局 t() 是翻译函数，这里若命名 t 会把它遮蔽
    const trk = Core.calculateTracking(h.navDates, h.nav, val.dates, val.close, { years: 1 });
    if (trk) {
      const devKlass = trk.deviation >= 0 ? "up" : "down";
      teHTML = `<b>${(trk.annualizedTE * 100).toFixed(2)}%</b>`
        + `<span class="te-dev">${t("tk.teDev")} <i class="${devKlass}">${trk.deviation >= 0 ? "+" : ""}${(trk.deviation * 100).toFixed(2)}%</i></span>`;
    } else {
      teHTML = `<b class="tk-muted">${t("tk.insufficient")}</b>`;
    }
  } else {
    // 缺指数历史点位(如纳指/标普无静态 close)或缺基金净值历史，两种情况统一置灰
    teHTML = `<b class="tk-muted">${t("tk.na")}</b>`;
  }

  // 4) 点位占位：先用静态 close 末值 + 「快照」标签；refreshTrackPoint 后台补实时值
  const lastClose = val && Core.hasSeries(val.close) ? val.close[val.close.length - 1] : null;
  const pointHTML = lastClose != null
    ? `<span id="trackPoint">${fmt(lastClose)} <span class="point-tag">${t("tk.snapshot")}</span></span>`
    : `<span id="trackPoint" class="tk-muted">—</span>`;

  // 上面 await 期间用户可能已切到别的标的；与 renderDetail 同款守卫，避免把本卡片写进别人页面
  if (reqHash && location.hash !== reqHash) return;
  box.innerHTML = `
    <div class="tracking-title">${t("tracking.title")}</div>
    <div class="tracking-grid">
      <div class="tk-cell">
        <span class="tk-k">${t("tk.index")}</span>
        <span class="tk-v">${idxSecid ? `<a href="#/idx/${idxSecid}">${idxName}</a>` : idxName} <i class="tk-code">${fund.trackIndex}</i></span>
      </div>
      <div class="tk-cell">
        <span class="tk-k">${verdictLabel}</span>
        <span class="tk-v">${verdictHTML}</span>
      </div>
      <div class="tk-cell">
        <span class="tk-k">${t("tk.point")}</span>
        <span class="tk-v">${pointHTML}</span>
      </div>
      <div class="tk-cell">
        <span class="tk-k">${t("tk.premium")}</span>
        <span class="tk-v">${premiumHTML}</span>
      </div>
      <div class="tk-cell tk-te">
        <span class="tk-k">${t("tk.te")}</span>
        <span class="tk-v">${teHTML}</span>
      </div>
    </div>`;
}

// 指数实时点位后台补：行情到了就更新 #trackPoint，覆盖静态快照值。
async function refreshTrackPoint(fund, reqHash) {
  if (!fund) return;
  const idxObj = POPULAR.find((p) => p.code === fund.trackIndex);
  if (!idxObj) return;
  const q = await EM.quote(idxObj.secid).catch(() => null);
  if (reqHash && location.hash !== reqHash) return;   // 行情回来时已切页 → 不写旧数据
  const el = document.getElementById("trackPoint");
  if (!el || !q || q.price == null) return;
  el.className = cls(q.pct);
  el.innerHTML = `${fmt(q.price)} <span class="point-tag ${cls(q.pct)}">${fmtPct(q.pct)}</span>`;
}

// 溢价率后台补：基金实时市价(EM.quote 自身 secid) vs 盘中估值(IOPV≈快照 estimate)。
// (市价 - IOPV)/IOPV 才是真·溢价/折价率；缺市价或缺 IOPV 则保持置灰。
async function refreshPremium(fund, reqHash) {
  if (!fund) return;
  const snap = await loadFundNav();
  if (reqHash && location.hash !== reqHash) return;
  const s = snap && snap[fund.code];
  const el = document.getElementById("trackPremium");
  if (!el || !s || s.estimate == null) return;          // 无 IOPV，保持「暂不可用」
  const q = await EM.quote(fund.secid).catch(() => null);
  if (reqHash && location.hash !== reqHash) return;
  if (!q || q.price == null) { el.textContent = "—"; el.className = "tk-muted"; return; }
  const prem = (q.price - s.estimate) / s.estimate * 100;
  el.className = prem > 0 ? "up" : prem < 0 ? "down" : "flat";
  el.innerHTML = t(prem >= 0 ? "tk.premiumUp" : "tk.premiumDown", { x: Math.abs(prem).toFixed(2) });
}

function renderCoverage(series, metric, source) {
  const first = series.dates[0];
  const last = series.dates[series.dates.length - 1];
  document.getElementById("chartTitle").textContent = mtx(metric, "label");
  document.getElementById("coverageBadge").textContent = first ? t("coverage.range", { first, last }) : t("coverage.none");
  document.getElementById("sourceNote").textContent = t("source.label", { s: source || t("source.default") });
  document.getElementById("snapNote").textContent = first
    ? t("snap.note", { n: series.values.length, first, last })
    : t("snap.empty");
}

function renderDetailTable(series, pointValues, metric) {
  document.getElementById("tableTitle").textContent = t("table.title", { label: mtx(metric, "label") });
  document.getElementById("tableCount").textContent = t("table.count", { n: series.values.length });
  document.getElementById("metricColumn").textContent = mtx(metric, "label");
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

// —— 通道指标（双 EMA 带）——
// 设计逻辑与周期参数：仅源码/CI 可见，界面不展示（无 legend、无 tooltip、无轴外标注）。
// 每条带 = EMA(最高价, hi) 为上轨、EMA(最低价, lo) 为下轨，两线间填充极透明同色。
// 跟随「指数点位」价格线叠加（与之同轴），需勾选「通道带」开关 + 实时 K 线已就绪(提供
// 每根高/低价)；K 线未到则静默不画。周/月级由日线高低价重采样。
// 颜色走 design token（--chart-band-*），绘制时经 cssVar 取当前主题值。
const CHANNEL_BANDS = [
  { id: "f", hi: 24, lo: 23, colorVar: "--chart-band-fast", fillVar: "--chart-band-fast-fill" },
  { id: "s", hi: 89, lo: 90, colorVar: "--chart-band-slow", fillVar: "--chart-band-slow-fill" },
];
const isBandSeries = (name) => String(name).startsWith("__band");

function channelBandSeries(secid, dates, yAxisIndex) {
  const k = klineCache[secid];
  if (!k || !k.rows || !k.rows.length) return [];
  const bars = Core.resampleOhlc(k.rows, detailState.period);
  if (!bars.length) return [];
  const barDates = bars.map((b) => b.date);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const out = [];
  CHANNEL_BANDS.forEach((cfg) => {
    const upper = Core.alignPrevious(dates, barDates, Core.ema(highs, cfg.hi));
    const lower = Core.alignPrevious(dates, barDates, Core.ema(lows, cfg.lo));
    // 堆叠技巧填充两线之间：下轨为堆叠基线(自身不填充)，上轨画「上−下」差值叠在其上，
    // 差值系列的折线落在上轨、areaStyle 填满下轨↔上轨。两系列均静默、不进 legend/tooltip。
    // 必须与「指数点位」线同轴（价格轴）：点位作叠加线时在副轴(1)，点位为主图时在主轴(0)。
    const diff = upper.map((u, i) => (u != null && lower[i] != null ? u - lower[i] : null));
    const color = cssVar(cfg.colorVar);
    const common = { type: "line", yAxisIndex, stack: `band_${cfg.id}`, showSymbol: false, symbol: "none", silent: true, z: 1, emphasis: { disabled: true }, lineStyle: { color, width: 1 }, itemStyle: { color } };
    out.push({ ...common, name: `__band_${cfg.id}_lo`, data: lower, areaStyle: { opacity: 0 } });
    out.push({ ...common, name: `__band_${cfg.id}_hi`, data: diff, areaStyle: { color: cssVar(cfg.fillVar) } });
  });
  return out;
}

function renderChart(series, pointValues, stats, metric, secid) {
  const el = document.getElementById("chart");
  // echarts 未就绪时降级：统计与明细仍可用，仅图表占位提示。
  // 区分「加载中」(promise 进行中——慢网下首屏点击控件会走到这里) 与「加载失败」
  // (onerror 已把 echartsPromise 置空)，避免给用户看错误的"失败"字样。
  // 同时清掉可能指向已 dispose/旧页实例的 chart 句柄，防止 onresize 调到死实例报错。
  if (!window.echarts) {
    if (chart) { try { chart.dispose(); } catch (e) {} chart = null; }
    el.innerHTML = `<div class="chart-fallback">${echartsPromise ? t("chart.loading") : t("chart.failed")}</div>`;
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
  if (bands && detailState.showQuantiles) marks.push(mark(bands.danger, cssVar("--band-danger"), t("mark.danger")), mark(stats.median, cssVar("--band-median"), t("mark.median")), mark(bands.chance, cssVar("--band-chance"), t("mark.chance")));
  if (stats && detailState.showStd) marks.push(mark(stats.stdUpper, cssVar("--chart-ma"), "+1σ"), mark(stats.stdLower, cssVar("--chart-ma"), "-1σ"));
  const maValues = detailState.ma ? Core.movingAverage(series.values, detailState.ma) : null;
  // 配色——统一「线条」与「图例/tooltip 圆点」：ECharts 折线的图例标记和 tooltip 圆点
  // 取的是 itemStyle.color，只设 lineStyle.color 会让它们回退到默认调色板、与线对不上。
  // 故每条线都把 lineStyle.color 与 itemStyle.color 设成同一颜色。
  // 颜色一律现读 design token（--chart-*）：主题切换后的重绘自动拿到当前主题值。
  const POINT_COLOR = cssVar("--chart-point");   // 指数点位：浅绿色 + 色块填充
  const METRIC_COLOR = cssVar("--chart-metric"); // 当前选中的估值指标
  const MA_COLOR = cssVar("--chart-ma");
  const greenArea = { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: cssVar("--chart-point-fill-strong") }, { offset: 1, color: cssVar("--chart-point-fill-weak") },
  ]) };
  // 视觉层级：指数点位是"基准"（浅绿填充、占主视觉）；当前估值指标是"会变化的辅助线"
  // （深蓝细线叠加其上）。仅有点位的指数则点位本身即主体（也用浅绿）。
  const metricColor = showPoint ? METRIC_COLOR : POINT_COLOR;
  const metricLabel = mtx(metric, "label");
  const metricSeries = {
    name: metricLabel, type: "line", data: series.values, showSymbol: false, connectNulls: true,
    lineStyle: { color: metricColor, width: 2 }, itemStyle: { color: metricColor },
    markLine: marks.length ? { symbol: "none", silent: true, data: marks } : undefined,
  };
  if (!showPoint) metricSeries.areaStyle = greenArea;
  const chartSeries = [];
  if (showPoint) chartSeries.push({ name: t("metric.close.label"), type: "line", yAxisIndex: 1, data: pointValues, showSymbol: false, connectNulls: true, lineStyle: { color: POINT_COLOR, width: 1 }, itemStyle: { color: POINT_COLOR }, areaStyle: greenArea });
  chartSeries.push(metricSeries);
  if (maValues) chartSeries.push({ name: `${mtx(metric, "short")} MA${detailState.ma}`, type: "line", data: maValues, showSymbol: false, connectNulls: true, lineStyle: { color: MA_COLOR, width: 1.6 }, itemStyle: { color: MA_COLOR } });
  // 通道带跟着「价格(点位)」走：点位为主图(close)时挂主轴；点位作叠加线时挂副轴、与之同轴。
  // 仅当图上确有价格表达时才画；不进 legend、不进 tooltip（参数不外露）。
  const showBand = detailState.showBand && (detailState.metric === "close" || showPoint);
  const bandSeries = showBand ? channelBandSeries(secid, series.dates, showPoint ? 1 : 0) : [];
  const legendData = chartSeries.map((s) => s.name);

  chart.setOption({
    animation: false,
    grid: { left: 64, right: showPoint ? 72 : 28, top: 40, bottom: 72 },
    legend: { bottom: 8, data: legendData, textStyle: { color: cssVar("--chart-legend-text") } },
    tooltip: {
      trigger: "axis",
      backgroundColor: cssVar("--chart-tooltip-bg"), borderColor: cssVar("--chart-tooltip-border"),
      textStyle: { color: cssVar("--chart-tooltip-ink") },
      formatter: (items) => {
        const rows = items.filter((item) => !isBandSeries(item.seriesName));
        if (!rows.length) return "";
        return `${rows[0].axisValue}<br>${rows.map((item) => `${item.marker}${item.seriesName} <b>${fmt(item.data)}${item.seriesName === metricLabel ? metric.unit || "" : ""}</b>`).join("<br>")}`;
      },
    },
    xAxis: {
      type: "category", data: series.dates, boundaryGap: false,
      axisLine: { lineStyle: { color: cssVar("--chart-axis-line") } },
      axisLabel: { color: cssVar("--chart-axis-label"), fontSize: 11 },
    },
    yAxis: [
      { type: "value", scale: true, name: mtx(metric, "short"), splitLine: { lineStyle: { color: cssVar("--chart-split-line") } }, axisLabel: { color: cssVar("--chart-axis-label"), fontSize: 11 } },
      { type: "value", scale: true, name: t("metric.close.label"), show: showPoint, splitLine: { show: false }, axisLabel: { color: cssVar("--chart-axis-label"), fontSize: 11 } },
    ],
    dataZoom: [
      { type: "inside", start: 0, end: 100 },
      { type: "slider", height: 18, bottom: 38, borderColor: cssVar("--chart-dz-border"), fillerColor: cssVar("--chart-dz-filler"), backgroundColor: cssVar("--chart-dz-bg") },
    ],
    series: [...bandSeries, ...chartSeries],
  });
}

/* ---------- 8b. A股板块热力图 ---------- */
// 维度（行业/概念）与筛选（全部/涨/跌）+ 搜索词存模块级 state：从板块详情页返回时保留上次筛选
//（PRD §4.3）。boards 缓存按维度短 TTL，避免来回切重复打东财。
// 文案渲染时经 t("heat.dim.<k>") / t("heat.filter.<k>") 取当前语言。
const HEAT_DIMS = [{ k: "industry" }, { k: "concept" }];
const HEAT_FILTERS = [{ k: "all" }, { k: "up" }, { k: "down" }];
const HEAT_TTL = 15000;
// 行业维度只取申万一级 31 个板块（按名称匹配——东财 t:2 里申万一级以同名一级板块出现，
// 名称稳定、自动解析其 BK 代码）。东财 t:2 混含申万一/二/三级，若全取会父子重叠、市值重复计，
// treemap 面积口径就乱了；锁定单一的申万一级层级，面积=市值才自洽，也正合 PRD 默认口径。
const SW1_NAMES = new Set(["农林牧渔", "基础化工", "钢铁", "有色金属", "电子", "家用电器", "食品饮料", "纺织服饰", "轻工制造", "医药生物", "公用事业", "交通运输", "房地产", "商贸零售", "社会服务", "综合", "建筑材料", "建筑装饰", "电力设备", "机械设备", "国防军工", "汽车", "计算机", "传媒", "通信", "银行", "非银金融", "煤炭", "石油石化", "环保", "美容护理"]);
const absPct = (b) => Math.abs(b.pct == null ? 0 : b.pct);
// 概念维度改为「精选热门主题」固定集（按东财概念板块名匹配）——保证半导体/AI/算力/机器人等主题
// 始终在场、可搜可筛，而非只看当日异动而漏掉中等波动的主题。名称须与东财概念板块名完全一致。
const CONCEPT_THEMES = new Set([
  "半导体概念", "第三代半导体", "国产芯片", "存储芯片", "AI芯片", "人工智能", "AIGC概念", "AI应用",
  "算力概念", "数据中心", "液冷概念", "消费电子概念", "PCB", "机器人概念", "人形机器人", "信创",
  "云计算", "网络安全", "华为概念", "量子科技", "可控核聚变", "低空经济", "数字货币", "光伏概念",
  "储能概念", "固态电池", "锂电池概念", "军工", "创新药", "减肥药", "医疗器械概念", "白酒",
  "小米汽车", "创新医疗服务",
]);
// 按维度整形：行业→申万一级 31 个；概念→精选主题固定集。两者都是用"名称白名单"过滤东财原始列表，
// 全集展示、不按涨跌方向筛（"全部"自然红绿都有、「仅看上涨/下跌」各取一侧）。
function shapeBoards(dim, boards) {
  const names = dim === "concept" ? CONCEPT_THEMES : SW1_NAMES;
  const sel = boards.filter((b) => names.has(b.name));
  // 白名单依赖东财沿用这些板块名；上游改名或取数缺页会少匹配、静默少画几格 → 数量偏少时告警。
  if (sel.length < names.size) console.warn(`[热力图] ${dim === "concept" ? "精选主题" : "申万一级"}匹配到 ${sel.length}/${names.size} 个（可能东财改名或取数缺页）`);
  return sel;
}
const heatmapState = { dim: "industry", filter: "all", search: "", boards: null, boardsDim: null, ts: 0 };
let heatChart = null;
let heatSearchTimer = null;

// 金额（元）本地化：中文用 万亿/亿/万，英文用西方习惯 T/B/M（单位 CNY）。
const fmtCap = (yuan) => {
  if (yuan == null || !isFinite(yuan)) return "—";
  if (window.I18N.lang === "en") {
    if (yuan >= 1e12) return "¥" + (yuan / 1e12).toFixed(2) + "T";
    if (yuan >= 1e9) return "¥" + (yuan / 1e9).toFixed(1) + "B";
    return "¥" + (yuan / 1e6).toFixed(0) + "M";
  }
  if (yuan >= 1e12) return (yuan / 1e12).toFixed(2) + " 万亿";
  if (yuan >= 1e8) return (yuan / 1e8).toFixed(0) + " 亿";
  return (yuan / 1e4).toFixed(0) + " 万";
};
const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString(window.I18N.lang === "en" ? "en-US" : "zh-CN", { hour12: false }) : "—");

// 内嵌首页的热力图模块标记（标题 + 控件 + 画布）。控件绑定 / 数据加载由 renderHome 负责。
function heatmapModuleHTML() {
  const seg = (items, active, attr, prefix) =>
    items.map((it) => `<button class="segment ${it.k === active ? "active" : ""}" data-${attr}="${it.k}">${t(prefix + it.k)}</button>`).join("");
  return `
    <div class="home-heatmap-head">
      <div class="hh-title"><strong>${t("heat.title")}</strong><span class="hh-sub">${t("heat.sub")}</span></div>
      <div class="heat-foot" id="heatFoot">${t("heat.loading")}</div>
    </div>
    <div class="heat-toolbar">
      <div class="control-group"><span class="control-label">${t("heat.dim")}</span>
        <div class="segmented" id="heatDimTabs">${seg(HEAT_DIMS, heatmapState.dim, "dim", "heat.dim.")}</div></div>
      <div class="control-group"><span class="control-label">${t("heat.filter")}</span>
        <div class="segmented" id="heatFilterTabs">${seg(HEAT_FILTERS, heatmapState.filter, "filter", "heat.filter.")}</div></div>
      <label class="select-control heat-search"><span>${t("heat.search")}</span>
        <input id="heatSearch" type="text" autocomplete="off" placeholder="${t("heat.searchPh")}" value="${heatmapState.search.replace(/"/g, "&quot;")}"></label>
      <button class="reset-button" id="heatRefresh" type="button">${t("heat.refresh")}</button>
    </div>
    <div class="heat-canvas" id="heatCanvas"><div class="heat-skeleton">${t("heat.loading")}</div></div>`;
}

function bindHeatmapControls(reqHash) {
  document.getElementById("heatDimTabs").onclick = (e) => {
    const t = e.target.closest("[data-dim]"); if (!t) return;
    heatmapState.dim = t.dataset.dim;
    document.querySelectorAll("#heatDimTabs .segment").forEach((s) => s.classList.toggle("active", s.dataset.dim === heatmapState.dim));
    loadBoards(reqHash, false);
  };
  document.getElementById("heatFilterTabs").onclick = (e) => {
    const t = e.target.closest("[data-filter]"); if (!t) return;
    heatmapState.filter = t.dataset.filter;
    document.querySelectorAll("#heatFilterTabs .segment").forEach((s) => s.classList.toggle("active", s.dataset.filter === heatmapState.filter));
    drawHeatmap(reqHash);
  };
  document.getElementById("heatSearch").oninput = (e) => {
    heatmapState.search = e.target.value;
    clearTimeout(heatSearchTimer);
    heatSearchTimer = setTimeout(() => { if (routeHash() === reqHash) drawHeatmap(reqHash); }, 200);
  };
  document.getElementById("heatRefresh").onclick = () => loadBoards(reqHash, true);
}

async function loadBoards(reqHash, force) {
  const dim = heatmapState.dim;
  const fresh = heatmapState.boards && heatmapState.boardsDim === dim && Date.now() - heatmapState.ts <= HEAT_TTL;
  if (!force && fresh) { drawHeatmap(reqHash); return; }
  const canvas = document.getElementById("heatCanvas");
  if (canvas && heatmapState.boardsDim !== dim) canvas.innerHTML = `<div class="heat-skeleton">${t("heat.loading")}</div>`;
  try {
    const boards = shapeBoards(dim, await EM.boards(dim));
    if (routeHash() !== reqHash) return;
    if (!boards.length) throw new Error("empty");
    heatmapState.boards = boards; heatmapState.boardsDim = dim; heatmapState.ts = Date.now();
    drawHeatmap(reqHash);
  } catch (e) {
    if (routeHash() !== reqHash) return;
    // 降级：若已有上次成功的同维度快照仍画它；否则提示失败。
    if (heatmapState.boards && heatmapState.boardsDim === dim) drawHeatmap(reqHash);
    else if (canvas) canvas.innerHTML = `<div class="heat-empty">${t("heat.unavailable")}</div>`;
  }
}

function visibleBoards() {
  let list = heatmapState.boards || [];
  if (heatmapState.filter === "up") list = list.filter((b) => b.pct != null && b.pct > 0);
  else if (heatmapState.filter === "down") list = list.filter((b) => b.pct != null && b.pct < 0);
  const kw = heatmapState.search.trim().toLowerCase();
  if (kw) list = list.filter((b) => b.name.toLowerCase().includes(kw));
  return list;
}

function updateHeatFoot(visible) {
  const foot = document.getElementById("heatFoot");
  if (!foot) return;
  const all = heatmapState.boards || [];
  const up = all.filter((b) => b.pct != null && b.pct > 0).length;
  const down = all.filter((b) => b.pct != null && b.pct < 0).length;
  foot.innerHTML = t("heat.foot", { n: visible.length, total: all.length, up, down, time: fmtTime(heatmapState.ts) });
}

function heatTooltip(b) {
  const rows = [
    `<b>${escapeHtml(b.name)}</b>`,
    `${t("heat.tip.pct")} <b class="${cls(b.pct)}">${fmtPct(b.pct)}</b>`,
    b.price != null ? `${t("heat.tip.price")} ${fmt(b.price)}` : "",
    `${t("heat.tip.cap")} ${fmtCap(b.cap)}`,
    b.turnover != null ? `${t("heat.tip.turnover")} ${fmt(b.turnover)}%` : "",
    b.leadName ? `${t("heat.tip.lead")} ${escapeHtml(b.leadName)} <span class="${cls(b.leadPct)}">${fmtPct(b.leadPct)}</span>` : "",
  ].filter(Boolean);
  return rows.join("<br>");
}

// echarts 不可用时的降级榜单：按涨跌幅排序的可点击列表（PRD §10 兜底）。
// 用 data-secid + 事件委托（不在 HTML 属性里内联拼 secid），点击绑定见 drawHeatmap 的降级分支。
function heatListHTML(list) {
  const rows = [...list].sort((a, b) => (b.pct == null ? -1e9 : b.pct) - (a.pct == null ? -1e9 : a.pct))
    .map((b) => `<div class="heat-row" data-secid="${escapeHtml(b.secid)}">
        <span class="hr-name">${escapeHtml(b.name)}</span>
        <span class="hr-cap">${fmtCap(b.cap)}</span>
        <span class="hr-pct ${cls(b.pct)}">${fmtPct(b.pct)}</span></div>`).join("");
  return `<div class="heat-list" id="heatList">${rows}</div>`;
}

function drawHeatmap(reqHash) {
  if (routeHash() !== reqHash) return;
  const canvas = document.getElementById("heatCanvas");
  if (!canvas) return;
  const list = visibleBoards();
  updateHeatFoot(list);
  if (heatChart) { try { heatChart.dispose(); } catch (e) {} heatChart = null; }
  if (!list.length) { canvas.innerHTML = `<div class="heat-empty">${t("heat.emptyFilter")}</div>`; return; }
  if (!window.echarts) {   // 降级为可点击榜单（事件委托读 data-secid）
    canvas.innerHTML = heatListHTML(list);
    const listEl = document.getElementById("heatList");
    if (listEl) listEl.onclick = (e) => { const row = e.target.closest("[data-secid]"); if (row) location.hash = "#/board/" + row.dataset.secid; };
    return;
  }
  canvas.innerHTML = `<div id="heatChart" class="heat-chart"></div>`;
  heatChart = echarts.init(document.getElementById("heatChart"));
  // 面积口径：行业/概念统一 = |涨跌幅|（离 0 越远、格子越大）。市值仅作 tooltip 信息，不再决定面积。
  const area = (b) => Math.max(absPct(b), 0.01);
  // 半透明格子实际叠在画布底色上（亮=白、暗=深灰），文字黑白判定要按同一底色复合。
  const cellBase = hexToRgb(cssVar("--heat-cell-base"));
  const data = list.map((b) => ({
    name: b.name, value: area(b), _b: b,
    itemStyle: { color: Core.heatmapColor(b.pct) },
    label: { color: Core.heatmapTextColor(b.pct, 4, cellBase), formatter: `${b.name}\n${fmtPct(b.pct)}` },
  }));
  heatChart.setOption({
    animation: false,
    tooltip: { backgroundColor: cssVar("--chart-tooltip-bg"), borderColor: cssVar("--chart-tooltip-border"),
      textStyle: { color: cssVar("--chart-tooltip-ink"), fontSize: 12 },
      formatter: (p) => (p.data && p.data._b ? heatTooltip(p.data._b) : "") },
    series: [{
      type: "treemap", roam: false, nodeClick: false, breadcrumb: { show: false },
      left: 0, right: 0, top: 0, bottom: 0,
      label: { show: true, fontSize: 12, lineHeight: 15, overflow: "truncate" },
      itemStyle: { borderColor: cssVar("--heat-cell-base"), borderWidth: 0, gapWidth: 2 },
      data,
    }],
  });
  heatChart.off("click");
  heatChart.on("click", (p) => { const b = p.data && p.data._b; if (b) location.hash = "#/board/" + b.secid; });
  window.onresize = () => heatChart && heatChart.resize();
}

/* ---------- 8c. 板块详情面板 ---------- */
let boardChart = null;

async function renderBoard(secid) {
  const reqHash = location.hash;
  view.innerHTML = `<div class="loading">${t("common.loading")}</div>`;
  const cached = (heatmapState.boards || []).find((b) => b.secid === secid);
  const [quote, kdata] = await Promise.all([EM.quote(secid).catch(() => null), EM.kline(secid).catch(() => null)]);
  if (location.hash !== reqHash) return;
  const hasK = !!(kdata && kdata.rows && kdata.rows.length);
  if (!quote && !hasK && !cached) {
    view.innerHTML = `<div class="error">${t("board.notFound")}<br><a class="back" href="#/">${t("backLink.home")}</a></div>`;
    return;
  }
  const name = escapeHtml((quote && quote.name) || (cached && cached.name) || (kdata && kdata.name) || secid);
  const code = secid.split(".")[1] || secid;
  const price = (quote && quote.price != null) ? quote.price : (cached && cached.price);
  const pct = (quote && quote.pct != null) ? quote.pct : (cached && cached.pct);
  const chg = (quote && quote.chg != null) ? quote.chg : (cached && cached.chg);
  // 板块级补充信息只在从热力图带过来的 cached 里有（实时 quote 不含家数/领涨股）。
  const chips = [];
  if (cached) {
    if (cached.turnover != null) chips.push([t("board.turnover"), fmt(cached.turnover) + "%"]);
    if (cached.cap != null) chips.push([t("board.cap"), fmtCap(cached.cap)]);
    if (cached.inflow != null) chips.push([t("board.inflow"), fmtCap(cached.inflow)]);
    if (cached.up != null && cached.down != null) chips.push([t("board.updown"), `<span class="up">${cached.up}</span> / <span class="down">${cached.down}</span>`]);
    if (cached.leadName) chips.push([t("board.lead"), `${escapeHtml(cached.leadName)} <span class="${cls(cached.leadPct)}">${fmtPct(cached.leadPct)}</span>`]);
  }
  const chgStr = chg == null ? "" : `  ${chg >= 0 ? "+" : ""}${fmt(chg)}`;
  view.innerHTML = `
    <section class="board-workspace">
      <div class="instrument-strip">
        <div><a class="back" href="#/">${t("back.home")}</a>
          <div class="instrument-title"><strong>${name}</strong><span class="instrument-code">${escapeHtml(code)}</span></div></div>
        <div class="market-quote">${price != null
          ? `<strong class="${cls(pct)}">${fmt(price)}</strong><span class="${cls(pct)}">${fmtPct(pct)}${chgStr}</span>`
          : `<span class="quote-pending">${t("quote.unavailable")}</span>`}</div>
      </div>
      ${chips.length ? `<div class="board-chips">${chips.map(([k, v]) => `<div class="board-chip"><span class="bc-k">${k}</span><span class="bc-v">${v}</span></div>`).join("")}</div>` : ""}
      <div class="analysis-card board-card">
        <div class="chart-pane">
          <div class="chart-heading"><strong>${t("board.chart")}</strong></div>
          <div id="boardChart" class="board-chart"></div>
        </div>
      </div>
    </section>`;
  await loadECharts().catch(() => {});
  if (location.hash !== reqHash) return;
  drawBoardChart(kdata);
}

function drawBoardChart(kdata) {
  const el = document.getElementById("boardChart");
  if (!el) return;
  const rows = (kdata && kdata.rows) || [];
  // 早退分支先清掉可能指向旧/已替换容器的实例（与 renderChart 同口径），避免 onresize 调到死实例。
  if (!window.echarts || !rows.length) {
    if (boardChart) { try { boardChart.dispose(); } catch (e) {} boardChart = null; }
    el.innerHTML = `<div class="chart-fallback">${!window.echarts ? (echartsPromise ? t("chart.loading") : t("chart.failedShort")) : t("chart.noK")}</div>`;
    return;
  }
  if (boardChart) boardChart.dispose();
  boardChart = echarts.init(el);
  const dates = rows.map((r) => r.date);
  const candle = rows.map((r) => [r.open, r.close, r.low, r.high]);
  const upColor = cssVar("--up"), downColor = cssVar("--down");
  boardChart.setOption({
    animation: false,
    grid: { left: 56, right: 20, top: 24, bottom: 60 },
    tooltip: { trigger: "axis", axisPointer: { type: "cross" },
      backgroundColor: cssVar("--chart-tooltip-bg"), borderColor: cssVar("--chart-tooltip-border"),
      textStyle: { color: cssVar("--chart-tooltip-ink") } },
    xAxis: { type: "category", data: dates, boundaryGap: true, axisLine: { lineStyle: { color: cssVar("--chart-axis-line") } }, axisLabel: { color: cssVar("--chart-axis-label"), fontSize: 11 } },
    yAxis: { type: "value", scale: true, splitLine: { lineStyle: { color: cssVar("--chart-split-line") } }, axisLabel: { color: cssVar("--chart-axis-label"), fontSize: 11 } },
    dataZoom: [{ type: "inside", start: 70, end: 100 }, { type: "slider", height: 18, bottom: 24, start: 70, end: 100, borderColor: cssVar("--chart-dz-border"), fillerColor: cssVar("--chart-dz-filler"), backgroundColor: cssVar("--chart-dz-bg") }],
    series: [{
      type: "candlestick", data: candle,
      itemStyle: { color: upColor, color0: downColor, borderColor: upColor, borderColor0: downColor },
    }],
  });
  window.onresize = () => boardChart && boardChart.resize();
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
// 类型标签本地化：本地/东财返回的类型是中文（"指数"/"基金"），英文界面映射为 Index/Fund；
// 未知类型（远程回传的其他 SecurityTypeName）原样展示。
const secTypeLabel = (type) => (type === "指数" ? t("type.index") : type === "基金" ? t("type.fund") : type);
function renderSuggest(list) {
  curResults = list; activeIdx = -1;
  if (!list.length) { suggestBox.innerHTML = `<div class="suggest-empty">${t("search.empty")}</div>`; suggestBox.hidden = false; return; }
  suggestBox.innerHTML = list.map((x, i) =>
    `<div class="suggest-item" data-i="${i}" data-secid="${escapeHtml(x.secid)}">
       <span class="nm">${escapeHtml(x.name)}</span><span class="cd">${escapeHtml(x.code)}</span>
       ${x.type ? `<span class="tag">${escapeHtml(secTypeLabel(x.type))}</span>` : ""}
     </div>`).join("");
  suggestBox.hidden = false;
}
// secid 来自外部搜索接口，绝不拼进内联事件属性（曾经的 onmousedown="goto('${secid}')"
// 一旦 secid 含单引号/反斜杠即可逃出字符串注入任意 JS）；统一走 data-secid + 事件委托。
suggestBox.addEventListener("mousedown", (e) => {
  const item = e.target.closest(".suggest-item");
  if (item && item.dataset.secid) window.goto(item.dataset.secid);
});
window.goto = (secid) => { suggestBox.hidden = true; searchInput.value = ""; location.hash = "#/idx/" + secid; };

searchInput.addEventListener("input", () => {
  const kw = searchInput.value.trim();
  if (!kw) { suggestBox.hidden = true; return; }
  // 本地主表（indexes.json）命中先秒出，保证离线/快速；
  const local = localSearch(kw);
  if (local.length) renderSuggest(local);
  else { suggestBox.innerHTML = `<div class="suggest-empty">${t("search.searching")}</div>`; suggestBox.hidden = false; }
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

/* ---------- 10. 主题切换 + 语言切换（导航栏右上角） ---------- */
// 主题：暗色为默认（:root 即暗色 token），仅亮色打 data-theme="light"；持久化 pref-theme。
// 首屏由 index.html <head> 的内联脚本先行应用，避免亮色用户闪暗色。
const THEME_KEY = "pref-theme";
const currentTheme = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
function applyTheme(theme) {
  if (theme === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
  const sw = document.getElementById("themeSwitch");
  if (sw) sw.setAttribute("aria-checked", String(theme === "dark"));
}

// 语言/主题切换后原地重渲染当前页：CSS 部分换主题即时生效，但 ECharts 画布颜色与
// 所有 JS 拼的文案要重画才会更新。preserve flag 让详情页保住用户当前筛选。
function rerenderForPrefs() {
  preserveDetailStateOnce = true;
  applyStaticChrome();
  router();
}

// 静态框架（导航/页脚等非 router 渲染的部分）按当前语言刷新
function applyStaticChrome() {
  document.documentElement.lang = window.I18N.lang === "en" ? "en" : "zh-CN";
  document.title = t("doc.title");
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute("content", t("doc.description"));
  document.getElementById("brandName").textContent = t("brand.name");
  searchInput.placeholder = t("search.placeholder");
  document.getElementById("footerText").textContent = t("footer.text");
  document.getElementById("langCurrent").textContent = window.I18N.lang === "en" ? "English" : "中文";
  document.querySelectorAll("#langDropdown .lang-option").forEach((btn) => btn.classList.toggle("active", btn.dataset.lang === window.I18N.lang));
  const langBtn = document.getElementById("langButton");
  if (langBtn) langBtn.setAttribute("aria-label", t("lang.label"));
  const sw = document.getElementById("themeSwitch");
  if (sw) sw.setAttribute("aria-label", t("theme.toggle"));
}

function bindTopbarPrefs() {
  const sw = document.getElementById("themeSwitch");
  sw.setAttribute("aria-checked", String(currentTheme() === "dark"));
  sw.addEventListener("click", () => {
    applyTheme(currentTheme() === "dark" ? "light" : "dark");
    rerenderForPrefs();
  });

  const menu = document.getElementById("langMenu");
  const button = document.getElementById("langButton");
  const dropdown = document.getElementById("langDropdown");
  const closeDropdown = () => { dropdown.hidden = true; button.setAttribute("aria-expanded", "false"); };
  button.addEventListener("click", () => {
    dropdown.hidden = !dropdown.hidden;
    button.setAttribute("aria-expanded", String(!dropdown.hidden));
  });
  dropdown.addEventListener("click", (e) => {
    const option = e.target.closest("[data-lang]");
    if (!option) return;
    closeDropdown();
    if (option.dataset.lang === window.I18N.lang) return;
    window.I18N.setLang(option.dataset.lang);
    rerenderForPrefs();
  });
  document.addEventListener("click", (e) => { if (!e.target.closest("#langMenu") && !dropdown.hidden) closeDropdown(); });
}

/* ---------- 启动 ---------- */
bindTopbarPrefs();
applyStaticChrome();
loadIndexes().then(router);
