# 🏠 石門國小網路狀態儀表板

> **Windows 校內主機 + GitHub Pages + GitHub Actions** 混合架構的校園網路即時監控系統。
> 從「顯示器」進化成「主動監控 + AI 日報 + LINE 告警」的資訊處戰情中樞。

🌐 **線上儀表板**：<https://cagoooo.github.io/ipconfig/>
📋 **每日日報**：<https://cagoooo.github.io/ipconfig/reports/>

---

## 🧭 架構

```
                ┌──────────────────────────────────┐
                │  校內 Windows 主機（每 5 分鐘）   │
                │   monitor.ps1                    │
                │   ├─ ping 校內 IP / 教育局 DNS    │
                │   ├─ HTTP 探測教學 / 行政平台     │
                │   ├─ 計算 7 日 SLA (daily.json)   │
                │   └─ git push                    │
                └────────────────┬─────────────────┘
                                 ▼
                ┌──────────────────────────────────┐
                │  GitHub Repo (Public, main)       │
                │  cagoooo/ipconfig                 │
                └──┬──────────────────┬─────────────┘
                   │                  │
       ┌───────────┴────┐   ┌─────────┴──────────────────────┐
       │  GitHub Pages  │   │  GitHub Actions (定時 / 觸發)   │
       │  index.html    │   │                                 │
       │  reports/      │   │  ① external-probe (每 15 分)    │
       └───────┬────────┘   │     從美國 GitHub runner 看世界  │
               │            │  ② daily-report (每天 17:00)    │
               ▼            │     Gemini AI 寫日報           │
       👨‍💻 老師 / 校長 / 主任 │  ③ alert-line (status 翻轉時)  │
                            │     LINE 推播給管理員          │
                            └─────────────────────────────────┘
```

| 採集點 | 工具 | 看得到 | 看不到 |
|---|---|---|---|
| **校內 Windows** | `monitor.ps1` (PS 5.1) | ✅ 內網 IP, 校內服務, 從校內出去看世界 | — |
| **GitHub runner（美國）** | `external-probe.mjs` | ✅ 公開外部服務 | ❌ 內網 IP（已 skip）, 部分台灣政府 geo-block 站 |

兩邊資料**交叉比對**：
- 校內紅 + 外部綠 → **校內出口問題**（教育網 / 對外閘道）
- 校內綠 + 外部紅 → **服務本身有問題或 geo-block**
- 雙方都紅 → 服務真的掛了

---

## 📁 專案結構

| 檔案 | 用途 | 由誰維護 |
|---|---|---|
| `targets.json` | 監控目標設定（分組、IP、HTTP URL、閾值） | 人工編輯 |
| `monitor.ps1` | 校內 Windows 採集腳本 | 校內主機跑 |
| `index.html` | 儀表板（GitHub Pages） | 靜態檔 |
| `status.json` | 校內最新檢測結果 + 7 日 SLA | `monitor.ps1` |
| `history.json` | 校內最近 288 次（≈24 小時） | `monitor.ps1` |
| `daily.json` | 每日累積桶（30 日，算 SLA 用） | `monitor.ps1` |
| `external-status.json` | 外部視角最新檢測 | GitHub Actions |
| `reports/YYYY-MM-DD.html` | AI 自動生成的每日日報 | GitHub Actions |
| `reports/index.html` | 所有日報目錄 | GitHub Actions |
| `scripts/external-probe.mjs` | 外部視角探測腳本（Node.js） | — |
| `scripts/daily-report.mjs` | Gemini 日報生成腳本（Node.js） | — |
| `scripts/alert-line.mjs` | LINE 推播腳本（Node.js） | — |
| `.github/workflows/*.yml` | 三個自動化工作流 | — |
| `monitor.log` | 本機執行日誌 | 不上傳 |

---

## ⚙️ 設定 / 部署

詳見 [SETUP.md](SETUP.md)，分三大塊：

1. **校內 Windows 主機部署（必要）** — clone、git 認證、手動測試、Task Scheduler
2. **GitHub Pages 啟用（必要）** — 一行 `gh` 指令搞定
3. **GitHub Secrets 設定（選用）** — 開啟 AI 日報 + LINE 推播
   - `GEMINI_API_KEY` → 解鎖每日 AI 日報
   - `LINE_CHANNEL_ACCESS_TOKEN` + `LINE_TARGET_ID` → 解鎖狀態翻轉推播

---

## 🚀 自動化排程

| 工作 | 觸發時機 | 工具 |
|---|---|---|
| 校內檢測 | 每 5 分鐘 | Windows 工作排程器 → `monitor.ps1` |
| 外部視角 | 每 15 分鐘 | GitHub Actions cron |
| AI 日報 | 每天 17:00 (Asia/Taipei) | GitHub Actions cron |
| LINE 推播 | `status.json` 翻轉時 | GitHub Actions push trigger |

---

## ✨ 功能特色

- 🟢🟡🔴 **紅黃綠球儀表板** — 校長一眼看全校網路狀況
- 📈 **Chart.js 折線圖** — 24 小時延遲趨勢，分群組切換
- 🌙 **暗黑模式** — 戰情室電視長期顯示不刺眼，記住偏好
- ⚠️ **異常徽章** — 標題列即時顯示異常數量，瀏覽器 tab 也帶數字
- 📊 **7 日可用率 SLA** — 每張卡片顯示「7日可用率 99.85%」
- 🌐 **雙視角驗證** — 校內 + 外部 GitHub runner 同時監控，自動偵測衝突
- 🤖 **Gemini AI 日報** — 每天 17:00 自動寫一段給校長看的人話摘要
- 📱 **LINE 即時推播** — 狀態翻轉時管理員 LINE 立刻收到（綠→紅 / 紅→綠）
- 🛡️ **TCP probe fallback** — GitHub runner 不允許 ICMP 時自動改 TCP 連線探測

---

## 🛡️ 注意事項

- 此 repo 為 **PUBLIC**，`targets.json` / `status.json` 等內容會公開可見
- 若有不想公開的內網位址，請改用代號（如 `NAS01`）
- LINE Notify 已於 2025-04 停止服務，本系統使用 **LINE Messaging API**

---

Made with ❤️ by 阿凱老師
