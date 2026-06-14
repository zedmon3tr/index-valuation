#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抓取主流指数的历史 PE / PB / 股息率估值序列，生成前端用的 data/<code>.json。

数据源（两级，PE 优先乐咕、缺失则中证兜底；PB 仅乐咕）：
  1) 乐咕乐股 legulegu —— PE + PB，覆盖宽基与白酒/医疗/军工等主题指数。
     akshare 的 stock_index_pe_lg 只写死了 12 个宽基；这里直接调它底层的同一组
     API 并把 indexCode 参数化，覆盖更多指数。
       - 市盈率：https://legulegu.com/api/stockdata/index-basic-pe   取 addTtmPe
       - 市净率：https://legulegu.com/api/stockdata/index-basic-pb   取 addPb
     ⚠ 字段命名反直觉：add 前缀才是“市值加权”的正常值，裸 ttmPe/pb 是“等权”值。
     token 是当天日期的 MD5，cookie/csrf 复用 akshare 内部实现。
     交易所后缀（.SH/.SZ/.CSI）因指数而异，脚本自动逐个尝试。
  2) 中证官方 index-perf —— 仅 PE（peg 字段），覆盖所有中证系指数（中证全指、
     上证指数、各类 H 代码主题指数）。乐咕没有 PE 的指数用它兜底。
  3) 中证官方 indicator XLS —— 近期 PE 与股息率，股息率取“计算用股本 D/P2”。
     官方文件只保留近期数据，前端会明确展示实际覆盖日期，不伪装成长历史。
  4) 乐咕恒生接口 —— 恒生指数完整月度历史 PE 与股息率（dvRatio）。

创业板指、深证成指（深证/国证系）与多数海外指数没有估值序列，自动跳过；前端对缺失
PE/PB/股息率的指数降级为仅点位分位，并按实际有效序列显示指标标签。

设计原则：逐个指数、逐个指标 try/except，单点失败不影响整体；详细打印日志。

