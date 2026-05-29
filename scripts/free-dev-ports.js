// Frees the dev ports (backend 4000, frontend 5173) before `npm run dev`,
// so a previous run that didn't shut down cleanly doesn't EADDRINUSE the next one.

const { execSync } = require('node:child_process');

const PORTS = [4000, 5173];

function pidsForPort(port) {
  // `netstat -ano` is available on every Windows install; parsing it avoids a
  // PowerShell dependency from npm scripts. We deliberately do NOT filter on
  // state ("LISTENING") because the localized state word and column layout
  // vary, and any non-zero PID bound to the port is something we want gone.
  let out = '';
  try {
    out = execSync(`netstat -ano`, { encoding: 'utf8' });
  } catch {
    return [];
  }
  const pids = new Set();
  const portSuffix = `:${port}`;
  for (const line of out.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4 || parts[0] !== 'TCP') continue;
    const local = parts[1] || '';
    if (!local.endsWith(portSuffix)) continue;
    const pid = parts[parts.length - 1];
    if (/^\d+$/.test(pid) && pid !== '0') {
      pids.add(pid);
    }
  }
  return [...pids];
}

function killPid(pid) {
  try {
    execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

let killedAny = false;
for (const port of PORTS) {
  const pids = pidsForPort(port);
  for (const pid of pids) {
    const ok = killPid(pid);
    console.log(`[free-dev-ports] port ${port}: ${ok ? 'killed' : 'failed to kill'} PID ${pid}`);
    killedAny = killedAny || ok;
  }
}

if (!killedAny) {
  console.log('[free-dev-ports] ports 4000 and 5173 are free.');
}
