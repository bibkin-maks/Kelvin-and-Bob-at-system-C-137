/* Exports whole Figma frames as flat PNGs.
 *
 *   node tools/export_frames.cjs <outDir> <nodeId>@<name>[@<scale>] ...
 *
 * Goes through the bridge relay rather than the MCP tool channel, because
 * export_png answers with base64 and full-size panels would be megabytes of it.
 * Needs the relay running and the "Code MCP Bridge" plugin open in Figma.
 */

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const OUT = process.argv[2];
const JOBS = process.argv.slice(3).map((a) => {
  const [id, name, scale] = a.split('@');
  return { id, name, scale: Number(scale || 1) };
});

const ws = new WebSocket('ws://localhost:3055');
const pending = new Map();
let seq = 0;

function call(command, params) {
  const id = `frm-${++seq}`;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ type: 'broadcast', payload: { kind: 'request', id, command, params } }));
    setTimeout(() => pending.has(id) && (pending.delete(id), rej(new Error(`${command} timed out`))), 120000);
  });
}

ws.on('open', () => ws.send(JSON.stringify({ type: 'join', channel: 'default' })));

ws.on('message', async (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === 'broadcast' && msg.payload?.kind === 'response') {
    const p = pending.get(msg.payload.id);
    if (!p) return;
    pending.delete(msg.payload.id);
    msg.payload.error ? p.rej(new Error(msg.payload.error)) : p.res(msg.payload.result);
    return;
  }
  if (msg.type !== 'joined') return;

  fs.mkdirSync(OUT, { recursive: true });
  for (const job of JOBS) {
    try {
      const r = await call('export_png', { nodeId: job.id, scale: job.scale });
      const b64 = r.data || r.base64 || r.png || (typeof r === 'string' ? r : null);
      if (!b64) throw new Error('no image data');
      const file = path.join(OUT, `${job.name}.png`);
      fs.writeFileSync(file, Buffer.from(b64.replace(/^data:.*?,/, ''), 'base64'));
      console.log(`${job.name}.png  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
    } catch (e) {
      console.log(`${job.name}: ${e.message}`);
    }
  }
  ws.close();
  process.exit(0);
});

ws.on('error', (e) => { console.error('relay error:', e.message); process.exit(1); });
