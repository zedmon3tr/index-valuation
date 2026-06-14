/* =========================================================================
 * 指数估值 · 行情分析  —  纯前端静态站 (GitHub Pages)
 * 行情/点位：东方财富 JSONP 接口（callback 绕过 CORS，实时）
 * 估值 PE/PB：data/<code>.json（由 GitHub Actions 跑 akshare 每日预生成）
 * ========================================================================= */

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

  // 全网搜索（任意指数 / 股票），增强搜索
  async suggest(kw) {
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(kw)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=15`;
    try {
      const r = await jsonp(url);
      const data = r && r.QuotationCodeTable && r.QuotationCodeTable.Data ? r.QuotationCodeTable.Data : [];
      return data.map((x) => ({
        secid: x.QuoteID, code: x.Code, name: x.Name, type: x.SecurityTypeName || "",
      }));
    } catch (e) { return []; }
  },
};

/* ---------- 3b. 估值数据（akshare 预生成的 JSON） ---------- */
const valDataCache = {};
async function loadValuation(code) {
  if (code in valDataCache) return valDataCache[code];
  try {
    const r = await fetch("./data/" + code + ".json", { cache: "no-cache" });
    if (!r.ok) throw new Error("404");
    const j = await r.json();
    valDataCache[code] = j;
    return j;
  } catch (e) {
    valDataCache[code] = null;
    return null;
  }
}

/* ---------- 4. 分位统计引擎 ---------- */
function quantile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}
function analyze(values) {
  const v = values.filter((x) => x != null && isFinite(x));
  if (!v.length) return null;
  const sorted = [...v].sort((a, b) => a - b);
  const cur = v[v.length - 1];
  const n = v.length;
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const below = sorted.filter((x) => x <= cur).length;
  return {
    current: cur,
    percentile: (below / n) * 100,        // 当前所处历史分位
    danger: quantile(sorted, 0.7),         // 危险值（高估，70% 分位）
    median: quantile(sorted, 0.5),         // 中位值
    chance: quantile(sorted, 0.3),         // 机会值（低估，30% 分位）
    max: sorted[sorted.length - 1],
    min: sorted[0],
    mean, std,
    z: std ? (cur - mean) / std : 0,
  };
}

/* ---------- 5. 格式化 ---------- */
const fmt = (x, d = 2) => (x == null || !isFinite(x) ? "—" : x.toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtPct = (x) => (x == null ? "—" : (x >= 0 ? "+" : "") + x.toFixed(2) + "%");
const cls = (x) => (x == null ? "flat" : x > 0 ? "up" : x < 0 ? "down" : "flat");

/* ---------- 6. 路由 ---------- */
const view = document.getElementById("view");
function router() {
  const hash = location.hash || "#/";
  const m = hash.match(/^#\/idx\/(.+)$/);
  if (m) renderDetail(decodeURIComponent(m[1]));
  else renderHome();
}
window.addEventListener("hashchange", router);

/* ---------- 7. 首页 ---------- */
async function renderHome() {
  view.innerHTML = `
    <section class="hero">
      <h1>指数估值 · 行情分析</h1>
      <p>搜索任意指数，查看实时点位、涨跌，以及历史点位 / PE / PB 分位分析。</p>
    </section>
    <div class="section-title">主流指数 <small>点击查看分位分析</small></div>
    <div class="grid" id="grid">${POPULAR.map(cardSkeleton).join("")}</div>
  `;
  try {
    const q = await EM.batchQuote(POPULAR.map((p) => p.secid));
    POPULAR.forEach((p) => {
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
  { k: "ALL", label: "全部", days: 1e9 },
];
let curRange = "10Y";
let curMetric = "close";   // close | pe | pb

const METRIC_LABEL = { close: "点位", pe: "市盈率 PE", pb: "市净率 PB" };

async function renderDetail(secid) {
  const known = POPULAR.find((p) => p.secid === secid);
  view.innerHTML = `<div class="loading">加载中…</div>`;
  let quote, kdata;
  try {
    [quote, kdata] = await Promise.all([EM.quote(secid).catch(() => null), EM.kline(secid)]);
  } catch (e) {
    view.innerHTML = `<div class="error">数据加载失败，请检查指数代码或网络。<br><a class="back" href="#/">返回首页</a></div>`;
    return;
  }
  if (!kdata || !kdata.rows.length) {
    view.innerHTML = `<div class="error">未找到该指数的历史数据。<br><a class="back" href="#/">返回首页</a></div>`;
    return;
  }
  klineCache[secid] = kdata;
  const name = (quote && quote.name) || kdata.name || (known && known.name) || secid;
  const code = (quote && quote.code) || (known && known.code) || secid.split(".")[1];
  curMetric = "close";

  view.innerHTML = `
    <div class="detail-head">
      <div>
        <a class="back" href="#/">‹ 返回</a>
        <div class="nm">${name}</div>
        <div class="cd">${code} · ${secid}</div>
      </div>
      <div style="text-align:right">
        <div class="price ${cls(quote && quote.pct)}">${fmt(quote && quote.price)}</div>
        <div class="chg ${cls(quote && quote.pct)}">${quote ? fmtPct(quote.pct) + "  " + (quote.chg >= 0 ? "+" : "") + fmt(quote.chg) : ""}</div>
      </div>
    </div>

    <div class="toolbar">
      <div class="tabs" id="metricTabs">
        <div class="tab active" data-metric="close">点位分位</div>
      </div>
      <div class="range-tabs" id="rangeTabs">
        ${RANGES.map((r) => `<div class="tab ${r.k === curRange ? "active" : ""}" data-range="${r.k}">${r.label}</div>`).join("")}
      </div>
    </div>

    <div class="panel-grid">
      <div class="stats" id="stats"></div>
      <div class="chart-card">
        <div id="chart"></div>
        <div class="pct-badge" id="pctBadge"></div>
        <div class="note" id="snapNote"></div>
      </div>
    </div>
  `;

  // 范围切换
  document.getElementById("rangeTabs").addEventListener("click", (e) => {
    const t = e.target.closest("[data-range]");
    if (!t) return;
    curRange = t.dataset.range;
    document.querySelectorAll("#rangeTabs .tab").forEach((x) => x.classList.toggle("active", x.dataset.range === curRange));
    drawDetail(secid, quote);
  });

  drawDetail(secid, quote);
  window.addEventListener("resize", () => chart && chart.resize());

  // 异步加载估值数据，若有则补上 PE / PB 标签
  const val = await loadValuation(code);
  buildMetricTabs(secid, quote, val);
}

function hasSeries(arr) { return Array.isArray(arr) && arr.some((x) => x != null && isFinite(x)); }

function buildMetricTabs(secid, quote, val) {
  const box = document.getElementById("metricTabs");
  if (!box) return;
  const tabs = [{ m: "close", label: "点位分位" }];
  if (val && hasSeries(val.pe)) tabs.push({ m: "pe", label: "市盈率" });
  if (val && hasSeries(val.pb)) tabs.push({ m: "pb", label: "市净率" });
  box.innerHTML = tabs.map((t) => `<div class="tab ${t.m === curMetric ? "active" : ""}" data-metric="${t.m}">${t.label}</div>`).join("");
  box.onclick = (e) => {
    const t = e.target.closest("[data-metric]");
    if (!t) return;
    curMetric = t.dataset.metric;
    box.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x.dataset.metric === curMetric));
    drawDetail(secid, quote);
  };
}

function sliceByRange(dates, values) {
  const range = RANGES.find((r) => r.k === curRange);
  const cutoff = Date.now() - range.days * 86400000;
  const pairs = dates.map((d, i) => [d, values[i]]).filter((p) => p[1] != null && isFinite(p[1]));
  const inRange = pairs.filter((p) => new Date(p[0]).getTime() >= cutoff);
  const use = inRange.length > 5 ? inRange : pairs;
  return { dates: use.map((p) => p[0]), values: use.map((p) => p[1]) };
}

function drawDetail(secid, quote) {
  let series;
  if (curMetric === "close") {
    const kdata = klineCache[secid];
    series = sliceByRange(kdata.rows.map((r) => r.date), kdata.rows.map((r) => r.close));
  } else {
    const val = valDataCache[secid_to_code(secid, quote)];
    if (!val || !hasSeries(val[curMetric])) { curMetric = "close"; return drawDetail(secid, quote); }
    series = sliceByRange(val.dates, val[curMetric]);
  }
  const st = analyze(series.values);
  const label = METRIC_LABEL[curMetric];

  renderStats(st, quote, curMetric);
  renderPctBadge(st);
  renderSnapNote(quote, series.values.length, curMetric);
  renderChart(series.dates, series.values, st, label);
}

// 估值缓存以 code 为键，这里从 secid/quote 推出 code
function secid_to_code(secid, quote) {
  if (quote && quote.code) return quote.code;
  const known = POPULAR.find((p) => p.secid === secid);
  if (known) return known.code;
  return secid.split(".")[1];
}

function renderStats(st, quote, metric) {
  if (!st) return;
  const box = document.getElementById("stats");
  const curLabel = metric === "close" ? "当前点位" : metric === "pe" ? "当前 PE" : "当前 PB";
  // 仅在“点位分位”视图下，额外展示当前 PE/PB 快照
  const peLine = metric === "close" && quote && quote.pe != null ? `<div class="row"><span class="k">市盈率 PE(TTM)</span><span class="v">${fmt(quote.pe)}</span></div>` : "";
  const pbLine = metric === "close" && quote && quote.pb != null ? `<div class="row"><span class="k">市净率 PB</span><span class="v">${fmt(quote.pb)}</span></div>` : "";
  box.innerHTML = `
    <div class="row hl"><span class="k">${curLabel}</span><span class="v">${fmt(st.current)}</span></div>
    <div class="row hl"><span class="k">历史分位</span><span class="v">${st.percentile.toFixed(2)}%</span></div>
    <div class="row"><span class="k"><span class="dot danger"></span>危险值 (70%)</span><span class="v">${fmt(st.danger)}</span></div>
    <div class="row"><span class="k"><span class="dot median"></span>中位值 (50%)</span><span class="v">${fmt(st.median)}</span></div>
    <div class="row"><span class="k"><span class="dot chance"></span>机会值 (30%)</span><span class="v">${fmt(st.chance)}</span></div>
    <div class="row"><span class="k">最大值</span><span class="v">${fmt(st.max)}</span></div>
    <div class="row"><span class="k">平均值</span><span class="v">${fmt(st.mean)}</span></div>
    <div class="row"><span class="k">最小值</span><span class="v">${fmt(st.min)}</span></div>
    <div class="row"><span class="k">标准差</span><span class="v">${fmt(st.std)}</span></div>
    <div class="row"><span class="k">z 分数</span><span class="v">${fmt(st.z)}</span></div>
    ${peLine}${pbLine}
  `;
}

function renderPctBadge(st) {
  if (!st) return;
  const p = Math.max(0, Math.min(100, st.percentile));
  let label = "适中", color = "var(--median)";
  if (p >= 70) { label = "偏高估"; color = "var(--danger)"; }
  else if (p <= 30) { label = "偏低估"; color = "var(--chance)"; }
  document.getElementById("pctBadge").innerHTML =
    `<span>当前分位 <b style="color:${color}">${p.toFixed(1)}% · ${label}</b></span>
     <span class="bar"><i style="left:${p}%"></i></span>`;
}

function renderSnapNote(quote, n, metric) {
  const parts = [`样本 ${n} 个交易日`];
  const what = metric === "close" ? "指数点位" : metric === "pe" ? "市盈率 PE" : "市净率 PB";
  if (metric === "close" && quote && quote.pe != null) parts.push(`PE ${fmt(quote.pe)}`);
  if (metric === "close" && quote && quote.pb != null) parts.push(`PB ${fmt(quote.pb)}`);
  parts.push(`分位分析基于所选区间的${what}序列`);
  document.getElementById("snapNote").textContent = parts.join(" · ");
}

function renderChart(dates, values, st, label) {
  const el = document.getElementById("chart");
  if (chart) chart.dispose();
  chart = echarts.init(el);
  const line = (val, color, name) => ({
    name, yAxis: val, lineStyle: { color, type: "dashed", width: 1.5 },
    label: { formatter: name + " " + fmt(val), color, position: "insideEndTop", fontSize: 11 },
  });
  chart.setOption({
    grid: { left: 58, right: 18, top: 24, bottom: 60 },
    tooltip: {
      trigger: "axis",
      formatter: (ps) => `${ps[0].axisValue}<br/>${label} <b>${fmt(ps[0].data)}</b>`,
    },
    xAxis: {
      type: "category", data: dates, boundaryGap: false,
      axisLine: { lineStyle: { color: "#d4ddec" } },
      axisLabel: { color: "#909aa8", fontSize: 11 },
    },
    yAxis: {
      type: "value", scale: true,
      splitLine: { lineStyle: { color: "#eef2f7" } },
      axisLabel: { color: "#909aa8", fontSize: 11 },
    },
    dataZoom: [
      { type: "inside", start: 0, end: 100 },
      { type: "slider", height: 18, bottom: 22, borderColor: "#e8ecf2", fillerColor: "rgba(43,125,233,.12)" },
    ],
    series: [{
      name: label, type: "line", data: values, showSymbol: false, smooth: false,
      lineStyle: { color: "#2b7de9", width: 1.6 },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: "rgba(43,125,233,.18)" }, { offset: 1, color: "rgba(43,125,233,0)" }]) },
      markLine: st ? {
        symbol: "none", silent: true,
        data: [line(st.danger, "#e0524a", "危险"), line(st.median, "#f0a93b", "中位"), line(st.chance, "#2bab6b", "机会")],
      } : undefined,
    }],
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
  const local = localSearch(kw);
  renderSuggest(local);
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const remote = await EM.suggest(kw);
    const seen = new Set(local.map((x) => x.secid));
    const merged = [...local];
    remote.forEach((r) => { if (r.secid && !seen.has(r.secid)) { seen.add(r.secid); merged.push(r); } });
    if (searchInput.value.trim() === kw) renderSuggest(merged.slice(0, 15));
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
