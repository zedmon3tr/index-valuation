# 指数估值 · 行情分析

一个纯静态的 A 股 / 港股 / 美股**指数行情与历史分位分析**网页。支持搜索任意指数，查看实时点位、涨跌，以及基于历史点位序列的分位分析（危险值 / 中位值 / 机会值带）。

**无需后端、无需数据库**，部署到 GitHub Pages 即可使用。

## 功能

- 🔍 **搜索**：本地内置主流指数即时匹配 + 东方财富全网搜索（任意指数代码 / 名称）
- 📈 **实时行情**：首页卡片展示主流指数最新点位与涨跌幅
- 📊 **分位分析**：详情页按 1 / 3 / 5 / 10 年 / 全部区间计算
  - 当前点位、历史分位
  - 危险值(70%)、中位值(50%)、机会值(30%)
  - 最大 / 平均 / 最小值、标准差、z 分数
  - 当前 PE / PB（实时快照）
- 📉 ECharts 交互图表，带分位参考线与区间缩放

## 数据来源

浏览器端直接调用**东方财富**公开行情接口（通过 JSONP `cb` 回调跨域）：

- `push2.eastmoney.com` — 实时行情、快照（含当前 PE/PB）
- `push2his.eastmoney.com` — 历史日 K 线
- `searchapi.eastmoney.com` — 指数搜索

历史 **PE / PB 估值序列**由 GitHub Actions 每日运行 akshare 预生成为 `data/*.json`（见下文）。详情页可在「点位分位 / 市盈率 / 市净率」之间切换；没有估值数据的指数只显示点位分位。

## 估值数据自动更新（GitHub Actions）

本仓库含一个定时任务，每天自动用 akshare 抓取主流指数的历史 PE/PB 并提交回 `data/`：

- 脚本：`scripts/build_data.py`（抓取逻辑，可自行增减指数，见文件内 `MAP`）
- 工作流：`.github/workflows/update-data.yml`（每天约北京时间 18:00 运行，也可手动触发）

**首次启用步骤：**

1. 确保 `scripts/build_data.py` 与 `.github/workflows/update-data.yml` 已在仓库中。
2. 仓库 **Settings → Actions → General → Workflow permissions**，选 **Read and write permissions**，保存（让 Action 能把数据提交回仓库）。
3. 打开仓库 **Actions** 标签页，选左侧 **Update valuation data**，点 **Run workflow** 手动跑一次。
4. 运行成功后，`data/` 目录会出现各指数的 JSON，网页上对应指数即出现 PE/PB 切换标签。

之后无需干预，每天自动更新。

## 本地预览

```bash
# 任选其一，在本目录下起一个静态服务器
python3 -m http.server 8000
# 然后浏览器打开 http://localhost:8000
```

直接双击 `index.html` 也能打开（JSONP 不受 file:// 限制）。

## 部署到 GitHub Pages

1. 新建 GitHub 仓库，把本目录所有文件（`index.html`、`app.js`、`styles.css`、`.nojekyll`、`README.md`）推上去：

   ```bash
   git init
   git add .
   git commit -m "init: 指数估值行情分析静态站"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/<仓库名>.git
   git push -u origin main
   ```

2. 仓库 **Settings → Pages → Build and deployment**，Source 选 **Deploy from a branch**，分支选 `main` / 根目录 `/ (root)`，保存。

3. 等待 1–2 分钟，访问 `https://<你的用户名>.github.io/<仓库名>/` 即可。

`.nojekyll` 文件确保 GitHub Pages 原样发布静态文件、不走 Jekyll 处理。

## 文件结构

```
index.html   页面骨架（顶栏 + 搜索 + 容器 + 引入 ECharts）
styles.css   全部样式（简洁干净、响应式、红涨绿跌）
app.js       数据接口封装、分位统计引擎、路由与渲染
```

## 免责声明

数据来源于东方财富公开接口，仅供研究参考，不构成任何投资建议。接口由第三方维护，可能随时变动或限流。
