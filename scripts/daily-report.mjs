// 每日網路日報生成腳本（GitHub Actions 跑）
// - 讀 daily.json 取得昨日（UTC+8）每個目標的可用率與平均延遲
// - 餵給 Gemini API 寫一段給校長 / 主任看的人話摘要
// - 輸出 reports/YYYY-MM-DD.html（單檔 HTML，可直接在 GitHub Pages 開）
// - 更新 reports/index.html 列出所有日報
//
// 必要環境變數：
//   GEMINI_API_KEY  — Google AI Studio 取得（免費層）
//   GEMINI_MODEL    — 可選，預設 gemini-2.5-flash

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('❌ GEMINI_API_KEY 未設定，請到 GitHub repo Settings → Secrets 加入');
  process.exit(1);
}
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

// ----- 讀資料 -----
if (!existsSync('daily.json')) {
  console.error('找不到 daily.json — 校內 monitor.ps1 還沒跑過嗎？');
  process.exit(0);
}
const daily = JSON.parse(readFileSync('daily.json', 'utf8'));
const config = JSON.parse(readFileSync('targets.json', 'utf8'));

// 計算「昨日」(UTC+8)
const tw = new Date(Date.now() + 8 * 3600 * 1000);
const yesterdayTw = new Date(tw.getTime() - 24 * 3600 * 1000);
const yKey = yesterdayTw.toISOString().slice(0, 10);

const yesterdayBucket = daily.days?.[yKey];
if (!yesterdayBucket || Object.keys(yesterdayBucket).length === 0) {
  console.log(`昨日 (${yKey}) 沒有監控資料，跳過日報生成`);
  process.exit(0);
}

// ----- 整理統計 -----
const stats = Object.entries(yesterdayBucket).map(([key, s]) => {
  const [groupName, name] = key.split('::');
  const uptime = s.sent > 0 ? (s.received / s.sent) * 100 : 0;
  const avgMs = s.received > 0 ? s.msSum / s.received : null;
  return { groupName, name, uptime, avgMs, sent: s.sent, received: s.received };
});

const overallSent = stats.reduce((sum, s) => sum + s.sent, 0);
const overallReceived = stats.reduce((sum, s) => sum + s.received, 0);
const overallUptime = overallSent > 0 ? (overallReceived / overallSent) * 100 : 0;
const problemTargets = stats.filter((s) => s.uptime < 99);

// ----- 餵給 Gemini -----
const summary = stats
  .map((s) => `- [${s.groupName}] ${s.name}: 可用率 ${s.uptime.toFixed(2)}% / 平均延遲 ${s.avgMs !== null ? s.avgMs.toFixed(1) + 'ms' : '無回應'} / 探測 ${s.sent} 次`)
  .join('\n');

const prompt = `你是一位資訊處的網路管理員，閱讀下面這份「石門國小校園網路 ${yKey} (UTC+8) 監控資料」，寫一份給校長和主任看的日報摘要。

要求：
1. 用繁體中文，適合非技術背景的主管閱讀
2. 開頭一句「整體狀況」（例如「昨日校園網路整體穩定」、「昨日有部分時段不穩」）
3. 然後條列「需要注意的事項」 — 如果有任何目標可用率低於 99%、平均延遲特別高、或完全不通的，列出來；都正常就明確寫「無重大異常」
4. 最後給一句「建議」 — 例如某條線需要繼續觀察、或某服務穩定可放心
5. 不要太冗長，250 字以內，不要加 markdown 標題語法 (#)，純段落即可
6. 「教學平台」延遲較高（200ms 以上）是正常現象，因為要繞到國外，不需特別警告

監控資料：
${summary}
`;

console.log(`呼叫 Gemini ${model}...`);
const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
const resp = await fetch(apiUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 1024 }
  })
});

if (!resp.ok) {
  const err = await resp.text();
  console.error(`Gemini API error ${resp.status}:\n${err}`);
  process.exit(1);
}

const result = await resp.json();
const aiText = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '(AI 回應為空)';
console.log('✓ Gemini 回應:\n' + aiText);

