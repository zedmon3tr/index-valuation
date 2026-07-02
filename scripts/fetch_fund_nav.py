#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
拉取 funds.json 里每只基金(ETF)的当前净值，生成 data/funds_nav.json 快照。

为何单独成脚本：ETF 自身无 PE/PB（估值借跟踪指数，见 build_data.py / CLAUDE.md），
净值是基金特有的每日数据，独立成一个轻量快照文件，不混入手维护的 funds.json。

数据源：东方财富天天基金 fundgz 接口（纯 stdlib urllib，无需 akshare）。
  https://fundgz.1234567.com.cn/js/<code>.js  →  jsonpgz({...})
  字段：dwjz=单位净值(官方,EOD)、jzrq=净值日期、gsz=盘中估值、gszzl=估值涨跌%、gztime=估值时间。
缺 dwjz 时回退 f10/lsjz 历史净值接口取最近一条。

净值按要求保留到小数点后 3 位（nav）；原始值留 navRaw 备查。
"""
import json
import os
import re
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FUNDS = os.path.join(ROOT, "funds.json")
OUT = os.path.join(ROOT, "data", "funds_nav.json")

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
GZ_URL = "https://fundgz.1234567.com.cn/js/{code}.js"
LSJZ_URL = ("https://api.fund.eastmoney.com/f10/lsjz"
            "?fundCode={code}&pageIndex=1&pageSize=1")


def _get(url, referer=None, timeout=10, retries=3):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    if referer:
        req.add_header("Referer", referer)
    last = None
    for attempt in range(retries):  # 东财偶发 SSL 握手超时；重试避免单次抖动丢整只基金
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            last = e
            if attempt < retries - 1:
                time.sleep(0.5 * (attempt + 1))
    raise last


def _round3(x):
    try:
        return round(float(x), 3)
    except (TypeError, ValueError):
        return None


def fetch_gz(code):
    """fundgz：返回 (dwjz, jzrq, gsz, gszzl, gztime, name) 或 None。"""
    raw = _get(GZ_URL.format(code=code))
    m = re.search(r"jsonpgz\((\{.*\})\)", raw)
    if not m:
        return None
    d = json.loads(m.group(1))
    return (d.get("dwjz"), d.get("jzrq"), d.get("gsz"),
            d.get("gszzl"), d.get("gztime"), d.get("name"))


def fetch_lsjz(code):
    """f10 历史净值兜底：返回 (dwjz, jzrq) 或 (None, None)。"""
    raw = _get(LSJZ_URL.format(code=code), referer="https://fundf10.eastmoney.com/")
    d = json.loads(raw)
    rows = (d.get("Data") or {}).get("LSJZList") or []
    if not rows:
        return None, None
    return rows[0].get("DWJZ"), rows[0].get("FSRQ")


HIST_OUT = os.path.join(ROOT, "data", "funds_nav_hist.json")
LSJZ_PAGE_URL = ("https://api.fund.eastmoney.com/f10/lsjz"
                 "?fundCode={code}&pageIndex={page}&pageSize=20")
HIST_YEARS = 3   # 近 ~3 年日频单位净值，足够算年化跟踪误差并留窗口余量
_LSJZ_PAGE_SIZE = 20  # 东财 f10-lsjz 实际每页上限（pageSize 参数无效，固定返回 20 条）


def fetch_lsjz_history(code, years=HIST_YEARS):
    """f10 历史净值分页拉取近 years 年单位净值。返回 (navDates 升序, nav 浮点) 或 ([], [])。"""
    import datetime
    cutoff = (datetime.date.today() - datetime.timedelta(days=years * 365)).isoformat()
    dates, navs = [], []
    for page in range(1, 200):  # 20/页 × 200 = 4000 交易日上限，封顶防失控
        raw = _get(LSJZ_PAGE_URL.format(code=code, page=page),
                   referer="https://fundf10.eastmoney.com/")
        rows = (json.loads(raw).get("Data") or {}).get("LSJZList") or []
        if not rows:
            break
        stop = False
        for r in rows:
            fsrq, dwjz = r.get("FSRQ"), r.get("DWJZ")
            if not fsrq or fsrq < cutoff:
                stop = True
                continue
            try:
                navs.append(float(dwjz)); dates.append(fsrq)
            except (TypeError, ValueError):
                pass
        if stop or len(rows) < _LSJZ_PAGE_SIZE:
            break
        time.sleep(0.2)
    order = sorted(range(len(dates)), key=lambda i: dates[i])  # 接口降序 → 升序
    return [dates[i] for i in order], [navs[i] for i in order]


def main():
    funds = json.load(open(FUNDS, encoding="utf-8"))
    out = []
    ok = miss = 0
    for f in funds:
        code = f["code"]
        rec = {
            "code": code,
            "name": f.get("name"),
            "secid": f.get("secid"),
            "trackIndex": f.get("trackIndex"),
            "nav": None, "navRaw": None, "navDate": None,
            "estimate": None, "estimateChangePct": None, "estimateTime": None,
            "source": None,
        }
        try:
            gz = fetch_gz(code)
            if gz and gz[0]:
                dwjz, jzrq, gsz, gszzl, gztime, _name = gz
                rec.update(nav=_round3(dwjz), navRaw=dwjz, navDate=jzrq,
                           estimate=_round3(gsz), estimateChangePct=gszzl,
                           estimateTime=gztime, source="eastmoney:fundgz")
            else:
                dwjz, jzrq = fetch_lsjz(code)
                if dwjz:
                    rec.update(nav=_round3(dwjz), navRaw=dwjz, navDate=jzrq,
                               source="eastmoney:lsjz")
        except Exception as e:  # noqa: BLE001
            rec["source"] = f"ERROR: {type(e).__name__}: {e}"

        if rec["nav"] is not None:
            ok += 1
            print(f"  {code} {rec['name']:22} 净值 {rec['nav']:.3f} @{rec['navDate']}"
                  + (f"  估值 {rec['estimate']:.3f} ({rec['estimateChangePct']}%)"
                     if rec["estimate"] is not None else ""))
        else:
            miss += 1
            print(f"  {code} {rec['name']:22} ✗ 取净值失败：{rec['source']}")
        out.append(rec)
        time.sleep(0.25)

    payload = {
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
        "source": "东方财富天天基金 fundgz / f10-lsjz",
        "note": "nav=单位净值(3位小数)；estimate=盘中实时估值；navDate=官方净值日期",
        "count": len(out),
        "funds": out,
    }
    # 整体全失败时不覆盖既有文件（沿用历史净值写入的"失败不写空"原则，避免接口临时挂掉
    # 时用全 null 的快照覆盖掉昨天还可用的净值，砸坏首页/详情页实时价与定投计算器默认值）。
    if ok > 0 or not os.path.exists(OUT):
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, "w", encoding="utf-8") as fp:
            json.dump(payload, fp, ensure_ascii=False, indent=2)
        print(f"\n写入 {OUT}：{ok} 成功 / {miss} 失败 / 共 {len(out)}")
    else:
        print(f"\n⚠ 净值全部抓取失败，保留既有 {OUT}")

    hist = []
    h_ok = h_miss = 0
    for f in funds:
        code = f["code"]
        rec = {"code": code, "name": f.get("name"), "secid": f.get("secid"),
               "trackIndex": f.get("trackIndex"), "navDates": [], "nav": []}
        try:
            d, n = fetch_lsjz_history(code)
            rec["navDates"], rec["nav"] = d, n
        except Exception as e:  # noqa: BLE001
            print(f"  {code} 历史净值抓取失败：{type(e).__name__}: {e}")
        if rec["nav"]:
            h_ok += 1
            print(f"  {code} {rec['name']:22} 历史 {len(rec['nav'])} 点 {rec['navDates'][0]}~{rec['navDates'][-1]}")
        else:
            h_miss += 1
        hist.append(rec)
        time.sleep(0.25)

    hist_payload = {
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
        "source": "东方财富天天基金 f10-lsjz",
        "note": "每只基金近 ~3 年日频单位净值，前端用于计算跟踪误差",
        "count": len(hist),
        "funds": hist,
    }
    # 整体全失败时不覆盖既有文件（沿用快照脚本"失败不写空"精神）
    if h_ok > 0 or not os.path.exists(HIST_OUT):
        with open(HIST_OUT, "w", encoding="utf-8") as fp:
            json.dump(hist_payload, fp, ensure_ascii=False, indent=2)
        print(f"写入 {HIST_OUT}：{h_ok} 成功 / {h_miss} 失败 / 共 {len(hist)}")
    else:
        print(f"⚠ 历史净值全部抓取失败，保留既有 {HIST_OUT}")


if __name__ == "__main__":
    main()
