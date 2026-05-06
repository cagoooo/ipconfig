// LINE Messaging API 狀態變化推播
// - 由 GitHub Actions 在 status.json 有 push 時觸發
// - 比對「上一個 commit 的 status.json」與「現在的 status.json」
// - 只在「ok 狀態翻轉」時推播（綠→紅 或 紅→綠），單純延遲變化不推
// - 推到指定 user / group / room（看你給哪個 ID）
//
// 必要環境變數：
//   LINE_CHANNEL_ACCESS_TOKEN  — LINE Developers → Messaging API channel 取得
//   LINE_TARGET_ID             — 接收訊息的 userId / groupId / roomId
//
// 注意：LINE Notify 已於 2025-04 停止服務，必須改用 Messaging API（本腳本）

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const targetId = process.env.LINE_TARGET_ID;

if (!token || !targetId) {
  console.log('⏭ LINE_CHANNEL_ACCESS_TOKEN 或 LINE_TARGET_ID 未設定，跳過推播');
  process.exit(0);
}

// 讀取上一個 commit 的 status.json
let prevStatus = null;
try {
  const prevJson = execSync('git show HEAD~1:status.json', { encoding: 'utf8' });
  prevStatus = JSON.parse(prevJson);
} catch {
  console.log('⏭ 上一個 commit 沒有 status.json（首次執行），跳過');
  process.exit(0);
}

const curStatus = JSON.parse(readFileSync('status.json', 'utf8'));

// 計算狀態翻轉
const prevMap = new Map();
prevStatus.results?.forEach((r) => prevMap.set(`${r.groupName}::${r.name}`, r));

const newDown = [];   // 上次 ok，這次 fail
const recovered = []; // 上次 fail，這次 ok

for (const cur of curStatus.results || []) {
  const key = `${cur.groupName}::${cur.name}`;
  const prev = prevMap.get(key);
  if (!prev) continue;
  if (prev.ok && !cur.ok) newDown.push(cur);
  if (!prev.ok && cur.ok) recovered.push(cur);
}

if (newDown.length === 0 && recovered.length === 0) {
  console.log('✓ 無狀態翻轉，不推播');
  process.exit(0);
}

// 組訊息
const lines = [];
lines.push('📡 石門國小網路狀態變化');
lines.push(`時間：${curStatus.timeLabel || curStatus.timestamp}`);

if (newDown.length > 0) {
  lines.push('');
  lines.push(`🚨 新增異常（${newDown.length}）：`);
  newDown.forEach((t) => {
    const lossInfo = t.lossPercent ? ` (丟包 ${t.lossPercent}%)` : '';
    lines.push(`　• [${t.groupName}] ${t.name}${lossInfo}`);
  });
}

if (recovered.length > 0) {
  lines.push('');
  lines.push(`✅ 已恢復（${recovered.length}）：`);
  recovered.forEach((t) => {
    const msInfo = t.avgMs !== null && t.avgMs !== undefined ? ` (${t.avgMs}ms)` : '';
    lines.push(`　• [${t.groupName}] ${t.name}${msInfo}`);
  });
}

lines.push('');
lines.push('🔗 https://cagoooo.github.io/ipconfig/');

const message = lines.join('\n');
console.log('準備推播：\n' + message + '\n');

// 推播
const resp = await fetch('https://api.line.me/v2/bot/message/push', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  },
  body: JSON.stringify({
    to: targetId,
    messages: [{ type: 'text', text: message }]
  })
});

if (!resp.ok) {
  const err = await resp.text();
  console.error(`❌ LINE API 錯誤 ${resp.status}: ${err}`);
  process.exit(1);
}

console.log('✓ LINE 推播已送出');
