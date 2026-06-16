# Index Data Source Research (CN / HK / US)

Date: 2026-06-16. Scope: **index-level** valuation/quote data (continuing this
project), surveying public + trustworthy + ready-to-use sources. Goal indicators:
PE, PB, dividend yield, valuation percentile, plus nice-to-have turnover / amplitude
/ market cap / ROE. Test method = raw `curl` of public endpoints, because for a
pure-static / CI-prerendered site what matters is "can the browser or GitHub Actions
hit it directly without a backend." akshare is NOT a source, it's a wrapper library
(listed separately).

## ⚠️ 2026-06-16 deep-dive correction (READ FIRST)

A second, deeper round of testing **walked back the funddb recommendation below.**
Findings:

- **akshare dropped the funddb wrappers.** In akshare 1.18.64 (current),
  `index_value_hist_funddb` / `index_value_name_funddb` **no longer exist**
  (`AttributeError`). Only `stock_zh_index_value_csindex` remains for index valuation.
- **funddb's history endpoints are locked.** Every series endpoint tried
  (`newtubiao`, `tubiao`, `zhishutubiao`, `showtubiaolist`, …) returns **HTTP 405**.
  The daily 10y series is not publicly fetchable (looks gated to the signed app).
- **funddb's _snapshot_ endpoint still works.** `POST /v2/guzhi/showcategory` (body
  `{}`) returns, for **286 indices incl. HK/US**, the **current** PE/PB/dividend
  yield **+ server-computed historical percentile** (`gu_pe_current_perent`,
  `gu_pb_current_perent`) and `gu_date`. Example HSTECH.HI: PE 22.64, PB 2.41,
  yield 0.92, PE %ile 29.56. But it's a *snapshot*, not a series.
- **`stock_zh_index_value_csindex` (akshare, official) only returns ~20 recent days**
  (cols 市盈率1/2, 股息率1/2). Same limitation as the existing csindex source — no
  good for 10y percentiles.
- **legulegu (current primary) is fine** and gives long PE/PB history; keep it.

**Net effect on strategy:** funddb can NOT be the long-history primary (history is
405-locked, akshare no longer wraps it). Its realistic role is (a) a **snapshot +
precomputed-percentile** source to light up the HK/US gap (HSTECH/NDX/SPX currently
have zero valuation), and (b) a cross-check/fallback for A-share current values. True
**10y HK/US history + ROE** realistically needs **lixinger (token)** — see below.

**Decision (2026-06-16):** performance optimization shipped first (done). Data-source
wiring waits on lixinger viability — see findings below.

### lixinger index fundamental — verified spec (2026-06-16)

Endpoints confirmed live (all returned auth-error, i.e. they exist and are gated by
token): `POST https://open.lixinger.com/api/{cn,hk,us}/index/fundamental`. Official
param spec (from the published API doc):

- **Auth:** POST JSON, `token` in body. `Accept-Encoding: gzip` required.
- **Query:** `stockCodes` (array, 1–100; **but a date-range query allows only ONE
  code**), `date` OR `startDate`+`endDate` (≥1 required), `endDate` defaults to last
  Monday, optional `limit`. **`startDate`→`endDate` span ≤ 10 years** — exactly our
  10y percentile window.
- **`metricsList` format:** `[name].[granularity].[type].[stat]`
  - name: **`pe_ttm`, `pb`, `ps_ttm`, `dyr`** (+ `mc` market cap, plain).
  - granularity: `y3 / y5 / y10` (look-back window for the stat).
  - type: `mcw` (market-cap weighted — the correct one), `ew` (equal weight).
  - stat: `cv` current, **`cvpos` percentile%**, `minv`/`maxv`/`maxpv`, `q5v` median,
    `q8v` 80%, `q2v` 20%, `avgv` mean. → i.e. lixinger returns server-side **every**
    stat our detail page computes (current / percentile / median / 20·80 bands / mean
    / min / max). For our use we'd just pull the raw daily series
    (`pe_ttm.mcw`, `pb.mcw`, `dyr`, `mc`) over startDate→endDate and let the client
    recompute, OR consume the precomputed `cvpos`/`q*v` directly.