// ----- 產生 HTML 日報 -----
const reportHtml = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${yKey} · ${escapeHtml(config.title || '網路狀態')} · 日報</title>
<style>
body { font-family: "Segoe UI", "Microsoft JhengHei", "PingFang TC", sans-serif; max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; color: #4a3f2f; line-height: 1.7; background: #f7f1e8; }
h1 { font-size: 24px; margin: 0 0 4px; }
.gen-meta { color: #8a7c66; font-size: 12.5px; margin-bottom: 24px; }
.ai-summary { background: #fffdf8; padding: 20px 24px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); margin: 16px 0 28px; border-left: 4px solid #c97a3e; }
.ai-summary h2 { font-size: 15px; margin: 0 0 12px; color: #c97a3e; }
.ai-summary p { margin: 8px 0; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; background: #fffdf8; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05); font-size: 14px; }
th, td { padding: 10px 14px; border-bottom: 1px solid #ece2cf; text-align: left; }
th { background: #efe6d3; font-weight: 600; }
.ok { color: #5cb85c; font-weight: 600; }
.warn { color: #f0ad4e; font-weight: 600; }
.bad { color: #d9534f; font-weight: 600; }
.kpi-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
.kpi { flex: 1; min-width: 140px; background: #fffdf8; padding: 12px 16px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); border: 1px solid #ece2cf; }
.kpi .label { font-size: 12px; color: #8a7c66; }
.kpi .value { font-size: 22px; font-weight: 600; color: #4a3f2f; }
footer { margin-top: 40px; text-align: center; color: #8a7c66; font-size: 13px; padding-top: 18px; border-top: 2px dashed #ece2cf; }
footer a { color: #c97a3e; text-decoration: none; font-weight: 600; }
footer a:hover { text-decoration: underline; }
</style>
</head>
<body>
<h1>📋 ${yKey} 校園網路日報</h1>
<div class="gen-meta">由 Gemini ${escapeHtml(model)} 自動生成 · ${escapeHtml(new Date().toISOString())} · 涵蓋 UTC+8 0:00 ~ 23:59</div>

<div class="kpi-row">
  <div class="kpi"><div class="label">整體可用率</div><div class="value ${overallUptime >= 99 ? 'ok' : overallUptime >= 95 ? 'warn' : 'bad'}">${overallUptime.toFixed(2)}%</div></div>
  <div class="kpi"><div class="label">監控目標數</div><div class="value">${stats.length}</div></div>
  <div class="kpi"><div class="label">異常目標數</div><div class="value ${problemTargets.length === 0 ? 'ok' : 'warn'}">${problemTargets.length}</div></div>
  <div class="kpi"><div class="label">總探測次數</div><div class="value">${overallSent.toLocaleString()}</div></div>
</div>

<div class="ai-summary">
<h2>🤖 AI 摘要</h2>
${aiText.split(/\n+/).map((p) => (p.trim() ? `<p>${escapeHtml(p)}</p>` : '')).join('')}
</div>

<h2 style="font-size:16px;margin:24px 0 8px;">📊 各目標詳細統計</h2>
<table>
<thead><tr><th>群組</th><th>目標</th><th>可用率</th><th>平均延遲</th><th>探測次數</th></tr></thead>
<tbody>
${stats
  .sort((a, b) => a.uptime - b.uptime)
  .map((s) => {
    const cls = s.uptime >= 99 ? 'ok' : s.uptime >= 95 ? 'warn' : 'bad';
    return `<tr>
      <td>${escapeHtml(s.groupName)}</td>
      <td>${escapeHtml(s.name)}</td>
      <td class="${cls}">${s.uptime.toFixed(2)}%</td>
      <td>${s.avgMs !== null ? s.avgMs.toFixed(1) + ' ms' : '—'}</td>
      <td>${s.sent}</td>
    </tr>`;
  })
  .join('')}
</tbody>
</table>

<footer>
  <a href="../">← 回儀表板</a> · <a href="./">所有日報</a> · Made with ❤️ by 阿凱老師
</footer>
</body>
</html>`;

if (!existsSync('reports')) mkdirSync('reports', { recursive: true });
writeFileSync(`reports/${yKey}.html`, reportHtml);
console.log(`✓ 寫入 reports/${yKey}.html`);

// ----- 更新 reports/index.html（列出全部日報） -----
const reportFiles = readdirSync('reports')
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f))
  .sort()
  .reverse();

const indexHtml = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>所有日報 · ${escapeHtml(config.title || '網路狀態')}</title>
<style>
body { font-family: "Segoe UI", "Microsoft JhengHei", sans-serif; max-width: 700px; margin: 0 auto; padding: 32px 20px; color: #4a3f2f; background: #f7f1e8; }
h1 { font-size: 24px; }
ul { list-style: none; padding: 0; }
li { background: #fffdf8; margin: 8px 0; padding: 14px 18px; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); border: 1px solid #ece2cf; }
li a { color: #c97a3e; text-decoration: none; font-weight: 600; }
li a:hover { text-decoration: underline; }
footer { margin-top: 40px; text-align: center; color: #8a7c66; font-size: 13px; padding-top: 18px; border-top: 2px dashed #ece2cf; }
footer a { color: #c97a3e; text-decoration: none; font-weight: 600; }
</style>
</head>
<body>
<h1>📚 所有日報</h1>
<p style="color:#8a7c66;">每天 17:00 由 Gemini AI 自動生成 · 共 ${reportFiles.length} 份</p>
<ul>
${reportFiles.map((f) => `<li>📋 <a href="${f}">${f.replace('.html', '')}</a></li>`).join('\n')}
</ul>
<footer><a href="../">← 回儀表板</a> · Made with ❤️ by 阿凱老師</footer>
</body>
</html>`;

writeFileSync('reports/index.html', indexHtml);
console.log(`✓ 更新 reports/index.html（共 ${reportFiles.length} 份日報）`);
