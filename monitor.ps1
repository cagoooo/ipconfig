# ============================================================
# 石門國小網路狀態監控腳本（Windows PowerShell）
# 用途：定時 ping/HTTP 探測 targets.json 內的目標，產生 status.json
#       與 history.json，並 git push 到 GitHub Pages
# 排程：建議用「Windows 工作排程器」每 5 分鐘執行一次
# ============================================================

$ErrorActionPreference = 'Stop'
$RepoDir       = $PSScriptRoot
$TargetsFile   = Join-Path $RepoDir 'targets.json'
$StatusFile    = Join-Path $RepoDir 'status.json'
$HistoryFile   = Join-Path $RepoDir 'history.json'
$LogFile       = Join-Path $RepoDir 'monitor.log'

function Write-Log {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $LogFile -Value $line -Encoding utf8
    Write-Host $line
}

function Write-JsonNoBom {
    param([Parameter(Mandatory = $true)]$Object, [Parameter(Mandatory = $true)][string]$Path)
    $json = $Object | ConvertTo-Json -Depth 20 -Compress:$false
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $json, $utf8NoBom)
}

# ----------------------------------------
# Ping 探測（ICMP）
# ----------------------------------------
function Test-PingTarget {
    param([string]$TargetHost, [int]$Count = 4, [int]$TimeoutMs = 1500)

    $rtts = @()
    $ping = New-Object System.Net.NetworkInformation.Ping
    for ($i = 0; $i -lt $Count; $i++) {
        try {
            $reply = $ping.Send($TargetHost, $TimeoutMs)
            if ($reply.Status -eq 'Success') {
                $rtts += [double]$reply.RoundtripTime
            }
        } catch {
            # 失敗就略過這次
        }
        Start-Sleep -Milliseconds 200
    }

    $sent = $Count
    $received = $rtts.Count
    $lossPercent = if ($sent -gt 0) { [math]::Round((($sent - $received) / $sent) * 100, 1) } else { 100 }
    $avg = if ($received -gt 0) { [math]::Round((($rtts | Measure-Object -Average).Average), 2) } else { $null }

    return @{
        ok          = ($received -gt 0)
        avgMs       = $avg
        lossPercent = $lossPercent
        sent        = $sent
        received    = $received
    }
}

# ----------------------------------------
# HTTP 探測（HEAD request 計時）
# ----------------------------------------
function Test-HttpTarget {
    param([string]$Url, [int]$TimeoutSec = 8)

    if ($Url -notmatch '^https?://') { $Url = "https://$Url" }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $oldProgress = $ProgressPreference
        $ProgressPreference = 'SilentlyContinue'
        $response = Invoke-WebRequest -Uri $Url -Method Head -TimeoutSec $TimeoutSec -UseBasicParsing -MaximumRedirection 5 -ErrorAction Stop
        $ProgressPreference = $oldProgress
        $sw.Stop()
        $code = [int]$response.StatusCode
        return @{
            ok          = ($code -ge 200 -and $code -lt 400)
            avgMs       = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
            lossPercent = 0
            statusCode  = $code
        }
    } catch {
        $sw.Stop()
        # 部分站台 HEAD 不被允許，改試 GET
        try {
            $sw2 = [System.Diagnostics.Stopwatch]::StartNew()
            $response = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec $TimeoutSec -UseBasicParsing -MaximumRedirection 5 -ErrorAction Stop
            $sw2.Stop()
            $code = [int]$response.StatusCode
            return @{
                ok          = ($code -ge 200 -and $code -lt 400)
                avgMs       = [math]::Round($sw2.Elapsed.TotalMilliseconds, 2)
                lossPercent = 0
                statusCode  = $code
            }
        } catch {
            return @{
                ok          = $false
                avgMs       = $null
                lossPercent = 100
                error       = $_.Exception.Message
            }
        }
    }
}

# ----------------------------------------
# 主流程
# ----------------------------------------
try {
    Write-Log "=== 開始檢測 ==="

    $config = Get-Content -Path $TargetsFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $now = Get-Date
    $timestamp = $now.ToString('yyyy-MM-ddTHH:mm:sszzz')
    $timeLabel = $now.ToString('HH:mm:ss')

    $resultsList = New-Object System.Collections.ArrayList

    foreach ($group in $config.groups) {
        foreach ($target in $group.targets) {
            $type = if ($target.type) { $target.type } else { 'ping' }
            Write-Log ("檢測 [{0}] {1} ({2}) - {3}" -f $group.name, $target.name, $target.host, $type)

            $probe = if ($type -eq 'http') {
                Test-HttpTarget -Url $target.host
            } else {
                Test-PingTarget -TargetHost $target.host
            }

            $entry = [ordered]@{
                groupName   = $group.name
                groupLabel  = $group.label
                name        = $target.name
                host        = $target.host
                type        = $type
                ok          = [bool]$probe.ok
                avgMs       = $probe.avgMs
                lossPercent = $probe.lossPercent
            }
            [void]$resultsList.Add($entry)
        }
    }

    $snapshot = [ordered]@{
        timestamp = $timestamp
        timeLabel = $timeLabel
        results   = @($resultsList)
    }

    # 寫入 status.json（最新狀態）
    Write-JsonNoBom -Object $snapshot -Path $StatusFile
    Write-Log "已更新 status.json"

    # 讀取/更新 history.json
    $historyLimit = if ($config.historyLimit) { [int]$config.historyLimit } else { 100 }
    $history = @()
    if (Test-Path $HistoryFile) {
        try {
            $existing = Get-Content -Path $HistoryFile -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($existing) { $history = @($existing) }
        } catch {
            Write-Log "history.json 解析失敗，重新建立"
            $history = @()
        }
    }
    $history = @($snapshot) + $history
    if ($history.Count -gt $historyLimit) {
        $history = $history[0..($historyLimit - 1)]
    }
    Write-JsonNoBom -Object $history -Path $HistoryFile
    Write-Log ("已更新 history.json（共 {0} 筆）" -f $history.Count)

    # ----------------------------------------
    # Git push
    # ----------------------------------------
    Push-Location $RepoDir
    try {
        # 暫時改回 Continue 模式，避免 native 指令 stderr 被當錯誤
        $prevPref = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'

        & git add status.json history.json | Out-Null
        $statusOutput = (& git status --porcelain) -join "`n"
        if ([string]::IsNullOrWhiteSpace($statusOutput)) {
            Write-Log "沒有檔案變更，跳過 commit"
        } else {
            $commitMsg = "monitor: $timestamp"
            & git commit -m $commitMsg --quiet
            & git push --quiet
            if ($LASTEXITCODE -eq 0) {
                Write-Log "已 push 到 GitHub"
            } else {
                Write-Log "git push 失敗（exit $LASTEXITCODE）"
            }
        }

        $ErrorActionPreference = $prevPref
    } finally {
        Pop-Location
    }

    Write-Log "=== 檢測完成 ==="
} catch {
    Write-Log ("錯誤：{0}" -f $_.Exception.Message)
    Write-Log $_.ScriptStackTrace
    exit 1
}
