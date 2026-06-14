#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抓取主流指数的历史 PE / PB 估值序列，生成前端用的 data/<code>.json。

数据源：乐咕乐股（legulegu）指数估值接口（akshare 暴露的 stock_index_pe_lg
只写死了 12 个宽基；这里直接调它底层的同一组 API，把 indexCode 参数化，从而
覆盖白酒/医疗/军工等主题指数与科创50等更多指数）：
  - 市盈率：https://legulegu.com/api/stockdata/index-basic-pe   取 ttmPe（滚动TTM）
  - 市净率：https://legulegu.com/api/stockdata/index-basic-pb   取 pb
token 与 cookie 复用 akshare 内部实现（hash_code / get_cookie_csrf），故 CI 中
仍 `pip install akshare` 即可（py_mini_racer 是其依赖）。

交易所后缀（.SH/.SZ/.CSI）因指数而异，脚本会自动逐个尝试，命中即用；乐咕没有
估值数据的指数（如上证指数、创业板指、中证全指）自动跳过，前端对缺失指数会
降级为仅点位分位。

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

# 指数清单的单一数据源：仓库根目录的 indexes.json（前端首页也读它）。
# 这里据此决定抓取哪些指数——改首页清单即自动改抓取范围，无需动本脚本。
# 仅抓 A 股（代码全为数字）；港美股（HSI/NDX 等）乐咕无估值数据，跳过。
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

    dates, pe, suf = _fetch(PE_URL, code, "ttmPe")
    if dates:
        rec["dates"] = dates
        rec["pe"] = pe
        got = True
        print(f"  · {name} / 市盈率(ttmPe@{suf}): {len(dates)} 条")
    else:
        print(f"  · {name} / 市盈率: 无数据")
    time.sleep(0.4)

    bdates, pb, suf = _fetch(PB_URL, code, "pb")
    if bdates:
        if rec["dates"]:
            m = dict(zip(bdates, pb))
            rec["pb"] = [m.get(d) for d in rec["dates"]]  # 对齐到 PE 的日期
        else:
            rec["dates"] = bdates
            rec["pb"] = pb
        got = True
        print(f"  · {name} / 市净率(pb@{suf}): {len(bdates)} 条")
    else:
        print(f"  · {name} / 市净率: 无数据")
    time.sleep(0.4)

    return rec if got else None


def main():
    print("开始抓取指数估值数据（数据源：乐咕乐股）...")
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
