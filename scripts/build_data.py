#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抓取主流宽基指数的历史 PE / PB 估值序列，生成前端用的 data/<code>.json。

数据源：akshare 的乐咕乐股（legulegu）接口
  - 市盈率：ak.stock_index_pe_lg(symbol=<指数中文名>)   取「滚动市盈率」(TTM)
  - 市净率：ak.stock_index_pb_lg(symbol=<指数中文名>)   取「市净率」
两者均提供 2005 年至今的完整日频历史，适合做长周期分位分析。

注意：乐咕仅支持下方 MAP 中列出的宽基指数。主题指数（白酒/医疗/军工等）
与港美股，akshare 现有免费接口没有历史估值数据，故不在此生成；前端对
没有 data/<code>.json 的指数会自动降级为「仅点位分位」，不显示 PE/PB。

设计原则：逐个指数、逐个指标 try/except，单点失败不影响整体；详细打印日志。

本地可手动运行：  python scripts/build_data.py
线上由 GitHub Actions 每日自动运行（见 .github/workflows/update-data.yml）。
"""

import json
import os
import sys
import time
import traceback

try:
    import akshare as ak
except Exception as e:  # pragma: no cover
    print("无法导入 akshare，请先 `pip install akshare`：", e)
    sys.exit(1)

# 仓库根目录下的 data/ 目录
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data")
os.makedirs(OUT, exist_ok=True)

# 乐咕指数中文名  ->  前端使用的指数代码（即 JSON 文件名）。
# 名称必须与乐咕一致（其支持集：上证50/沪深300/上证380/创业板50/中证500/
# 上证180/深证红利/深证100/中证1000/上证红利/中证100/中证800）；代码须与前端
# 从东方财富取到的指数代码一致，否则该 JSON 不会被前端命中（无害，仅不显示）。
MAP = {
    "沪深300": "000300",
    "上证50": "000016",
    "上证180": "000010",
    "上证380": "000009",
    "中证100": "000903",
    "中证500": "000905",
    "中证800": "000906",
    "中证1000": "000852",
    "深证100": "399330",
    "深证红利": "399324",
    "上证红利": "000015",
    "创业板50": "399673",
}

# 取值列：PE 用滚动(TTM)市盈率，PB 用市净率。
PE_COLS = ("滚动市盈率", "市盈率")          # 优先「滚动市盈率」，兜底首个含“市盈率”的列
PB_COLS = ("市净率",)


def _pick_col(df, prefer):
    """从 df 中挑出取值列名：优先 prefer 中的精确列，否则取首个包含关键字的列。"""
    for c in prefer:
        if c in df.columns:
            return c
    key = prefer[0][-3:]  # “市盈率” / “市净率”
    for c in df.columns:
        if key in str(c):
            return c
    return None


def _to_float(x):
    try:
        f = float(x)
        return f if f == f else None  # 过滤 NaN
    except Exception:
        return None


def _series(df):
    """从乐咕返回的 df 提取 (dates, values)。第一列恒为日期。"""
    date_col = "日期" if "日期" in df.columns else df.columns[0]
    return [str(x)[:10] for x in df[date_col].tolist()], df


def fetch_one(name):
    """返回 {name, dates, pe, pb} 或 None。"""
    rec = {"name": name, "dates": [], "pe": [], "pb": []}
    got = False

    # --- 市盈率 ---
    try:
        df = ak.stock_index_pe_lg(symbol=name)
        if df is not None and len(df):
            col = _pick_col(df, PE_COLS)
            dates, _ = _series(df)
            if col:
                rec["dates"] = dates
                rec["pe"] = [_to_float(x) for x in df[col].tolist()]
                got = True
                print(f"  · {name} / 市盈率({col}): {len(dates)} 条")
            else:
                print(f"  · {name} / 市盈率: 找不到取值列 {list(df.columns)}")
        else:
            print(f"  · {name} / 市盈率: 空数据")
    except Exception as e:
        print(f"  · {name} / 市盈率: 失败 -> {e}")
    time.sleep(1)

    # --- 市净率 ---
    try:
        df = ak.stock_index_pb_lg(symbol=name)
        if df is not None and len(df):
            col = _pick_col(df, PB_COLS)
            dates, _ = _series(df)
            if col:
                vals = [_to_float(x) for x in df[col].tolist()]
                if rec["dates"]:
                    # 与已有日期对齐（PE/PB 日期一般一致，仍按日期映射稳妥）
                    m = dict(zip(dates, vals))
                    rec["pb"] = [m.get(d) for d in rec["dates"]]
                else:
                    rec["dates"] = dates
                    rec["pb"] = vals
                got = True
                print(f"  · {name} / 市净率({col}): {len(dates)} 条")
            else:
                print(f"  · {name} / 市净率: 找不到取值列 {list(df.columns)}")
        else:
            print(f"  · {name} / 市净率: 空数据")
    except Exception as e:
        print(f"  · {name} / 市净率: 失败 -> {e}")
    time.sleep(1)

    return rec if got else None


def main():
    print("开始抓取指数估值数据（数据源：乐咕乐股）...")
    meta = []
    for name, code in MAP.items():
        print(f"[{name} -> {code}]")
        try:
            rec = fetch_one(name)
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
        time.sleep(1)

    # 索引文件：前端可用它知道哪些指数有估值数据
    with open(os.path.join(OUT, "_index.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)
    print(f"完成，共生成 {len(meta)} 个指数的估值数据。")
    if not meta:
        # 一个都没成功通常说明数据源临时不可用，让 Actions 标红以便察觉
        print("警告：没有抓到任何数据。")
        sys.exit(2)


if __name__ == "__main__":
    main()
