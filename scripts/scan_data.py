#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全数据扫描：交叉校验 indexes.json / funds.json / data/*.json / data/funds_nav.json，
确保本地「数据库」自洽、无缺口、无脏数据。只读，不改任何文件。退出码 0=全过，1=有问题。

检查项：
  主表    secid 格式、code 唯一、字段完整、市场合法
  指数数据 每个指数有 data/<code>.json；dates 升序且唯一；各序列长度=len(dates)；
          数值非 NaN/Inf；至少一个估值指标有有效值；新鲜度（最后日期距今）
  基金    trackIndex 指向已存在的指数（在主表且有 data 文件）
  净值    funds_nav.json 覆盖全部基金；nav 有值且为 3 位小数；navDate 合理
  孤儿    data/*.json 中不在主表的过期文件（_index.json/seed 除外）
"""
import json
import math
import os
import re
from datetime import date, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
TODAY = date.today()

errors, warns = [], []


def err(msg):
    errors.append(msg)


def warn(msg):
    warns.append(msg)


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def is_finite_num(x):
    return isinstance(x, (int, float)) and math.isfinite(x)


def check_main_table(rows, kind, need_track=False):
    seen = set()
    for r in rows:
        code = r.get("code")
        if not code:
            err(f"[{kind}] 缺 code：{r}")
            continue
        if code in seen:
            err(f"[{kind}] code 重复：{code}")
        seen.add(code)
        if not re.match(r"^\d+\.\w+$", str(r.get("secid", ""))):
            err(f"[{kind}] {code} secid 格式异常：{r.get('secid')!r}")
        for fld in ("name", "market"):
            if not r.get(fld):
                err(f"[{kind}] {code} 缺字段 {fld}")
        if "home" not in r:
            warn(f"[{kind}] {code} 无 home 字段（默认不上首页）")
        if need_track and not r.get("trackIndex"):
            err(f"[{kind}] {code} 缺 trackIndex")
    return seen


def check_series_file(code, path):
    d = load(path)
    dates = d.get("dates") or []
    if not dates:
        err(f"[data] {code} 无 dates")
        return
    # 升序 + 唯一
    if dates != sorted(dates):
        err(f"[data] {code} dates 非升序")
    if len(set(dates)) != len(dates):
        err(f"[data] {code} dates 有重复")
    n = len(dates)
    metric_ok = False
    for key in ("close", "pe", "pb", "dy"):
        vals = d.get(key)
        if vals is None:
            continue
        if len(vals) != n:
            err(f"[data] {code} 序列 {key} 长度 {len(vals)} ≠ dates {n}")
            continue
        bad = [v for v in vals if v is not None and not is_finite_num(v)]
        if bad:
            err(f"[data] {code} 序列 {key} 含非数值（如 {bad[0]!r}）")
        if any(v is not None for v in vals):
            if key in ("pe", "pb", "dy"):
                metric_ok = True
    if not metric_ok:
        warn(f"[data] {code} 无任何有效 PE/PB/股息率（仅点位分位）")
    # 新鲜度
    try:
        last = datetime.strptime(dates[-1], "%Y-%m-%d").date()
        gap = (TODAY - last).days
        if gap > 5:
            warn(f"[data] {code} 数据偏旧：最后 {dates[-1]}（距今 {gap} 天）")
    except ValueError:
        err(f"[data] {code} 末日期格式异常：{dates[-1]!r}")


def main():
    indexes = load(os.path.join(ROOT, "indexes.json"))
    funds = load(os.path.join(ROOT, "funds.json"))
    idx_codes = check_main_table(indexes, "indexes")
    check_main_table(funds, "funds", need_track=True)

    # 指数数据文件
    data_files = {f[:-5] for f in os.listdir(DATA)
                  if f.endswith(".json") and f != "_index.json"}
    for code in sorted(idx_codes):
        p = os.path.join(DATA, code + ".json")
        if not os.path.exists(p):
            err(f"[data] 指数 {code} 在主表但缺 data/{code}.json")
        else:
            check_series_file(code, p)

    # 孤儿数据文件
    for orphan in sorted(data_files - idx_codes - {"funds_nav"}):
        warn(f"[data] 孤儿文件 data/{orphan}.json（不在 indexes.json）")

    # 基金 trackIndex 必须指向已存在且有数据的指数
    for f in funds:
        ti = f.get("trackIndex")
        if ti and ti not in idx_codes:
            err(f"[funds] {f['code']} trackIndex={ti} 不在 indexes.json 主表")
        elif ti and not os.path.exists(os.path.join(DATA, ti + ".json")):
            err(f"[funds] {f['code']} trackIndex={ti} 无 data 文件")

    # 净值快照
    navp = os.path.join(DATA, "funds_nav.json")
    if not os.path.exists(navp):
        err("[nav] 缺 data/funds_nav.json（先跑 fetch_fund_nav.py）")
    else:
        nav = load(navp)
        nav_by_code = {r["code"]: r for r in nav.get("funds", [])}
        for f in funds:
            rec = nav_by_code.get(f["code"])
            if not rec:
                err(f"[nav] 基金 {f['code']} 无净值记录")
                continue
            v = rec.get("nav")
            if v is None:
                err(f"[nav] {f['code']} nav 为空（{rec.get('source')}）")
                continue
            # 3 位小数：round 后应相等
            if round(float(v), 3) != float(v):
                err(f"[nav] {f['code']} nav 非 3 位小数：{v}")
            nd = rec.get("navDate")
            try:
                gap = (TODAY - datetime.strptime(nd, "%Y-%m-%d").date()).days
                if gap > 7:
                    warn(f"[nav] {f['code']} 净值偏旧：{nd}（距今 {gap} 天）")
            except (ValueError, TypeError):
                err(f"[nav] {f['code']} navDate 异常：{nd!r}")

    print(f"扫描完成：{len(idx_codes)} 指数 / {len(funds)} 基金")
    print(f"  错误 {len(errors)}　警告 {len(warns)}")
    for m in errors:
        print("  ✗ " + m)
    for m in warns:
        print("  ⚠ " + m)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
