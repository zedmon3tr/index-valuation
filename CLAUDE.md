# 指数估值 · 行情分析

纯前端静态站（GitHub Pages），查 A股/港股/美股指数的实时点位、涨跌，以及基于历史
序列的分位分析（点位 / PE / PB / 股息率）。**无后端、无数据库。**

- 仓库：https://github.com/zedmon3tr/index-valuation
- 线上：https://zedmon3tr.github.io/index-valuation/

## 目标

- 保持"纯静态、零后端"——所有动态数据要么浏览器端直接调公开接口，要么由 CI 预生成静态 JSON。
- 估值数据"够做长周期（10年）分位分析"为准，数值必须与权威源一致。

## 架构

```
indexes.json   ←── 唯一的指数主数据表（增删指数 / 上下首页都改这里）
   ├──▶ app.js              启动时 fetch → 渲染首页卡片 + 本地搜索
   └──▶ scripts/build_data.py   读它 → 决定抓哪些指数的 PE/PB/股息率，生成 data/<code>.json
```

- **`indexes.json`**：主表，每条 `{ secid, code, name, home }`。
  - `home: true` 才上首页；`false` 仍在表里、可被搜索、也会预生成数据。
  - `secid` 是东方财富的行情 id（如 `1.000300`、港股 `124.HSTECH`），`code` 是 JSON 文件名。
- **搜索**：先查本地主表（全表），命中即用、不打外部；表里没有才回退东方财富全网搜索。
- **前端数据**：
  - 历史点位（`close`）/ PE / PB / 股息率 → `data/<code>.json`，由 CI 预生成。前端按
    `hasSeries` 逐指标判断：有数据才点亮对应标签，无数据则置灰（不隐藏）；都缺失才报错。
    估值 JSON 使用版本参数和 `no-store`，避免每日更新后浏览器继续读取旧缓存。
  - 实时快照（当日点位/涨跌）→ 浏览器直接调**东方财富** JSONP 接口（`app.js` 里的 `EM`）。
    这一路**仅为锦上添花**：东财不可用时，历史点位回退到静态 `close`，详情页照常可用
    （仅顶部实时价显示「行情快照暂不可用」）。`app.js` 的 `pointSeries()` 实现该回退。

## 数据源（scripts/build_data.py）

历史点位多源兜底；PE 优先乐咕、缺失则中证兜底；PB 仅乐咕；股息率按指数来源分别抓取。

0. **历史点位 `close`** —— A股按「新浪 `stock_zh_index_daily` → 腾讯 `stock_zh_index_daily_tx`
   → 东财 `stock_zh_index_daily_em`」三源依次兜底（独立域名，任一可用即可）；港股用
   `stock_hk_index_daily_sina/_em`，美股/全球 `index_global_hist_em` 尽力而为。secid 前缀
   `1.`→`sh`、`0.`→`sz` 映射符号。起始 2005（`POINT_START`），与估值同期、控制 JSON 体积。

1. **乐咕乐股 legulegu** —— PE + PB。直接调其底层接口（`index-basic-pe` / `-pb`），
   把 `indexCode` 参数化（akshare 的 `stock_index_pe_lg` 只写死 12 个宽基）。交易所
   后缀 `.SH/.SZ/.CSI` 由脚本自动探测。token 为当天日期的 MD5，cookie/csrf 复用 akshare 实现。
   - ⚠️ **字段坑（重要）**：必须取 **`addTtmPe`** 和 **`addPb`**——这俩才是"市值加权"
     的正常值。裸 `ttmPe`/`pb` 是"等权"值（偏大，沪深300 会显示成 PE 32.9 而非 13.68）。
2. **中证官方 index-perf** —— 仅 PE（`peg` 字段），覆盖所有中证系指数（中证全指、
   上证指数、任意 H 代码主题指数）。乐咕没 PE 的指数用它兜底。这类指数只有 PE 无 PB。
3. **中证官方 indicator** —— A 股指数近期股息率，取 `D/P2`（计算用股本口径）。官方表仅有
   约 20 个最近交易日，前端必须展示实际覆盖区间与样本数，不能暗示为长期历史。
4. **乐咕 HSI 序列** —— 恒生指数月度 PE 与股息率，股息率字段为 `dvRatio`。
   （注：HSI 现已被 lixinger 种子覆盖，有种子时此乐咕请求自动跳过。）
