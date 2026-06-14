# 指数估值 · 行情分析

纯前端静态站（GitHub Pages），查 A股/港股/美股指数的实时点位、涨跌，以及基于历史
序列的分位分析（点位 / PE / PB）。**无后端、无数据库。**

- 仓库：https://github.com/zedmon3tr/index-valuation
- 线上：https://zedmon3tr.github.io/index-valuation/

## 目标

- 保持"纯静态、零后端"——所有动态数据要么浏览器端直接调公开接口，要么由 CI 预生成静态 JSON。
- 估值数据"够做长周期（10年）分位分析"为准，数值必须与权威源一致。

## 架构

```
indexes.json   ←── 唯一的指数主数据表（增删指数 / 上下首页都改这里）
   ├──▶ app.js              启动时 fetch → 渲染首页卡片 + 本地搜索
   └──▶ scripts/build_data.py   读它 → 决定抓哪些指数的 PE/PB，生成 data/<code>.json
```

- **`indexes.json`**：主表，每条 `{ secid, code, name, home }`。
  - `home: true` 才上首页；`false` 仍在表里、可被搜索、也会预生成数据。
  - `secid` 是东方财富的行情 id（如 `1.000300`、港股 `124.HSTECH`），`code` 是 JSON 文件名。
- **搜索**：先查本地主表（全表），命中即用、不打外部；表里没有才回退东方财富全网搜索。
- **前端数据**：
  - 实时行情 / 历史点位 → 浏览器直接调**东方财富** JSONP 接口（`app.js` 里的 `EM`）。
  - 历史 PE/PB → `data/<code>.json`，由 CI 预生成。前端按 `hasSeries` 逐指标判断：
    有 PE 才显示「市盈率」标签，有 PB 才显示「市净率」，都没有就只剩「点位分位」（优雅降级）。

## 数据源（scripts/build_data.py）

PE 优先乐咕、缺失则中证兜底；PB 仅乐咕。

1. **乐咕乐股 legulegu** —— PE + PB。直接调其底层接口（`index-basic-pe` / `-pb`），
   把 `indexCode` 参数化（akshare 的 `stock_index_pe_lg` 只写死 12 个宽基）。交易所
   后缀 `.SH/.SZ/.CSI` 由脚本自动探测。token/cookie 复用 akshare 内部实现。
   - ⚠️ **字段坑（重要）**：必须取 **`addTtmPe`** 和 **`addPb`**——这俩才是"市值加权"
     的正常值。裸 `ttmPe`/`pb` 是"等权"值（偏大，沪深300 会显示成 PE 32.9 而非 13.68）。
2. **中证官方 index-perf** —— 仅 PE（`peg` 字段），覆盖所有中证系指数（中证全指、
   上证指数、任意 H 代码主题指数）。乐咕没 PE 的指数用它兜底。这类指数只有 PE 无 PB。

### 覆盖与缺口

- **PE+PB 都有**：沪深300、上证50/180/380、中证500/800/1000/100、科创50、深证100、
  中证红利/上证红利/深证红利、白酒/医疗/军工/消费、创业板50（乐咕）。
- **仅 PE**：中证全指、上证指数（中证兜底）。
- **无 PE/PB，仅点位分位**：创业板指、深证成指（深证/国证系，两源都没有）、
  港股（恒生/恒生科技）、美股（纳指/标普）——乐咕只有 A 股、中证只有中证系。

> 注：港美股没有 PE/PB 是数据源天花板，不是 bug。

## 命令

```bash
# 本地手动跑数据（需要 akshare：pip install akshare）
python scripts/build_data.py
```

- 校验数值时，用 `akshare.stock_index_pe_lg('沪深300')` 的「滚动市盈率」列做对照（应=13.68）。

## 自动更新（CI）

`.github/workflows/update-data.yml`（GitHub Actions）：

- **定时**：`cron: "0 10 * * *"` = UTC 10:00 = **北京时间 18:00**（A股收盘后），每天自动跑
  `build_data.py` 并把更新后的 `data/` 提交回仓库。
- **手动**：Actions 页面点 "Run workflow"（`workflow_dispatch`）。
- 注意：GitHub 定时任务整点高峰可能延迟几分钟到几十分钟；仓库连续 60 天无活动会自动
  暂停定时（发邮件提醒，去 Actions 页重新启用即可）。

## 约定

- 改首页指数 / 增删指数 → **只动 `indexes.json`**，前端展示和数据抓取自动跟着变。
- 新增指数后，`build_data.py` 会自动尝试抓 PE/PB（乐咕→中证），抓不到就只有点位分位；
  脚本还会清理 `data/` 里已不在表中的过期文件，保持与主表同步。
- 不要把参考图 / 设计稿（如 `0.png`）、`.DS_Store` 提交进仓库（已在 `.gitignore`）。
