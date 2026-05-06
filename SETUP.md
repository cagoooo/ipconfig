# 🛠️ 完整部署指南

本系統有兩部分：
- **必要**：校內 Windows 主機跑採集（Section 1）+ GitHub Pages 啟用（Section 2）
- **選用**：開啟 AI 日報與 LINE 推播（Section 3）

---

## 📦 Section 1：校內 Windows 主機部署

### 1.1 前置條件

開 PowerShell 確認三個工具都有：

```powershell
git --version    # https://git-scm.com/
gh --version     # https://cli.github.com/
$PSVersionTable.PSVersion  # PowerShell 5.1+ 即可（Windows 內建）
```

### 1.2 Clone repo

```powershell
cd C:\
git clone https://github.com/cagoooo/ipconfig.git
cd C:\ipconfig
```

### 1.3 設定 git 認證

```powershell
git config user.name "School Network Monitor"
git config user.email "ipad@mail2.smes.tyc.edu.tw"

gh auth login
# 選 GitHub.com → HTTPS → Y(authenticate Git) → Login with browser
```

### 1.4 編輯 targets.json

填入校內真實的 IP 與目標：

```json
{
  "groups": [
    {
      "name": "LAN",
      "label": "🏫 校內設備",
      "targets": [
        { "name": "校內閘道", "host": "192.168.1.1", "type": "ping" },
        { "name": "印表伺服器", "host": "192.168.1.50", "type": "ping" }
      ]
    }
  ]
}
```

### 1.5 手動跑一次測試

```powershell
cd C:\ipconfig
powershell -ExecutionPolicy Bypass -File .\monitor.ps1
```

預期看到：
- ✅ Console 印出每個目標檢測進度
- ✅ 產生 `status.json`、`history.json`、`daily.json`、`monitor.log`
- ✅ 自動 commit + push（log 最後一行「已 push 到 GitHub」）

### 1.6 設定 Windows 工作排程器（每 5 分鐘）

#### 方法 A：PowerShell 一鍵建立（推薦）

開「**系統管理員 PowerShell**」貼下列指令：

```powershell
$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File C:\ipconfig\monitor.ps1" `
  -WorkingDirectory "C:\ipconfig"

$trigger = New-ScheduledTaskTrigger `
  -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 5)

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 4)

$principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType S4U `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName "School Network Monitor" `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "每 5 分鐘檢測校內外網路狀態並 push 到 GitHub Pages"
```

#### 方法 B：GUI

1. 工作排程器 → 建立工作（不是建立基本工作）
2. 一般：勾「不論使用者登入與否均執行」
3. 觸發程序 → 新增 → 一次 → 立即 → 進階：重複工作每隔 **5 分鐘**、無限期
4. 動作 → 新增 → 啟動程式 → 程式 `powershell.exe`、引數 `-NoProfile -ExecutionPolicy Bypass -File C:\ipconfig\monitor.ps1`、開始位置 `C:\ipconfig`
5. 設定 → 勾「儘速啟動已錯過排程的工作」、停止逾時 4 分鐘

### 1.7 確認排程運作

```powershell
Get-ScheduledTask -TaskName "School Network Monitor" | Get-ScheduledTaskInfo
Get-Content C:\ipconfig\monitor.log -Tail 30
```

---

## 🌐 Section 2：GitHub Pages 啟用

repo push 上去後，啟用 Pages：

```powershell
gh api -X POST repos/cagoooo/ipconfig/pages -f "source[branch]=main" -f "source[path]=/"
```

或在網頁 <https://github.com/cagoooo/ipconfig/settings/pages>：Source = `Deploy from a branch`，Branch = `main` + `/ (root)` → Save。

等 1–2 分鐘後 <https://cagoooo.github.io/ipconfig/> 即可開啟。

---

## 🤖 Section 3：選用功能（AI 日報 + LINE 推播）

兩個功能完全獨立，可單獨啟用。**不開也完全不影響核心監控**。

### 3.1 取得 Gemini API Key（給 AI 日報用）

1. 到 <https://aistudio.google.com/apikey>
2. 用 `ipad@mail2.smes.tyc.edu.tw` 登入
3. **Create API key** → 選任一 Google Cloud 專案（沒有就會自動建一個）
4. 複製產生的 key（`AIzaSy...` 開頭，39 字元）

> 💰 **完全免費**：Gemini 有免費層，每天有 1,500 次 `gemini-2.5-flash` 請求額度。日報每天只用 1 次，遠遠用不完。

### 3.2 設定 LINE Messaging API（給狀態翻轉推播用）

#### 3.2.1 建立 LINE Bot

