// 外部視角探測（從 GitHub Actions runner 跑）
// - 自動跳過內網 IP（192.168/10/172.16-31）
// - GitHub runner 不允許 ICMP ping，所以 ping 類型改用 TCP probe
//   依序嘗試 port 443 / 80 / 53，任一通就算 alive，回傳該連線時間
// - 寫出 external-status.json 與 status.json 同 schema
//   可與校內 monitor.ps1 結果交叉比對：
//     校內紅 + 外部綠 → 校內出口問題
//     校內綠 + 外部紅 → 服務本身掛了 / 服務有 geo-block

import { readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';

const isInternalIp = (host) =>
  /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.|169\.254\.)/.test(host);

// TCP probe — 嘗試建立 TCP 連線到某 port，回傳是否成功與耗時
function tcpProbe(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      const ms = Date.now() - start;
      try { socket.destroy(); } catch {}
      resolve({ ok, avgMs: ok ? ms : null, lossPercent: ok ? 0 : 100, viaPort: ok ? port : null });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    try { socket.connect(port, host); } catch { finish(false); }
  });
}

// 嘗試多個常見 port，任一通即算可達
async function tcpReachable(host, ports = [443, 80, 53], timeoutMs = 3000) {
  for (const port of ports) {
    const r = await tcpProbe(host, port, timeoutMs);
    if (r.ok) return r;
  }
  return { ok: false, avgMs: null, lossPercent: 100, viaPort: null };
}

async function pingTarget(host) {
  if (isInternalIp(host)) return null; // skip internal

  // DNS server-like targets: 優先試 53
  const looksLikeDns = /^(8\.8\.|1\.[01]\.|168\.95\.|9\.9\.|208\.67\.)/.test(host);
  const ports = looksLikeDns ? [53, 443, 80] : [443, 80, 53];

  return await tcpReachable(host, ports);
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
        try { req.destroy(); } catch {}
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
        const tag = probe.viaPort ? ` via tcp/${probe.viaPort}` : '';
        console.log(`  [${probe.ok ? '✓' : '✗'}] ${target.name} (${target.host}) ${probe.avgMs ?? 'N/A'}ms${tag}`);
      } else {
        probe = await httpTarget(target.host);
        console.log(`  [${probe.ok ? '✓' : '✗'}] ${target.name} (${target.host}) ${probe.avgMs ?? 'N/A'}ms`);
      }

      const entry = {
        groupName: group.name,
        groupLabel: group.label,
        name: target.name,
        host: target.host,
        type,
        ok: probe.ok,
        avgMs: probe.avgMs,
        lossPercent: probe.lossPercent
      };
      if (probe.viaPort) entry.probeViaPort = probe.viaPort;
      results.push(entry);
    }
  }

  const snapshot = {
    timestamp: now.toISOString(),
    timeLabel: twTime.toISOString().slice(11, 19),
    source: 'github-actions-runner',
    note: '外部視角（GitHub Actions ubuntu runner）— 已排除內網 IP；ping 類型用 TCP 連線探測（port 443/80/53），不是 ICMP',
    results
  };

  writeFileSync('external-status.json', JSON.stringify(snapshot, null, 2));
  console.log(`\n✓ external-status.json updated — ${results.length} targets probed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
