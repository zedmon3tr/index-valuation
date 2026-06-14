#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抓取主流指数的历史 PE / PB 估值序列，生成前端用的 data/<code>.json。
数据源：akshare 的 index_value_hist_funddb（韭圈儿 / funddb）。
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

# funddb 指数名称  ->  前端使用的指数代码（即 JSON 文件名）。
# 名称必须与 funddb 一致；不被支持的会在抓取时自动跳过。
MAP = {
    "沪深300": "000300",
    "上证50": "000016",
    "中证500": "000905",
    "中证1000": "000852",
    "创业板指": "399006",
    "科创50": "000688",
    "深证100": "399330",
    "中证全指": "000985",
    "中证红利": "000922",
    "上证红利": "000015",
    "中证白酒": "399997",
    "中证医疗": "399989",
    "中证军工": "399967",
    # 海外（funddb 若不支持会自动跳过）
    "恒生指数": "HSI",
    "恒生科技": "HSTECH",
    "纳斯达克100": "NDX",
    "标普500": "SPX",
}

INDICATORS = (("市盈率", "pe"), ("市净率", "pb"))


def fetch_one(name):
    """返回 {dates, pe, pb} 或 None。"""
    rec = {"name": name, "dates": [], "pe": [], "pb": []}
    got = False
    for indicator, key in INDICATORS:
        try:
            df = ak.index_value_hist_funddb(symbol=name, indicator=indicator)
            if df is None or len(df) == 0:
                print(f"  · {name} / {indicator}: 空数据，跳过")
                continue
            # 日期列与取值列
            date_col = "日期" if "日期" in df.columns else df.columns[0]
            val_col = indicator if indicator in df.columns else df.columns[1]
            dates = [str(x)[:10] for x in df[date_col].tolist()]

            def to_float(x):
                try:
                    f = float(x)
                    return f if f == f else None  # 过滤 NaN
                except Exception:
                    return None

            vals = [to_float(x) for x in df[val_col].tolist()]

            if not rec["dates"]:
                rec["dates"] = dates
                rec[key] = vals
            else:
                # 两个指标的日期可能不完全一致，按日期对齐到已有 dates
                m = dict(zip(dates, vals))
                rec[key] = [m.get(d) for d in rec["dates"]]
            got = True
            print(f"  · {name} / {indicator}: {len(dates)} 条")
        except Exception as e:
            print(f"  · {name} / {indicator}: 失败 -> {e}")
        time.sleep(1)
    return rec if got else None


def main():
    print("开始抓取指数估值数据 ...")
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