本地可手动运行：  python scripts/build_data.py
线上由 GitHub Actions 每日自动运行（见 .github/workflows/update-data.yml）。
"""

import json
import os
import sys
import time
import traceback
from io import BytesIO
from datetime import datetime
from hashlib import md5

try:
    import akshare as ak
    import pandas as pd
    import requests
    from akshare.stock_feature.stock_a_indicator import get_cookie_csrf
except Exception as e:  # pragma: no cover
    print("依赖缺失，请先 `pip install akshare`：", e)
    sys.exit(1)

from data_utils import merge_series

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data")
os.makedirs(OUT, exist_ok=True)

PE_URL = "https://legulegu.com/api/stockdata/index-basic-pe"
PB_URL = "https://legulegu.com/api/stockdata/index-basic-pb"
HS_DIVIDEND_URL = "https://legulegu.com/api/stockdata/hs"
SUFFIXES = (".SH", ".SZ", ".CSI")

# 指数清单的单一数据源：仓库根目录的 indexes.json（前端也读它）。
# 数据抓取覆盖表中【所有】指数，与 home 开关无关——
# home 只决定是否上首页，但表里的指数都预生成估值数据，这样用户搜到非首页
# 指数时也能看估值。港美股中目前仅 HSI 有可靠历史股息率，其余自动跳过。
# 交易所后缀(.SH/.SZ/.CSI)由脚本自动探测；乐咕无数据者自动跳过。
def load_indexes():
    with open(os.path.join(ROOT, "indexes.json"), encoding="utf-8") as f:
        items = json.load(f)
    out = []
    for it in items:
        code = str(it.get("code", "")).strip()
        if code:
            out.append({"code": code, "name": it.get("name", code), "secid": str(it.get("secid", ""))})
    return out


INDEXES = load_indexes()

# token 每日变化；cookie/csrf 用一个通用页面即可（实测对所有 indexCode 通用）。
TOKEN = md5(datetime.now().date().isoformat().encode()).hexdigest()
COOKIE = get_cookie_csrf(url="https://legulegu.com/stockdata/sz50-ttm-lyr")


def _to_float(x):
    try:
        f = float(x)
        return f if f == f else None  # 过滤 NaN
    except Exception:
        return None


# 中证官方 index-perf 接口：兜底用，覆盖所有中证系指数（含中证全指、上证指数、
# 各类 H 代码主题指数），按日期区间返回全历史，字段 peg 即滚动市盈率。只有 PE，
# 无 PB——所以仅用于乐咕没有 PE 的指数补 PE。
CSI_URL = "https://www.csindex.com.cn/csindex-home/perf/index-perf"
CSI_HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://www.csindex.com.cn/"}
CSI_INDICATOR_URL = (
    "https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/"
    "file/autofile/indicator/{code}indicator.xls"
)


def _fetch_csi_pe(code):
    """中证 index-perf 取 PE（peg）。返回 (dates, pe) 或 (None, None)。"""
    try:
        r = requests.get(
            CSI_URL,
            params={"indexCode": code, "startDate": "20050101",
                    "endDate": datetime.now().strftime("%Y%m%d")},
            headers=CSI_HEADERS,
            timeout=30,
        )
        rows = r.json().get("data") or []
        if not rows:
            return None, None
        dates = [f"{d[:4]}-{d[4:6]}-{d[6:8]}" for d in (str(x.get("tradeDate")) for x in rows)]
        pe = [_to_float(x.get("peg")) for x in rows]
        return dates, pe
    except Exception as e:
        print(f"    (CSI {code} 请求异常: {e})")
        return None, None


def _fetch_csi_dividend(code):
    """中证官方 indicator XLS 取近期股息率2（计算用股本 D/P2）。"""
    try:
        r = requests.get(
            CSI_INDICATOR_URL.format(code=code),
            headers=CSI_HEADERS,
            timeout=30,
        )
        r.raise_for_status()
        frame = pd.read_excel(BytesIO(r.content))
        if frame.empty or frame.shape[1] < 10:
            return None, None
        pairs = []
        for raw_date, raw_value in zip(frame.iloc[:, 0], frame.iloc[:, 9]):
            text = str(raw_date).split(".")[0].strip()
            if len(text) == 8 and text.isdigit():
                date = f"{text[:4]}-{text[4:6]}-{text[6:8]}"
            else:
                parsed = pd.to_datetime(raw_date, errors="coerce")
                if pd.isna(parsed):
                    continue
                date = parsed.strftime("%Y-%m-%d")
            value = _to_float(raw_value)
            if value is not None:
                pairs.append((date, value))
        pairs.sort(key=lambda item: item[0])
        if not pairs:
            return None, None
        return [item[0] for item in pairs], [item[1] for item in pairs]
    except Exception as e:
        print(f"    (CSI {code} 股息率请求异常: {e})")
        return None, None


def _fetch_hsi_valuation():
    """乐咕恒生指数完整月度 PE 与股息率。"""
    try:
        r = requests.get(
            HS_DIVIDEND_URL,
            params={"token": TOKEN, "indexCode": "HSI"},
            timeout=30,
            **COOKIE,
        )
        rows = r.json() or []
        rows_by_date = {}
        for row in rows:
            date = str(row.get("date", ""))[:10]
            if date:
                rows_by_date[date] = (
                    _to_float(row.get("pe")),
                    _to_float(row.get("dvRatio")),
                )
        dates = sorted(rows_by_date)
        if not dates:
            return None, None, None
        return (
            dates,
            [rows_by_date[date][0] for date in dates],
            [rows_by_date[date][1] for date in dates],
        )
    except Exception as e:
        print(f"    (恒生指数估值请求异常: {e})")
        return None, None, None


def _fetch(url, code, value_field):
    """逐个后缀尝试，返回 (dates, values) 或 (None, None)。"""
    for suf in SUFFIXES:
        try:
            r = requests.get(
                url,
                params={"token": TOKEN, "indexCode": code + suf},
                timeout=25,
                **COOKIE,
            )
            data = r.json().get("data")
            if data:
                dates = [str(row.get("date"))[:10] for row in data]
                vals = [_to_float(row.get(value_field)) for row in data]
                return dates, vals, suf
        except Exception as e:
            print(f"    ({code}{suf} 请求异常: {e})")
        time.sleep(0.4)
    return None, None, None


# 历史点位（指数收盘点位）起始日期：与估值数据同期（2005 起），避免老指数（如上证
# 指数自 1990 年）把 JSON 撑得过大；分位分析也以这十余年为准。
POINT_START = "2005-01-01"


def _normalize_close_df(df, start=POINT_START):
    """从各源返回的 DataFrame 里容错地抽出 (dates, closes)，按日期升序、过滤早于 start 的。"""
    if df is None or len(df) == 0:
        return None, None
    frame = df.reset_index()
    cols = {str(c).strip().lower(): c for c in frame.columns}
    date_col = next((cols[k] for k in ("date", "日期", "trade_date", "index") if k in cols), None)
    close_col = next((cols[k] for k in ("close", "收盘", "收盘价", "最新价") if k in cols), None)
    if date_col is None or close_col is None:
        return None, None
    pairs = {}
    for raw_date, raw_close in zip(frame[date_col], frame[close_col]):
        parsed = pd.to_datetime(raw_date, errors="coerce")
        value = _to_float(raw_close)
        if pd.isna(parsed) or value is None:
            continue
        date = parsed.strftime("%Y-%m-%d")
        if date >= start:
            pairs[date] = value  # 同日去重，保留后者
    if not pairs:
        return None, None
    dates = sorted(pairs)
    return dates, [pairs[d] for d in dates]


def _fetch_point_history(code, name, secid):
    """多源兜底抓历史收盘点位。返回 (dates, closes, source) 或 (None, None, None)。

    A股：新浪 → 腾讯 → 东财（三个独立域名，任一可用即可）。
    港股/海外：尽力而为，失败则跳过——前端会回退到浏览器实时接口。
    """
    today = datetime.now().strftime("%Y%m%d")
    if code.isdigit():
        sym = ("sh" if secid.startswith("1.") else "sz") + code
        attempts = [
            ("sina", lambda: ak.stock_zh_index_daily(symbol=sym)),
            ("tencent", lambda: ak.stock_zh_index_daily_tx(symbol=sym)),
            ("em", lambda: ak.stock_zh_index_daily_em(symbol=sym, start_date=POINT_START.replace("-", ""), end_date=today)),
        ]
    elif code in ("HSI", "HSTECH"):
        attempts = [
            ("sina_hk", lambda: ak.stock_hk_index_daily_sina(symbol=code)),
            ("em_hk", lambda: ak.stock_hk_index_daily_em(symbol=code)),
        ]
    else:
        # 美股/全球指数：接口与符号格式不稳，尽力一次，失败交给前端实时兜底。
        attempts = [
            ("global_em", lambda: ak.index_global_hist_em(symbol=name)),
        ]
    for src, fn in attempts:
        try:
            dates, closes = _normalize_close_df(fn())
            if dates and len(dates) >= 30:
                print(f"  · {name} / 点位({src}): {len(dates)} 条")
                return dates, closes, src
        except Exception as e:
            print(f"    (点位 {name}@{src} 异常: {e})")
        time.sleep(0.3)
    print(f"  · {name} / 点位: 无数据（前端回退实时接口）")
    return None, None, None


def fetch_one(code, name, secid=""):
    """返回日期对齐后的 {name, dates, close?, pe?, pb?, dy?} 或 None。"""
    series = {}
    sources = {}

    # 历史点位：多源兜底，写进静态 JSON，前端不再硬依赖浏览器实时接口。
    pdates, pclose, psrc = _fetch_point_history(code, name, secid)
    if pdates:
        series["close"] = (pdates, pclose)
        sources["close"] = "akshare:" + psrc

    if code.isdigit():
        # 注意乐咕字段命名反直觉：addTtmPe/addPb 才是市值加权值。
        dates, pe, suf = _fetch(PE_URL, code, "addTtmPe")
        if dates:
            series["pe"] = (dates, pe)
            sources["pe"] = "legulegu:addTtmPe"
            print(f"  · {name} / 市盈率(乐咕 addTtmPe@{suf}): {len(dates)} 条")
        else:
            cdates, cpe = _fetch_csi_pe(code)
            if cdates:
                series["pe"] = (cdates, cpe)
                sources["pe"] = "csindex:peg"
                print(f"  · {name} / 市盈率(中证 peg): {len(cdates)} 条")
            else:
                print(f"  · {name} / 市盈率: 无数据")
        time.sleep(0.4)

        bdates, pb, suf = _fetch(PB_URL, code, "addPb")
        if bdates:
            series["pb"] = (bdates, pb)
            sources["pb"] = "legulegu:addPb"
            print(f"  · {name} / 市净率(addPb@{suf}): {len(bdates)} 条")
        else:
            print(f"  · {name} / 市净率: 无数据")
        time.sleep(0.4)

        ddates, dy = _fetch_csi_dividend(code)
        if ddates:
            series["dy"] = (ddates, dy)
            sources["dy"] = "csindex:D/P2"
            print(f"  · {name} / 股息率(中证 D/P2): {len(ddates)} 条")
        else:
            print(f"  · {name} / 股息率: 无数据")
    elif code == "HSI":
        hdates, hpe, hdy = _fetch_hsi_valuation()
        if hdates and any(value is not None for value in hpe):
            series["pe"] = (hdates, hpe)
            sources["pe"] = "legulegu:HSI"
            print(f"  · {name} / 市盈率(乐咕 HSI): {len(hdates)} 条")
        if hdates and any(value is not None for value in hdy):
            series["dy"] = (hdates, hdy)
            sources["dy"] = "legulegu:dvRatio"
            print(f"  · {name} / 股息率(乐咕 dvRatio): {len(hdates)} 条")
        else:
            print(f"  · {name} / 股息率: 无数据")

    aligned = merge_series(series)
    if not aligned.get("dates"):
        return None
    return {"name": name, **aligned, "sources": sources}


def main():
    print("开始抓取指数估值数据（PE / PB / 股息率）...")
    meta = []
    for it in INDEXES:
        code, name, secid = it["code"], it["name"], it["secid"]
        print(f"[{name} -> {code}]")
        try:
            rec = fetch_one(code, name, secid)
        except Exception:
            traceback.print_exc()
            rec = None
        if not rec:
            print(f"  跳过 {name}（无可用数据）")
            continue
        rec["code"] = code
        path = os.path.join(OUT, f"{code}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, separators=(",", ":"))
        meta.append({"code": code, "name": name})
        print(f"  已保存 {path}")

    # 清理：删掉已不在清单里的旧数据文件，保持 data/ 与 indexes.json 同步。
    keep = {it["code"] for it in INDEXES} | {"_index"}
    for fn in os.listdir(OUT):
        if fn.endswith(".json") and fn[:-5] not in keep:
            os.remove(os.path.join(OUT, fn))
            print(f"  清理过期文件 {fn}")

    with open(os.path.join(OUT, "_index.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)
    print(f"完成，共生成 {len(meta)} 个指数的估值数据。")
    if not meta:
        # 一个都没成功通常说明数据源临时不可用，让 Actions 标红以便察觉
        print("警告：没有抓到任何数据。")
        sys.exit(2)


if __name__ == "__main__":
    main()
