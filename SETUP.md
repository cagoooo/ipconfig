# 🛠️ 校內 Windows 主機設定指南

把 `monitor.ps1` 設成每 5 分鐘自動執行 + 自動 push 到 GitHub 的完整步驟。

---

## ✅ 前置條件

請先確認校內 Windows 主機上有以下工具：

```powershell
git --version    # 應該顯示 git 版本（沒有的話下載 https://git-scm.com/）
gh --version     # GitHub CLI（下載 https://cli.github.com/）
pwsh --version   # 或 powershell.exe 即可（Windows 內建）
```

---

## 📥 第一步：clone repo 到本機

開啟 PowerShell（一般使用者即可，不必管理員）：

```powershell
# 找一個固定路徑，例如 C:\ipconfig
cd C:\
git clone https://github.com/cagoooo/ipconfig.git
cd C:\ipconfig
```

---

## 🔐 第二步：設定 git 身份 + GitHub 認證

```powershell
# 設定 commit 作者
git config user.name "School Network Monitor"
git config user.email "ipad@mail2.smes.tyc.edu.tw"

# 用 gh CLI 認證，選 HTTPS + 瀏覽器登入
gh auth login
# 認證後 gh 會自動幫 git 設定好 credential helper
```

> 💡 認證一次以後，後續 `git push` 就不會再彈視窗了。

---

## 🧪 第三步：手動跑一次確認沒問題

```powershell
cd C:\ipconfig
powershell -ExecutionPolicy Bypass -File .\monitor.ps1
```

預期看到：
- ✅ Console 印出每個目標的檢測進度
- ✅ 產生 `status.json`、`history.json`、`monitor.log`
- ✅ 自動 commit 與 push（如果有變更的話）

打開 <https://cagoooo.github.io/ipconfig/> 看儀表板有沒有資料。

---

## ⏰ 第四步：設定 Windows 工作排程器（每 5 分鐘）

### 方法 A：用 PowerShell 一鍵建立（推薦）

開「**系統管理員 PowerShell**」，貼以下指令：

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

> 用 `LogonType S4U` 代表「不論使用者有沒有登入都會跑」，但這台主機要保持開機。

### 方法 B：用 GUI 一步一步點

1. **開始** → 搜尋「**工作排程器**」→ 開啟
2. 右側「**建立工作**」（不是「建立基本工作」）
3. **一般** 分頁：
   - 名稱：`School Network Monitor`
   - 勾選「**不論使用者登入與否均執行**」
4. **觸發程序** 分頁 → **新增**：
   - 開始工作：依排程
   - 一次：今天現在
   - 進階設定：勾「**重複工作每隔 5 分鐘**」、持續時間「**無限期**」
5. **動作** 分頁 → **新增**：
   - 動作：啟動程式
   - 程式：`powershell.exe`
   - 引數：`-NoProfile -ExecutionPolicy Bypass -File C:\ipconfig\monitor.ps1`
   - 開始位置：`C:\ipconfig`
6. **設定** 分頁：
   - 勾選「**儘速啟動已錯過排程的工作**」
   - 「停止工作如果執行超過」設 `4 分鐘`
7. 確定 → 輸入帳號密碼

---

## 🔍 確認排程有在跑

```powershell
# 看下次執行時間
Get-ScheduledTask -TaskName "School Network Monitor" | Get-ScheduledTaskInfo

# 看最近 monitor.log
Get-Content C:\ipconfig\monitor.log -Tail 30
```

---

## 🐛 疑難排解

### Q1：`git push` 失敗 / 認證過期
```powershell
cd C:\ipconfig
gh auth status         # 看是否還在登入狀態
gh auth login          # 重新認證
```

### Q2：排程跑了但沒 push
- 檢查 `monitor.log` 最後幾行
- 確認排程的 `WorkingDirectory` 是 `C:\ipconfig`
- 試著手動執行一次 `monitor.ps1` 確認能 push

### Q3：commit 太多想清掉歷史
- 因為每 5 分鐘一次，repo 會累積大量 commit。如果想「壓平」歷史：
  ```powershell
  git checkout --orphan tmp
  git add -A
  git commit -m "fresh start"
  git branch -D main
  git branch -m main
  git push -f origin main
  ```
- ⚠️ 此操作會丟掉舊的 commit 歷史，請評估後再做。

### Q4：想停止排程
```powershell
Disable-ScheduledTask -TaskName "School Network Monitor"
# 或徹底刪除
Unregister-ScheduledTask -TaskName "School Network Monitor" -Confirm:$false
```

---

## 🎯 啟用 GitHub Pages（首次部署用）

repo push 上去之後，需要去 GitHub 開啟 Pages：

1. 到 <https://github.com/cagoooo/ipconfig/settings/pages>
2. **Source** 選「**Deploy from a branch**」
3. **Branch** 選 `main` + `/ (root)` → **Save**
4. 等 1–2 分鐘後 <https://cagoooo.github.io/ipconfig/> 即可開啟

或一行 `gh` CLI 搞定：

```powershell
gh api -X POST repos/cagoooo/ipconfig/pages -f "source[branch]=main" -f "source[path]=/"
```

---

Made with ❤️ by 阿凱老師
