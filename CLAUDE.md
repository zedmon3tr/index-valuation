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

PE/PB/股息率 **主源 funddb(韭圈儿)**，缺字段才逐级回退；历史点位另走官方多源。逐字段"缺啥补啥"。

0. **历史点位 `close`** —— A股按「新浪 `stock_zh_index_daily` → 腾讯 `stock_zh_index_daily_tx`
   → 东财 `stock_zh_index_daily_em`」三源依次兜底（独立域名，任一可用即可）；港股用
   `stock_hk_index_daily_sina/_em`，美股/全球 `index_global_hist_em` 尽力而为。secid 前缀
   `1.`→`sh`、`0.`→`sz` 映射符号。起始 2005（`POINT_START`）。
   - ⚠️ **新鲜度校验**：源"足量但过期"（如新浪对 000922/000985 截断到 2019/2016）会被识破、
     回退下一个源（`POINT_FRESH_DAYS`），避免点位停在某年成直线。

1. **funddb 韭圈儿（主源，`scripts/jiucaishuo_client.py`）** —— PE/PB/股息率 **10 年日频**，
   覆盖中港美 286 指数、**无需 token**、股息率口径与韭圈儿网页一致（区别于 lixinger 市值加权偏低值）。
   端点 `newtubiaolinedata`（取 `data.tubiao.series` 里"市盈率/市净率/股息率"），列表 `showcategory`
   解析 `gu_code`（我方 code→`000300.SH`/`HSI.HI`/`NDX.GI`）。
   - ⚠️ **非官方签名接口**：请求要补前端混淆签名（MD5+切片，key `EWf45rlv#kfsr@k#gfksgkr`、
     `version` 见客户端）。前端**绝不直连**，只由 CI 调；前端版本/签名变了需重新逆向。
     失效时自动回退下方老源、**绝不用空数据覆盖**既有文件。
2. **乐咕乐股 legulegu（兜底）** —— PE+PB。`index-basic-pe`/`-pb`，必须取 **`addTtmPe`/`addPb`**
   （市值加权；裸 `ttmPe`/`pb` 是等权偏大值）。cookie/csrf **懒加载**（只在真用到兜底时才取）。
3. **中证官方 index-perf（兜底）** —— 仅 PE（`peg`），覆盖所有中证系指数。
4. **中证官方 indicator / 乐咕 HSI（兜底）** —— 中证近 ~20 天股息率(`D/P2`)；恒生月度 PE/`dvRatio`。
5. **理杏仁 lixinger 种子 `data/seed/<code>.json`（最终兜底）** —— 一次性回填的 10 年 PE/PB/股息率，
   由 `scripts/backfill_lixinger.py` 用 token 生成并提交进仓库；`build_data.py` 只读静态种子、不需 token。
   现已退居 funddb 之后的兜底（funddb 全覆盖时基本不触发）。

> 📓 **数据源调研全过程与结论**见 [`docs/data-source-research.md`](docs/data-source-research.md)：
> 含 funddb 签名逆向（端点 `newtubiaolinedata`，早期误判 405 是打错了端点）、富途指数无 PE/PB、
> lixinger 试用 token 限制等。

### 覆盖与缺口

- **PE / PB / 股息率（10 年日频）**：**全部 26 个指数**（A股 + 恒生/恒生科技 + 纳指100/标普500）
  均由 funddb 提供，含原先缺口的 **NDX 纳斯达克100**（funddb 覆盖、lixinger 当年没有）。
- **点位 close**：A股/港股有官方序列；**纳指100/标普500 无静态 close**（funddb 不取点位、
  官方全球源不稳），前端回退浏览器实时 K 线。
- ⚠️ **历史长度（拼接）**：funddb 约 10 年（2016 起）。**A股 PE/PB 用 legulegu(2005起) / 中证 peg
  (上证指数·中证全指, 2011起) 向前拼接、近 10 年仍以 funddb 为准**（`_stitch`），多数 A股 PE/PB
  回到 ~2005（~20 年）；创业板指/深证成指等本无旧估值的保持 funddb ~10 年。股息率/港美/NDX 纯
  funddb（~10 年）不拼接。拼接接缝(2016)处 legulegu/funddb 略差，单点台阶可忽略。

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