- **Coverage:** CN + HK + US index fundamental all exist (`hk_index_fundamental`,
  `us/index/fundamental`), so this genuinely fills the HSTECH / NDX / SPX 10y gap.

**Two important honest caveats:**
1. **No index-level ROE here.** The index *fundamental* metrics are only
   pe_ttm/pb/ps_ttm/dyr/mc. Index ROE would need the index *financial-statement*
   endpoints (`cn/index/fs_*`, more complex, likely higher tier) — so "index ROE" is
   NOT a cheap win even with lixinger. Drop ROE from the index-level wishlist.
2. **Token durability is the real blocker.** The trial token the user got is reported
   to work for **only ~5 days**. The API param spec does not encode tiers — the limit
   is account-side (lixinger standard access is paid, ~388 RMB/yr; trial is short).
   **A 5-day token cannot power an indefinite daily CI pipeline.** It CAN, however,
   power a **one-time 10y backfill** baked into static `data/*.json`.

**Recommended hybrid (extracts max value from a trial token, no recurring cost):**
- **One-time, within the 5-day window:** use lixinger to backfill 10y PE/PB/dyr (+
  percentiles) for the HK/US gap indices (HSTECH/NDX/SPX) into static JSON — instantly
  turns "point-only" into real 10y valuation percentile.
- **Ongoing daily:** A-share stays on legulegu (free, durable). HK/US daily *current*
  value appended via funddb `showcategory` snapshot (token-free, verified) or the
  browser realtime quote; the valuable 10y baseline stays static. Only re-run the
  lixinger backfill if/when a valid token exists (e.g. user pays for the 388/yr tier).
- The token is supplied by the user via a gitignored `token.json` / env var and the
  backfill is run by the user locally — the token never enters the repo or CI.

## TL;DR recommendations (original first-pass — see correction above)

1. ~~**funddb / 韭圈儿 (`api.jiucaishuo.com`)** — best new addition.~~ **Walked back,
   see correction above.** One token-less POST (`showcategory`) still returns a
   per-index **snapshot** (PE / PB / PE-%ile / PB-%ile / dividend yield) spanning
   **CN + HK + US** — useful for the HK/US snapshot gap — but the **historical
   series is 405-locked** and akshare no longer wraps it, so it can't be the
   long-history primary.
2. **lixinger / 理杏仁 (`open.lixinger.com`)** — most complete: pe_ttm, pb, ps_ttm,
   dividend yield (dyr), **ROE**, market cap (mc), + percentiles, for CN/HK/US
   indices. Cost: needs a **free token** (register, put in CI secret).
3. **Tencent (`qt.gtimg.cn`)** — realtime point/turnover/amplitude/52w for CN+HK+US
   in one JSONP call, more fields than Sina. Good parallel fallback to the EastMoney
   snapshot the front-end already uses.

Honest caveat: **ROE / market cap / turnover at the _index_ level barely exist** in
most sources. Turnover/mcap can be approximated from trade data; index-weighted ROE
is essentially lixinger-only. Not a bug, a data-world limit.

## Tested sources

### Static / CI friendly (recommended)

