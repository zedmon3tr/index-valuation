#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一次性回填：用理杏仁(lixinger)开放API把【10年 PE/PB/股息率】拉成静态种子文件。

为什么单独一个脚本而不并进 build_data.py：
  - lixinger 需要私有 token，且免费/试用额度有限（403=会员过期或免费次数用完），
    撑不起每天无限期跑的 CI。所以它只做【一次性回填】，趁试用期把 10 年基线烤进仓库。
  - 产出写到 data/seed/<code>.json，【提交进仓库】作为长历史底；build_data.py 每天
    读它做底、再用免费源(funddb 快照等)增量追加。token 失效也不影响已烤好的基线。

token 安全：从 scripts/.lixinger_token.json 读取（已 .gitignore，绝不提交、不进对话）。
  文件格式： {"token": "你的token"}

用法：
  python scripts/backfill_lixinger.py probe   # 先探针：dump 港美指数代码 + 一条样本响应结构
  python scripts/backfill_lixinger.py run      # 正式回填，写 data/seed/<code>.json

回填范围（用户已定：港美缺口 + A股股息率升级）：
  - A股：仅 dyr（股息率），升级现在 build_data.py 里只有 ~20 天的中证股息率为 10 年序列。
  - 港股/美股：pe_ttm + pb + dyr，10 年，填上"仅点位无估值"的缺口。