1. 到 <https://developers.line.biz/console/> 登入
2. **Create new provider**（如果沒有的話）→ 隨便取個名字
3. 在 provider 內 → **Create a Messaging API channel**
4. 填基本資料（channel name 建議寫「石門國小網路告警」）
5. 建立後進入該 channel 設定

#### 3.2.2 取得 Channel Access Token

1. 在 channel 設定頁 → **Messaging API** 分頁
2. 滾到下方 **Channel access token (long-lived)** → **Issue**
3. 複製產生的 token

#### 3.2.3 取得接收訊息的 Target ID

最簡單的方式 — **「自己加 bot 為好友後，從 webhook log 抓 userId」**：

1. Messaging API 分頁找到 **QR code**，用手機 LINE 掃描加 bot 為好友
2. 在 **Webhook URL** 暫時填一個臨時 webhook 服務（例如 <https://webhook.site/> 拿到的 URL）
3. 啟用 **Use webhook**
4. 用手機隨便傳一句話給 bot → 在 webhook.site 上看到 JSON，找到 `events[0].source.userId` 那串 `Uxxxx...`
5. 那串就是你的 `LINE_TARGET_ID`

> 💡 **群組推播**：把 bot 拉進 LINE 群組 → 群組裡傳訊息 → webhook 會收到 `groupId`，當作 target ID 即可。
> ⚠️ **不要重用 LINE Notify 的 token**，那已經停止服務（2025-04），用了會 401。

### 3.3 把三個 Secret 加進 GitHub repo

到 <https://github.com/cagoooo/ipconfig/settings/secrets/actions> 點 **New repository secret**，依序加：

| Name | Value |
|---|---|
| `GEMINI_API_KEY` | 步驟 3.1 拿到的 `AIzaSy...` |
| `LINE_CHANNEL_ACCESS_TOKEN` | 步驟 3.2.2 拿到的 token |
| `LINE_TARGET_ID` | 步驟 3.2.3 拿到的 `Uxxxx...` 或 `Cxxxx...` |

或用 `gh` CLI 一行搞定：

```powershell
gh secret set GEMINI_API_KEY -b "AIzaSy..."
gh secret set LINE_CHANNEL_ACCESS_TOKEN -b "你的token"
gh secret set LINE_TARGET_ID -b "Uxxxxxxxxx"
```

### 3.4 觸發第一次測試

```powershell
# AI 日報（會用昨天的 daily.json 寫一份）
gh workflow run daily-report.yml

# LINE 推播（需要 status.json 有翻轉才會實際推；可手動翻一個目標看效果）
gh workflow run alert-line.yml

# 看執行結果
gh run list --limit 5
```

---

## 🔍 疑難排解

### Q1：`monitor.ps1` 跑了但儀表板沒更新
- `Get-Content C:\ipconfig\monitor.log -Tail 30` 看最後幾行
- 確認 `gh auth status` 還有效，否則 `gh auth login` 重新認證
- 確認排程的 **Working Directory** 是 `C:\ipconfig`（GUI 設定常見漏設）

### Q2：GitHub Actions 跑失敗
- <https://github.com/cagoooo/ipconfig/actions> 點失敗那次看 log
- 常見：Secret 名字打錯（注意大小寫）、Token 過期、權限不足

### Q3：LINE Bot 加好友後沒收到訊息
- Messaging API 預設「**自動回覆**」是開的，會吃掉所有訊息。到 channel 設定 → **Messaging API** → **Auto-reply messages** 關掉
- 確認 webhook URL 設好（如果是測試 userId 用，事後可以拿掉 webhook URL）

### Q4：commit 太多想清掉歷史
每 5 分鐘 + 每 15 分鐘 = 大量 commit。一個月後 repo 會肥。可定期：
```powershell
cd C:\ipconfig
git checkout --orphan tmp
git add -A
git commit -m "fresh start"
git branch -D main
git branch -m main
git push -f origin main
```
⚠️ 會丟掉舊 commit 歷史，評估後再做。

### Q5：想暫停某個自動化
```powershell
# 暫停校內排程
Disable-ScheduledTask -TaskName "School Network Monitor"

# 暫停 GitHub Actions（任一）
gh workflow disable external-probe.yml
gh workflow disable daily-report.yml
gh workflow disable alert-line.yml
```

### Q6：想換 Gemini 模型
到 <https://github.com/cagoooo/ipconfig/settings/variables/actions> 加一個 repo variable `GEMINI_MODEL` 值為其他模型（例如 `gemini-2.5-pro`）。

---

Made with ❤️ by 阿凱老師
