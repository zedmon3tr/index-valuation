# 指数估值 · 行情分析

一个纯静态的 A 股 / 港股 / 美股**指数行情与历史分位分析**网页。支持搜索指数，查看实时点位、涨跌，以及基于历史序列的点位 / PE / PB / 股息率分位分析（危险值 / 中位值 / 机会值带）。

**无需后端、无需数据库**，部署到 GitHub Pages 即可使用。

## 功能

- 🔍 **搜索**：本地内置主流指数即时匹配 + 东方财富全网搜索（任意指数代码 / 名称）
- 📈 **实时行情**：首页卡片展示主流指数最新点位与涨跌幅
- 📊 **分位分析**：详情页按 1 / 3 / 5 / 10 年 / 全部区间计算
  - 当前点位、历史分位
  - 危险值(70%)、中位值(50%)、机会值(30%)
  - 最大 / 平均 / 最小值、标准差、z 分数
  - 当前 PE / PB（实时快照）与可用的历史股息率
- 🧭 **分析控制**：1 / 3 / 5 / 10 年 / 上市以来 / 自定义区间，日 / 周 / 月周期、移动平均、分位线、标准差线
- 🪜 **定投点位**：详情页图表下方可输入初次买入点位、定投次数、每次跌幅，实时生成分批买入点位表
- 🔎 **指数 + 基金搜索**：搜索同时覆盖指数与基金（ETF），ETF 通过 `funds.json` 的 `trackIndex` 借用其跟踪指数的估值分位 / 机会线
- 📋 **明细数据**：图表与数据表切换，并明确展示有效样本数和实际覆盖区间
- 📉 ECharts 交互图表，带分位参考线与区间缩放

## 架构与指数配置

`indexes.json` 是项目唯一的指数主数据表：

```text
indexes.json
   ├──▶ app.js                 渲染首页卡片与本地搜索
   └──▶ scripts/build_data.py  生成各指数的历史 PE/PB/股息率 JSON
```

每条记录包含 `{ secid, code, name, home }`：

- `secid`：东方财富行情 ID，例如 `1.000300`、`124.HSTECH`
- `code`：对应的 `data/<code>.json` 文件名
- `name`：页面显示名称
- `home`：`true` 时显示在首页；`false` 时仍可搜索并生成估值数据

修改首页指数或增删指数时，只需编辑 `indexes.json`。脚本会自动尝试获取 PE/PB/股息率，并清理 `data/` 中已不在主表里的旧文件。

搜索会先匹配本地主表；未命中时再调用东方财富全网搜索。

## 数据来源

### 实时行情与历史点位

浏览器端直接调用**东方财富**公开行情接口（通过 JSONP `cb` 回调跨域）：

- `push2.eastmoney.com` — 实时行情、快照（含当前 PE/PB）
- `push2his.eastmoney.com` — 历史日 K 线
- `searchapi.eastmoney.com` — 指数搜索

### 历史 PE/PB/股息率

历史估值序列由 `scripts/build_data.py` 预生成为 `data/<code>.json`。各指标按自己的日期独立合并，缺失值保留为 `null`，前端只显示实际有数据的指标：

1. **乐咕乐股（legulegu）**：优先获取 PE 和 PB。脚本调用 `index-basic-pe` / `index-basic-pb` 底层接口，并自动探测 `.SH`、`.SZ`、`.CSI` 后缀。
2. **中证官方 index-perf**：乐咕缺少 PE 时作为兜底，适用于中证系指数；该接口不提供 PB。
3. **中证官方 indicator**：获取 A 股指数近期股息率，使用 `D/P2`（计算用股本口径）。官方表目前仅提供约 20 个最近交易日，页面会明确展示实际覆盖区间与样本数。
4. **乐咕恒生指数序列**：为恒生指数提供月度历史 PE 和股息率（`dvRatio`）。

乐咕数据必须使用市值加权字段 `addTtmPe` 和 `addPb`，不能使用等权字段 `ttmPe` / `pb`。

前端会按实际数据逐项显示「市盈率」「市净率」和「股息率」标签：

