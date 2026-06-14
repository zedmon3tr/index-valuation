#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抓取主流指数的历史 PE / PB 估值序列，生成前端用的 data/<code>.json。

数据源（两级，PE 优先乐咕、缺失则中证兜底；PB 仅乐咕）：
  1) 乐咕乐股 legulegu —— PE + PB，覆盖宽基与白酒/医疗/军工等主题指数。
     akshare 的 stock_index_pe_lg 只写死了 12 个宽基；这里直接调它底层的同一组
     API 并把 indexCode 参数化，覆盖更多指数。
       - 市盈率：https://legulegu.com/api/stockdata/index-basic-pe   取 addTtmPe
       - 市净率：https://legulegu.com/api/stockdata/index-basic-pb   取 addPb
     ⚠ 字段命名反直觉：add 前缀才是“市值加权”的正常值，裸 ttmPe/pb 是“等权”值。
     token 与 cookie 复用 akshare 内部实现（hash_code / get_cookie_csrf），故 CI
     中仍 `pip install akshare` 即可（py_mini_racer 是其依赖）。
     交易所后缀（.SH/.SZ/.CSI）因指数而异，脚本自动逐个尝试。
  2) 中证官方 index-perf —— 仅 PE（peg 字段），覆盖所有中证系指数（中证全指、
     上证指数、各类 H 代码主题指数）。乐咕没有 PE 的指数用它兜底。

创业板指、深证成指（深证/国证系）与港美股两个源都没有，自动跳过；前端对缺失
PE/PB 的指数降级为仅点位分位，对只有 PE 没 PB 的指数只显示市盈率标签。

设计原则：逐个指数、逐个指标 try/except，单点失败不影响整体；详细打印日志。

本地可手动运行：  python scripts/build_data.py
线上由 GitHub Actions 每日自动运行（见 .github/workflows/update-data.yml）。
"""

import json
import os
import sys
import time
import traceback
from datetime import datetime

try:
    import requests
    import py_mini_racer
    from akshare.stock_feature.stock_a_pe_and_pb import hash_code
    from akshare.stock_feature.stock_a_indicator import get_cookie_csrf
except Exception as e:  # pragma: no cover
    print("依赖缺失，请先 `pip install akshare`：", e)
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data")
os.makedirs(OUT, exist_ok=True)

PE_URL = "https://legulegu.com/api/stockdata/index-basic-pe"
PB_URL = "https://legulegu.com/api/stockdata/index-basic-pb"
SUFFIXES = (".SH", ".SZ", ".CSI")

# 指数清单的单一数据源：仓库根目录的 indexes.json（前端也读它）。
# 数据抓取覆盖表中【所有】A 股指数（代码全为数字），与 home 开关无关——
# home 只决定是否上首页，但表里的指数都预生成估值数据，这样用户搜到非首页
# 指数时也能看 PE/PB。港美股（HSI/NDX 等）乐咕无估值数据，跳过。
# 交易所后缀(.SH/.SZ/.CSI)由脚本自动探测；乐咕无数据者自动跳过。
def load_indexes():
    with open(os.path.join(ROOT, "indexes.json"), encoding="utf-8") as f:
        items = json.load(f)
    out = {}
    for it in items:
        code = str(it.get("code", "")).strip()
        if code.isdigit():  # 仅 A 股指数
            out[code] = it.get("name", code)
    return out


INDEXES = load_indexes()

# token 每日变化；cookie/csrf 用一个通用页面即可（实测对所有 indexCode 通用）。
_js = py_mini_racer.MiniRacer()
_js.eval(hash_code)
TOKEN = _js.call("hex", datetime.now().date().isoformat()).lower()
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


def fetch_one(code, name):
    """返回 {name, dates, pe, pb} 或 None。"""
    rec = {"name": name, "dates": [], "pe": [], "pb": []}
    got = False

    # 注意乐咕字段命名反直觉：addTtmPe/addPb 才是“市值加权”的正常值，
    # 裸 ttmPe/pb 是“等权”值（偏大）。务必取 add 前缀的。
    dates, pe, suf = _fetch(PE_URL, code, "addTtmPe")
    if dates:
        rec["dates"] = dates
        rec["pe"] = pe
        got = True
        print(f"  · {name} / 市盈率(乐咕 addTtmPe@{suf}): {len(dates)} 条")
    else:
        # 乐咕没有 → 中证 index-perf 兜底（仅 PE）
        cdates, cpe = _fetch_csi_pe(code)
        if cdates:
            rec["dates"] = cdates
            rec["pe"] = cpe
            got = True
            print(f"  · {name} / 市盈率(中证 peg): {len(cdates)} 条")
        else:
            print(f"  · {name} / 市盈率: 无数据")
    time.sleep(0.4)

    bdates, pb, suf = _fetch(PB_URL, code, "addPb")
    if bdates:
        if rec["dates"]:
            m = dict(zip(bdates, pb))
            rec["pb"] = [m.get(d) for d in rec["dates"]]  # 对齐到 PE 的日期
        else:
            rec["dates"] = bdates
            rec["pb"] = pb
        got = True
        print(f"  · {name} / 市净率(addPb@{suf}): {len(bdates)} 条")
    else:
        print(f"  · {name} / 市净率: 无数据")
    time.sleep(0.4)

    return rec if got else None


def main():
    print("开始抓取指数估值数据（乐咕 PE+PB，中证 index-perf 兜底 PE）...")
    meta = []
    for code, name in INDEXES.items():
        print(f"[{name} -> {code}]")
        try:
            rec = fetch_one(code, name)
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
    keep = set(INDEXES) | {"_index"}
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
