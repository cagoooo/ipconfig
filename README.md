# 🏠 石門國小網路狀態儀表板

> **Windows 校內主機 + GitHub Pages** 混合架構的校園網路即時監控系統。
> 延續老師原本 SmokePing / Python warroom 的精神，但前台搬到 GitHub Pages 公開可分享。

🌐 **線上儀表板**：<https://cagoooo.github.io/ipconfig/>

---

## 🧭 架構

```
┌─────────────────────────┐         每 5 分鐘
│  校內 Windows 主機       │      （工作排程器）
│                         │
│  monitor.ps1            │
│   ├─ ping 校內 IP        │  ──────► status.json
│   ├─ ping 教育局 DNS     │          history.json
│   ├─ HTTP 探測教學平台   │
│   └─ git push           │              │
└─────────────────────────┘              │
                                         ▼
                          ┌───────────────────────────┐
                          │  GitHub Repo (Public)      │
                          │  cagoooo/ipconfig          │
                          └───────────────────────────┘
                                         │
                                         ▼
                          ┌───────────────────────────┐
                          │  GitHub Pages              │
                          │  index.html ← fetch JSON   │
                          └───────────────────────────┘
```

- **採集端（校內 Windows）**：跑 `monitor.ps1`，能打到內網 + 外網的所有目標
- **儲存層（GitHub Repo）**：兩個 JSON — `status.json`（最新一次）+ `history.json`（最近 100 次）
- **顯示端（GitHub Pages）**：靜態 `index.html`，瀏覽器 fetch JSON 後渲染卡片與表格

---

## 📁 專案結構

| 檔案 | 用途 |
|---|---|
| `targets.json` | 監控目標設定（分組、IP、HTTP URL、閾值） |
| `monitor.ps1` | PowerShell 採集腳本（ping + HTTP + git push） |
| `index.html` | 靜態儀表板（GitHub Pages 自動部署） |
| `status.json` | 最新一次檢測結果（`monitor.ps1` 自動產生） |
| `history.json` | 最近 N 次歷史紀錄（`monitor.ps1` 自動產生） |
| `monitor.log` | 本機執行日誌（不會 push 到 GitHub） |
| `SETUP.md` | Windows 工作排程器設定步驟 |

---

## 🚀 快速開始

1. **clone 到校內 Windows 主機**：
   ```powershell
   git clone https://github.com/cagoooo/ipconfig.git C:\ipconfig
   cd C:\ipconfig
   ```

2. **編輯 `targets.json`**，填入校內真實的 IP、DNS、教學/行政平台網址

3. **手動跑一次測試**：
   ```powershell
   pwsh -File .\monitor.ps1
   # 或
   powershell -ExecutionPolicy Bypass -File .\monitor.ps1
   ```

4. **檢查結果**：
   - 看 `monitor.log` 有沒有錯誤
   - 看 `status.json` 是否產生
   - 確認 GitHub repo 上有 commit
   - 開瀏覽器看 <https://cagoooo.github.io/ipconfig/>

5. **設定每 5 分鐘自動執行** → 詳見 [SETUP.md](SETUP.md)

---

## ⚙️ 修改監控目標

直接編輯 [`targets.json`](targets.json)：

```json
{
  "groups": [
    {
      "name": "DNS",
      "label": "🌐 DNS 服務",
      "targets": [
        { "name": "Google DNS", "host": "8.8.8.8", "type": "ping" }
      ]
    }
  ]
}
```

- `type: "ping"` → 用 ICMP ping，`host` 填 IP 或主機名
- `type: "http"` → 用 HTTP HEAD 探測，`host` 填完整 URL

閾值（`thresholds`）：
- `greenMaxMs`：低於此延遲顯示 🟢 綠色
- `yellowMaxMs`：低於此延遲顯示 🟡 黃色，再高就 🔴 紅色
- `yellowMaxLossPercent`：丟包率超過此值會降級為紅色

---

## 🛡️ 注意事項

- 此 repo 為 **PUBLIC**，`targets.json` / `status.json` / `history.json` 內的 IP 與延遲資料會公開可見
- 若有不想公開的內網位址，請改用代號（如 `NAS01`）並在校內維護的私有對照表裡查實際 IP
- `monitor.log` 與 `node_modules` 等不會被 commit（見 `.gitignore`）

---

Made with ❤️ by 阿凱老師