"""

import json
import os
import sys
import gzip
import time
import urllib.request
from datetime import datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN_FILE = os.path.join(ROOT, "scripts", ".lixinger_token.json")
SEED_DIR = os.path.join(ROOT, "data", "seed")
API_BASE = "https://open.lixinger.com/api"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36")

# 港美指数代码：我方 indexes.json 的 code → lixinger stockCode。
# A股数字代码两边一致，无需映射。HK/US 的确切代码先用 probe 确认（probe 会 dump 全表）。
HK_CODE_MAP = {"HSI": "HSI", "HSTECH": "HSTECH"}
US_CODE_MAP = {"SPX": ".INX"}  # 实测：lixinger 美指仅覆盖标普500；纳指100(NDX)无，退回 funddb 快照


def load_token():
    if not os.path.exists(TOKEN_FILE):
        sys.exit(
            f"未找到 token 文件：{TOKEN_FILE}\n"
            f"请创建它，内容为： {{\"token\": \"你的lixinger token\"}}\n"
            f"（该文件已在 .gitignore，不会提交）"
        )
    with open(TOKEN_FILE, encoding="utf-8") as f:
        tok = json.load(f).get("token", "").strip()
    if not tok:
        sys.exit(f"{TOKEN_FILE} 里的 token 为空。")
    return tok


_TOKEN = None


def api(path, body):
    """POST 一个 lixinger 接口，返回解析后的 dict。自动注入 token（须先 load_token）。
    lixinger 要求 Accept-Encoding 含 gzip。"""
    data = json.dumps({**body, "token": _TOKEN}).encode("utf-8")
    req = urllib.request.Request(
        f"{API_BASE}/{path}",
        data=data,
        method="POST",
        headers={
            "User-Agent": UA,
            "Content-Type": "application/json",
            "Accept-Encoding": "gzip",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
        if resp.headers.get("Content-Encoding", "") == "gzip":
            raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8"))


def _ten_years():
    end = datetime.now()
    start = end - timedelta(days=365 * 10)  # 间隔须 ≤ 10 年
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def _num(x, scale=1.0):
    """安全转 float 并按需缩放；非数/NaN → None。"""
    try:
        f = float(x)
        return f * scale if f == f else None
    except (TypeError, ValueError):
        return None


def load_indexes():
    with open(os.path.join(ROOT, "indexes.json"), encoding="utf-8") as f:
        return json.load(f)


def plan_for(item):
    """按市场决定 endpoint、lixinger 代码、要拉的指标(点路径→种子字段名)。
    返回 (endpoint, lx_code, {seed_field: metric_path}) 或 None(跳过)。"""
    code = str(item.get("code", "")).strip()
    market = item.get("market", "")
    if market == "A股":
        # A股只升级股息率；PE/PB 仍由 build_data.py 的 legulegu 负责。
        return ("cn/index/fundamental", code, {"dy": "dyr.mcw"})
    if market == "港股":
        lx = HK_CODE_MAP.get(code)
        if not lx:
            return None
        return ("hk/index/fundamental", lx, {"pe": "pe_ttm.mcw", "pb": "pb.mcw", "dy": "dyr.mcw"})
    if market == "美股":
        lx = US_CODE_MAP.get(code)
        if not lx:
            return None
        return ("us/index/fundamental", lx, {"pe": "pe_ttm.mcw", "pb": "pb.mcw", "dy": "dyr.mcw"})
    return None


def fetch_series(endpoint, lx_code, fields):
    """拉单指数 10 年序列。返回 {dates, <field>...}（各字段数组与 dates 等长、按日期升序）。"""
    start, end = _ten_years()
    metrics = list(dict.fromkeys(fields.values()))
    resp = api(endpoint, {
        "startDate": start, "endDate": end,
        "stockCodes": [lx_code],  # date range 模式只能传一个代码
        "metricsList": metrics,
    })
    if resp.get("code") != 1 and "data" not in resp:
        raise RuntimeError(f"接口返回异常: {json.dumps(resp, ensure_ascii=False)[:200]}")
    rows = resp.get("data") or []
    rows = [r for r in rows if r.get("date")]
    rows.sort(key=lambda r: r["date"])
    out = {"dates": [str(r["date"])[:10] for r in rows]}
    for seed_field, path in fields.items():
        # 响应里指标是扁平 key（如 "pe_ttm.mcw"），直接整串取，不是嵌套字典。
        # 股息率 dyr.mcw 是小数(0.0274)，×100 对齐项目里 dy 的百分数约定(2.74)。
        scale = 100.0 if seed_field == "dy" else 1.0
        out[seed_field] = [_num(r.get(path), scale) for r in rows]
    return out


def cmd_probe():
    """探针：dump 港美指数代码全表 + 一条样本响应结构，确认代码映射与字段嵌套。"""
    global _TOKEN
    _TOKEN = load_token()
    print("=== 港股指数代码表 (hk/index) ===")
    try:
        r = api("hk/index", {})
        for x in (r.get("data") or [])[:60]:
            print(f"  {x.get('stockCode'):>12}  {x.get('name')}")
    except Exception as e:
        print("  hk/index 失败:", e)
    print("\n=== 美股指数代码表 (us/index) ===")
    try:
        r = api("us/index", {})
        for x in (r.get("data") or [])[:60]:
            print(f"  {x.get('stockCode'):>12}  {x.get('name')}")
    except Exception as e:
        print("  us/index 失败:", e)
    print("\n=== 样本响应结构 (cn/index/fundamental 000300, 近5天) ===")
    try:
        start = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        end = datetime.now().strftime("%Y-%m-%d")
        r = api("cn/index/fundamental", {
            "startDate": start, "endDate": end, "stockCodes": ["000300"],
            "metricsList": ["pe_ttm.mcw", "pb.mcw", "dyr.mcw", "pe_ttm.y10.mcw.cvpos"],
        })
        rows = r.get("data") or []
        print("  顶层 keys:", list(r.keys()), "| rows:", len(rows))
        if rows:
            print("  data[0] 原样:", json.dumps(rows[-1], ensure_ascii=False))
    except Exception as e:
        print("  样本失败:", e)


def cmd_run():
    global _TOKEN
    _TOKEN = load_token()
    os.makedirs(SEED_DIR, exist_ok=True)
    items = load_indexes()
    written = 0
    for item in items:
        plan = plan_for(item)
        if not plan:
            continue
        endpoint, lx_code, fields = plan
        name, code = item.get("name"), item.get("code")
        try:
            series = fetch_series(endpoint, lx_code, fields)
        except Exception as e:
            print(f"  ✗ {name}({code}) 失败: {e}")
            continue
        if not series.get("dates"):
            print(f"  · {name}({code}) 无数据，跳过")
            continue
        # 只保留至少有一个非空值的字段，避免写满 null 的列。
        kept = {"code": code, "name": name, "lixinger_code": lx_code, "dates": series["dates"]}
        srcs = {}
        for f in ("pe", "pb", "dy"):
            if f in series and any(v is not None for v in series[f]):
                kept[f] = series[f]
                srcs[f] = "lixinger"
        kept["sources"] = srcs
        path = os.path.join(SEED_DIR, f"{code}.json")
        with open(path, "w", encoding="utf-8") as fp:
            json.dump(kept, fp, ensure_ascii=False, separators=(",", ":"))
        print(f"  ✓ {name}({code}) → {os.path.relpath(path, ROOT)}  "
              f"[{', '.join(srcs)}] {len(series['dates'])} 条")
        written += 1
        time.sleep(0.2)  # 限流 36/s，这里很保守
    print(f"\n完成，写入 {written} 个种子文件到 data/seed/。请提交它们进仓库。")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "probe":
        cmd_probe()
    elif cmd == "run":
        cmd_run()
    else:
        print(__doc__)
        sys.exit("请指定子命令： probe 或 run")