- **PE + PB + 近期股息率**：中证官方可识别的 A 股指数；股息率通常覆盖最近约 20 个交易日
- **PE + 历史股息率**：恒生指数（月度序列）
- **PE + PB**：沪深300、上证50/180/380、中证500/800/1000/100、科创50、深证100，以及部分红利和行业主题指数
- **仅 PE**：中证全指、上证指数等由中证官方接口兜底的指数
- **仅点位分位**：创业板指、深证成指、恒生科技、纳斯达克、标普500等当前数据源不提供历史估值序列的指数

没有某个估值标签通常代表数据源没有该历史序列，不是页面故障。页面统计始终只基于当前筛选区间内的有效样本。

## 估值数据自动更新（GitHub Actions）

本仓库含一个定时任务，每天自动抓取 `indexes.json` 中指数的历史 PE/PB/股息率，并提交更新后的 `data/`：

- 脚本：`scripts/build_data.py`（乐咕优先，中证官方接口兜底）
- 工作流：`.github/workflows/update-data.yml`
- 定时：每天 UTC 10:00，即北京时间 18:00（A 股收盘后）
- 手动：GitHub Actions 页面选择 **Update valuation data**，点击 **Run workflow**

**首次启用步骤：**

1. 确保 `scripts/build_data.py` 与 `.github/workflows/update-data.yml` 已在仓库中。
2. 仓库 **Settings → Actions → General → Workflow permissions**，选 **Read and write permissions**，保存（让 Action 能把数据提交回仓库）。
3. 打开仓库 **Actions** 标签页，选左侧 **Update valuation data**，点 **Run workflow** 手动跑一次。
4. 运行成功后，`data/` 目录会出现各指数的 JSON；网页会按实际数据自动出现 PE、PB、股息率切换标签。

之后会自动每日更新。GitHub 定时任务可能在整点高峰延迟；仓库连续 60 天无活动时，GitHub 也可能暂停定时任务，需要在 Actions 页面重新启用。

本地手动更新数据：

```bash
pip install akshare
python scripts/build_data.py
```

## 本地预览

```bash
# 任选其一，在本目录下起一个静态服务器
python3 -m http.server 8000
# 然后浏览器打开 http://localhost:8000
```

直接双击 `index.html` 也能打开（JSONP 不受 file:// 限制）。

## 部署到 GitHub Pages

1. 新建 GitHub 仓库，把本目录所有文件（`index.html`、`app.js`、`styles.css`、`.nojekyll`、`README.md`）推上去：

   ```bash
   git init
   git add .
   git commit -m "init: 指数估值行情分析静态站"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/<仓库名>.git
   git push -u origin main
   ```

2. 仓库 **Settings → Pages → Build and deployment**，Source 选 **Deploy from a branch**，分支选 `main` / 根目录 `/ (root)`，保存。

3. 等待 1–2 分钟，访问 `https://<你的用户名>.github.io/<仓库名>/` 即可。

`.nojekyll` 文件确保 GitHub Pages 原样发布静态文件、不走 Jekyll 处理。

## 文件结构

```
index.html                       页面骨架与 ECharts 引入
styles.css                       页面样式与响应式布局
app.js                           行情接口、搜索、统计、路由与渲染
indexes.json                     唯一的指数主数据表
scripts/build_data.py            历史 PE/PB/股息率数据生成脚本
data/<code>.json                 CI 生成的历史估值序列
.github/workflows/update-data.yml  每日数据更新任务
```

## 维护约定

- 增删指数或调整首页展示：只修改 `indexes.json`
- 新指数抓不到估值序列时，页面自动降级为仅显示点位分位
- 校验沪深300 PE 时，可与 `akshare.stock_index_pe_lg('沪深300')` 的「滚动市盈率」列对照
- 不要提交参考图、设计稿、`.DS_Store` 等无关文件

## 免责声明

数据来源于东方财富、乐咕乐股和中证指数公开接口，仅供研究参考，不构成任何投资建议。接口由第三方维护，可能随时变动或限流。
