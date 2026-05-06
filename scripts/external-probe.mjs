// 外部視角探測（從 GitHub Actions runner 跑）
// - 自動跳過內網 IP（192.168/10/172.16-31）
// - 寫出 external-status.json 與 status.json 同 schema
// - 從美國 GitHub runner 看「網站 / 教育網 ISP」是否可達
//   可與校內 monitor.ps1 結果交叉比對：
//     校內紅 + 外部綠 → 校內出口問題
//     校內紅 + 外部紅 → 服務本身掛了

import { readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';

const execAsync = promisify(exec);

const isInternalIp = (host) =>
  /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.|169\.254\.)/.test(host);

async function pingTarget(host, count = 4, timeoutSec = 2) {
  if (isInternalIp(host)) return null; // skip internal

  try {
    const { stdout } = await execAsync(
      `ping -c ${count} -W ${timeoutSec} ${host}`,
      { timeout: (count * timeoutSec + 5) * 1000 }
    );
    const avgMatch = stdout.match(/= [\d.]+\/([\d.]+)\/[\d.]+\//);
    const lossMatch = stdout.match(/(\d+(?:\.\d+)?)% packet loss/);
    const avgMs = avgMatch ? parseFloat(avgMatch[1]) : null;
    const lossPercent = lossMatch ? parseFloat(lossMatch[1]) : 100;
    return { ok: avgMs !== null, avgMs, lossPercent };
  } catch {
    return { ok: false, avgMs: null, lossPercent: 100 };
  }
}

function httpTarget(url, timeoutSec = 8) {
  const fullUrl = /^https?:\/\//.test(url) ? url : `https://${url}`;
  return new Promise((resolve) => {
    const start = Date.now();
    const lib = fullUrl.startsWith('https') ? https : http;
    let settled = false;
    const finish = (val) => { if (!settled) { settled = true; resolve(val); } };

    try {
      const req = lib.request(
        fullUrl,
        { method: 'HEAD', timeout: timeoutSec * 1000, headers: { 'User-Agent': 'ipconfig-monitor/1.0' } },
        (res) => {
          const ms = Date.now() - start;
          finish({
            ok: res.statusCode >= 200 && res.statusCode < 400,
            avgMs: ms,
            lossPercent: 0,
            statusCode: res.statusCode
          });
          res.resume();
        }
      );
      req.on('error', () => finish({ ok: false, avgMs: null, lossPercent: 100 }));
      req.on('timeout', () => {
        req.destroy();
        finish({ ok: false, avgMs: null, lossPercent: 100 });
      });
      req.end();
    } catch {
      finish({ ok: false, avgMs: null, lossPercent: 100 });
    }
  });
}

async function main() {
  const config = JSON.parse(readFileSync('targets.json', 'utf8'));
  const now = new Date();
  const twTime = new Date(now.getTime() + 8 * 3600 * 1000);
  const results = [];

  for (const group of config.groups) {
    for (const target of group.targets) {
      const type = target.type || 'ping';
      let probe;
      if (type === 'ping') {
        probe = await pingTarget(target.host);
        if (probe === null) {
          console.log(`  [skip] ${target.name} (${target.host}) — internal IP`);
          continue;
        }
      } else {
        probe = await httpTarget(target.host);
      }
      console.log(`  [${probe.ok ? '✓' : '✗'}] ${target.name} (${target.host}) ${probe.avgMs ?? 'N/A'}ms`);

      results.push({
        groupName: group.name,
        groupLabel: group.label,
        name: target.name,
        host: target.host,
        type,
        ok: probe.ok,
        avgMs: probe.avgMs,
        lossPercent: probe.lossPercent
      });
    }
  }

  const isoOffset = (() => {
    const off = -now.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
    return `${sign}${pad(off / 60)}:${pad(off % 60)}`;
  })();

  const snapshot = {
    timestamp: now.toISOString().replace('Z', isoOffset === '+00:00' ? 'Z' : isoOffset),
    timeLabel: twTime.toISOString().slice(11, 19),
    source: 'github-actions-runner',
    note: '外部視角（GitHub Actions ubuntu runner）— 已排除內網 IP',
    results
  };

  writeFileSync('external-status.json', JSON.stringify(snapshot, null, 2));
  console.log(`\n✓ external-status.json updated — ${results.length} targets probed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