| Source | Markets | Fields obtained | Access | Test result |
|---|---|---|---|---|
| **funddb / 韭圈儿** `api.jiucaishuo.com` | CN/HK/US | PE, PB, **PE %ile, PB %ile**, dividend yield (`gu_xilv`), chg | POST, **no token** | ✅ `POST /v2/guzhi/showcategory` → e.g. `光伏产业 931151.CSI`, PE/PB, `gu_pb_current_perent:43.09`, yield 0.69. Per-index history endpoint name varies (`newtubiao`/`showtubiaolist` returned empty for my guessed payload — use akshare's exact params). |
| **Tencent** `qt.gtimg.cn` | CN/HK/US | point, chg, **turnover, amplitude, 52w hi/lo, vol/amount**; A-share index carries PE | JSONP, browser-direct, no key | ✅ `sh000300` (PE≈14.72, turnover 0.53), `hkHSI`, `usDJI/usINX/usIXIC` all returned |
| **Sina** `hq.sinajs.cn` | CN/HK | point + vol/amount only | JSONP, needs Referer | ✅ (already used as point fallback) |
| **TongHuaShun** `d.10jqka.com.cn/v6/realhead/...` | CN | point, vol, amount, total mcap | JSONP, fields are numeric codes (need mapping) | ✅ `zs_1A0001` returned |

### Usable but gated

| Source | Fields | Gate | Test result |
|---|---|---|---|
| **lixinger / 理杏仁** `open.lixinger.com/api/cn/index/fundamental` | **fullest**: pe_ttm, pb, ps_ttm, dyr, **ROE**, mc + percentiles; CN/HK/US indices | **free token** (CI secret); also needs `Accept-Encoding: gzip` | ✅ endpoint live, returned `token权限验证错误` = only auth missing |
| **Xueqiu / 雪球** `stock.xueqiu.com/v5/stock/quote.json` | point, amplitude, turnover, float shares, 52w, YTD; PE/PB in `detail` | must GET `/hq` first to seed cookie (`xq_a_token`); browser same-origin gets it free, CLI must bootstrap | ✅ works after cookie bootstrap |
| **legulegu / 乐咕** | PE + PB (A-share broad/industry) | path changes, token = md5(date) | already used by CI daily — known good (my blind path guess 404'd, expected) |
| **CSIndex official** `csindex.com.cn` | PE, dividend yield (authoritative, all CSI-series) | path occasionally changes | already used as PE fallback |
| **EastMoney** | datacenter batch PE/PB; push2 realtime snapshot | — | datacenter-web ✅; push2 gave 502 this run (likely IP rate-limit from my host; the JSONP push2 path the project uses in-browser is fine) |

### Not recommended (for index valuation)

- **Futu OpenAPI** ❌ — index snapshot returns **only advance/decline counts, no
  PE/PB/yield** (those exist only on _stock_ snapshots). Also requires a resident
  OpenD gateway + logged-in account, conflicting with the pure-static architecture.
  Effectively useless at the index level.

### akshare (wrapper, not a source)

Runs locally / in CI (python), bundling the multi-source mess. Project-relevant
interfaces:
- `index_value_hist_funddb(symbol, indicator)` — = funddb above; PE/PB/yield **+
  historical percentile**, **multi-market**.
- `index_zh_a_hist(...)` — history incl. **turnover**.
- `stock_index_pe_lg` / `stock_index_pb_lg` — legulegu broad-base PE/PB.
- `index_stock_cons_weight_csindex` — constituent weights.

This project's `scripts/build_data.py` already lives on this path.

## Indicator coverage at index level (who actually has it)

| Indicator | Sources |
|---|---|
| PE | funddb, lixinger, legulegu, CSIndex, Tencent (A-share), Xueqiu |
| PB | funddb, lixinger, legulegu, Xueqiu |
| Dividend yield | funddb, lixinger, CSIndex, legulegu (HSI monthly) |
| **Valuation percentile (precomputed)** | funddb, lixinger |
| Turnover / amplitude / 52w | Tencent, Xueqiu, akshare `index_zh_a_hist` |
| Market cap | TongHuaShun (total), lixinger (mc); mostly N/A at index level |
| **ROE** | lixinger only (index-weighted) |

## Next steps (not yet done)

- End-to-end verify funddb: pull HS300 + HSTECH + NASDAQ PE/PB/yield/percentile to
  confirm whether HK/US are actually covered, before wiring into `build_data.py`.
- Optionally verify a lixinger free token for the ROE/PS/mc superset.