5. **理杏仁 lixinger 种子 `data/seed/<code>.json`** —— 一次性回填的 10 年 PE/PB/股息率，
   由 `scripts/backfill_lixinger.py` 用私有 token 生成并**提交进仓库**。`build_data.py` 每天
   只是【读静态种子文件】合并，**不需要 token**，所以日常 CI 照常跑。种子按市场只含相应
   字段：**A股仅 dy**（把中证 20 天股息率升级为 10 年）；**港美含 pe/pb/dy**（填上恒生科技
   /标普500 原本"仅点位无估值"的缺口）。种子里有的字段覆盖免费源对应字段（见 `fetch_one`
   末尾）。股息率单位坑：lixinger `dyr.mcw` 是小数(0.0274)，脚本 ×100 对齐项目的百分数约定。
   - ⚠️ 覆盖限制：lixinger 美指**只有标普500(`.INX`)，没有纳指100(NDX)**；NDX 无种子、维持
     仅点位。token 是付费/试用资源（约 5 天试用），故只做一次性回填，绝不进日常 CI。

> 📓 **数据源调研全过程与结论**见 [`docs/data-source-research.md`](docs/data-source-research.md)：
> funddb 历史端点已被锁(405)且 akshare 删了封装、只能取快照；**富途 OpenAPI 对指数无 PE/PB**；
> 指数级 ROE 几乎无免费源（lixinger 也只在更复杂的指数财报接口里有）。

### 覆盖与缺口

- **PE+PB 都有**：沪深300、上证50/180/380、中证500/800/1000/100、科创50、深证100、
  中证红利/上证红利/深证红利、白酒/医疗/军工/消费、创业板50（乐咕）；**恒生指数、恒生科技、
  标普500**（lixinger 种子，10 年）。
- **仅 PE**：中证全指、上证指数（中证兜底）。
- **股息率（10 年）**：所有有 lixinger 种子的指数（A 股全部 + 恒生/恒生科技/标普500）。
  ↳ 旧的"中证官方近约 20 个交易日"现仅作无种子时的兜底。
- **无历史估值，仅点位分位**：创业板指、深证成指（深证/国证系）、**纳斯达克100**
  （lixinger 美指不含 NDX）。

> 注：标签是否出现由实际有效序列决定；缺失标签是数据源覆盖限制，不是 bug。

## 命令

```bash
# 本地手动跑数据（需要 akshare：pip install akshare）；会读 data/seed/ 合并 lixinger 长历史
python scripts/build_data.py

# 一次性回填 lixinger 10 年估值种子（需 token，仅在试用/付费有效期内跑）
echo '{"token":"你的token"}' > scripts/.lixinger_token.json   # 已 .gitignore，绝不提交
python scripts/backfill_lixinger.py probe   # 探针：dump 港美指数代码 + 样本响应结构
python scripts/backfill_lixinger.py run      # 正式回填 → data/seed/<code>.json（提交进仓库）
```

- 校验数值时，用 `akshare.stock_index_pe_lg('沪深300')` 的「滚动市盈率」列做对照（应=13.68）。
- token 只放 `scripts/.lixinger_token.json`（已忽略），绝不写进对话/脚本/CI。种子失效需更新时，
  在有效 token 期内重跑 `backfill_lixinger.py run` 即可，日常 `build_data.py` 不依赖 token。

## 自动更新（CI）

`.github/workflows/update-data.yml`（GitHub Actions）：

- **定时**：`cron: "0 10 * * *"` = UTC 10:00 = **北京时间 18:00**（A股收盘后），每天自动跑
  `build_data.py` 并把更新后的 `data/` 提交回仓库。
- **手动**：Actions 页面点 "Run workflow"（`workflow_dispatch`）。
- 注意：GitHub 定时任务整点高峰可能延迟几分钟到几十分钟；仓库连续 60 天无活动会自动
  暂停定时（发邮件提醒，去 Actions 页重新启用即可）。

## 约定

- 改首页指数 / 增删指数 → **只动 `indexes.json`**，前端展示和数据抓取自动跟着变。
- 新增指数后，`build_data.py` 会自动尝试抓 PE/PB/股息率，抓不到就只有点位分位；
  脚本还会清理 `data/` 里已不在表中的过期文件，保持与主表同步。
- 不要把参考图 / 设计稿（如 `0.png`）、`.DS_Store` 提交进仓库（已在 `.gitignore`）。
