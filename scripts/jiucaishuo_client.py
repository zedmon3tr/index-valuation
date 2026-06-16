#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""韭圈儿(funddb) 指数估值数据源适配器 —— 非官方公开接口。

⚠️ 非官方：这是 funddb 网页(https://funddb.cn/site/index)前端用的后端接口，不是官方
承诺的稳定 API。域名/路径/签名 key/版本/字段都可能变。**前端绝不直连**——只由
build_data.py 在 CI 里调它、抓取失败就回退别的源、绝不用空数据覆盖既有好数据。
逆向与字段说明见 xueqiu_index_validation/jiucaishuo-index-valuation-research.md。

能力：指数 PE/PB/股息率 10 年日频 + 收盘价 + 分位带，覆盖中港美 286 指数，无需 token。
股息率口径与韭圈儿网页一致（对齐大众认知，区别于 lixinger 的市值加权偏低值）。

签名：把请求参数补 type/version/authtoken/act_time，按 key 排序拼接非空非对象值，
追加固定 key 后 MD5，再把 MD5 切片填进一堆混淆字段（见 SIGN_SLICES）。
"""

import hashlib
import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

HOST = "https://api.jiucaishuo.com"
VERSION = "2.2.7"
SIGN_KEY = "EWf45rlv#kfsr@k#gfksgkr"
CST = timezone(timedelta(hours=8))  # funddb 时间戳是北京时间午夜

# MD5 切片 → 混淆字段（复刻前端逻辑；key/切片位置由前端 JS 决定，变了需重新逆向）。
SIGN_SLICES = {
    "u54rg5d": (2, 2), "bioduytlw": (5, 1), "bd24y6421f": (24, 2), "ngd4yut78": (12, 2),
    "iogojti": (25, 1), "h67456y": (16, 3), "tbvdiuytk": (16, 1), "yi854tew": (29, 2),
    "nkjhrew": (26, 1), "bvytikwqjk": (6, 2), "tiklsktr4": (1, 1), "abiokytke": (21, 2),
    "tirgkjfs": (0, 2), "nbf4uj7y432": (21, 2), "ibvytiqjek": (14, 2), "h13ey474": (29, 3),
    "nd354uy4752": (30, 1), "bgiuytkw": (9, 2), "quikgdky": (27, 2), "ngd4uy551": (17, 2),
    "n3bf4uj7y7": (18, 1), "bgd7h8tyu54": (6, 2), "ghtoiutkmlg": (11, 3), "bd4uy742": (26, 1),
    "lksytkjh": (17, 4), "sbnoywr": (23, 2), "kf54ge7": (31, 1), "hy5641d321t": (25, 2),
    "yt447e13f": (8, 1), "y654b5fs3tr": (11, 1), "fjlkatj": (2, 3), "jnhf8u5231": (9, 2),
}

# funddb 历史曲线 series 名 → 我方字段
_SERIES_NAME = {"pe": "市盈率", "pb": "市净率", "xilv": "股息率"}


def _sign(data):
    data = dict(data)
    data["type"] = "pc"
    data["version"] = VERSION
    data.setdefault("authtoken", "")
    data["act_time"] = int(time.time() * 1000)
    raw = ""
    for key in sorted(data):
        value = data[key]
        if (not value and value != 0) or isinstance(value, (dict, list)):
            continue
        raw += str(value)
    md5 = hashlib.md5((raw + SIGN_KEY).encode()).hexdigest()
    for key, (start, length) in SIGN_SLICES.items():
        data[key] = md5[start:start + length]
    return data


def post(path, data=None, timeout=30, retries=3):
    """POST 一个 funddb 接口（表单编码 + 签名），返回解析后的 dict。带简单重试。"""
    last_err = None
    for attempt in range(retries):
        try:
            body = urllib.parse.urlencode(_sign(data or {})).encode()
            req = urllib.request.Request(
                HOST + path, data=body,
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
                },
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"funddb {path} 请求失败: {last_err}")


def _ms_to_date(ms):
    # funddb 时间戳是北京时间午夜的毫秒数；按 +8 时区取日历日，避免偏一天。
    return datetime.fromtimestamp(ms / 1000, CST).strftime("%Y-%m-%d")


def fetch_gu_code_map():
    """showcategory → {去后缀的基础代码: 完整 gu_code}。
    例如 000300.SH→{'000300':'000300.SH'}、HSI.HI→{'HSI':'HSI.HI'}、NDX.GI→{'NDX':'NDX.GI'}。"""
    r = post("/v2/guzhi/showcategory", {"category_id": "-1"})
    rows = (r.get("data") or {}).get("right_list") or []
    out = {}
    for x in rows:
        gu = str(x.get("gu_code", ""))
        if "." in gu:
            out.setdefault(gu.split(".")[0], gu)
    return out


def fetch_valuation(gu_code, years=10):
    """拉单指数 PE/PB/股息率 10 年日频。返回 {dates,[pe],[pb],[dy]}（按日期升序、对齐）。
    收盘价 funddb 也给（"收盘价(点击隐藏)"），但本项目点位另有官方多源，这里不取。"""
    by_date = {}
    got = set()
    for cat, field in (("pe", "pe"), ("pb", "pb"), ("xilv", "dy")):
        r = post("/v2/guzhi/newtubiaolinedata",
                 {"gu_code": gu_code, "pe_category": cat, "year": str(years), "ver": "new"})
        series = ((r.get("data") or {}).get("tubiao") or {}).get("series") or []
        target = next((s for s in series if s.get("name") == _SERIES_NAME[cat]), None)
        if not target:
            continue
        for point in target.get("data") or []:
            try:
                ms, val = point[0], point[1]
            except (TypeError, IndexError):
                continue
            if val is None:
                continue
            try:
                fval = float(val)
            except (TypeError, ValueError):
                continue
            if fval != fval:  # NaN
                continue
            by_date.setdefault(_ms_to_date(ms), {})[field] = fval
        got.add(field)
        time.sleep(0.3)
    if not by_date:
        return None
    dates = sorted(by_date)
    out = {"dates": dates}
    for field in ("pe", "pb", "dy"):
        if field in got:
            out[field] = [by_date[d].get(field) for d in dates]
    return out


if __name__ == "__main__":
    import sys
    code = sys.argv[1] if len(sys.argv) > 1 else "000300.SH"
    v = fetch_valuation(code)
    if not v:
        print("无数据"); sys.exit(1)
    print(f"{code}: {len(v['dates'])} 天  {v['dates'][0]} → {v['dates'][-1]}")
    for f in ("pe", "pb", "dy"):
        if f in v:
            nn = [x for x in v[f] if x is not None]
            print(f"  {f}: 末值 {v[f][-1]}  范围[{min(nn):.3f},{max(nn):.3f}]  空 {v[f].count(None)}")
