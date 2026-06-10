import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  ZAxisSerialService,
  __setZSerialPortLibForTests,
} from './z-axis-serial.service';

// Drive the Z service against a FAKE serial port so the continuous-jog repeat loop
// and the #SSS# stop can be verified without hardware. The fake auto-replies to
// each TX frame with the matching LF-terminated token (SOK / UP / >Z: / OK_*),
// mirroring the verified Z protocol (no checksum).

interface FakePort {
  port: {
    isOpen: boolean;
    open: (cb: (err: Error | null) => void) => void;
    set: (opts: unknown, cb?: (err: Error | null) => void) => void;
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    write: (data: Buffer, cb?: (err: Error | null | undefined) => void) => boolean;
    drain: (cb?: (err: Error | null | undefined) => void) => void;
    close: (cb?: (err: Error | null) => void) => void;
  };
  writes: string[];
}

function makeFakePort(opts?: { stopReply?: string; stopMatch?: string; defaultReply?: string }): FakePort {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const writes: string[] = [];
  const stopReply = opts?.stopReply ?? 'UP\n';
  const stopMatch = opts?.stopMatch ?? 'SSS';
  const defaultReply = opts?.defaultReply ?? null;
  const port = {
    isOpen: false,
    open(cb: (err: Error | null) => void) {
      this.isOpen = true;
      cb(null);
    },
    set(_opts: unknown, cb?: (err: Error | null) => void) {
      if (cb) cb(null);
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      handlers[event] = listener;
    },
    write(data: Buffer, cb?: (err: Error | null | undefined) => void): boolean {
      const s = data.toString('ascii');
      writes.push(s);
      if (cb) cb(null);
      // Reply AFTER the service arms its pending waiter (write cb → drain → timer).
      setTimeout(() => {
        let reply: string | null = null;
        if (s.includes('+S#') || s.includes('-S#')) reply = 'SOK\n';
        else if (s.includes(stopMatch)) reply = stopReply;
        else if (s.includes('VZ')) reply = 'OK_ZFinalSpeed\n';
        else if (s.includes('Z ')) reply = '>Z:0\n';
        else if (s.includes('LK')) reply = 'OK_LK\n';
        else if (s.includes('LS')) reply = 'OK_LS\n';
        else reply = defaultReply;
        if (reply && handlers.data) handlers.data(Buffer.from(reply, 'ascii'));
      }, 2);
      return true;
    },
    drain(cb?: (err: Error | null | undefined) => void) {
      if (cb) cb(null);
    },
    close(cb?: (err: Error | null) => void) {
      this.isOpen = false;
      if (handlers.close) handlers.close();
      if (cb) cb(null);
    },
  };
  return { port, writes };
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function connectedService(fake: FakePort, port: string): Promise<ZAxisSerialService> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __setZSerialPortLibForTests({ SerialPort: function (_opts: any) { return fake.port; } } as any);
  const svc = new ZAxisSerialService();
  svc.setJogRepeatMsForTests(20); // fast cadence so a few ticks elapse quickly
  await svc.connect({ port });
  return svc;
}

test('lock/loosen are gated on the real OK_LK / OK_LS reply', async () => {
  const fake = makeFakePort();
  const svc = await connectedService(fake, 'COM-Z-LOCK');
  const lock = await svc.lock();
  assert.equal(lock.ok, true);
  assert.ok(fake.writes.includes('#LK#'));
  assert.equal(svc.getZState().locked, true);

  const loosen = await svc.unlock();
  assert.equal(loosen.ok, true);
  assert.ok(fake.writes.includes('#LS#'));
  assert.equal(svc.getZState().locked, false);
  await svc.disconnect();
});

test('lockZ updates locked only — never moving — and allows an immediate step move', async () => {
  const fake = makeFakePort();
  const svc = await connectedService(fake, 'COM-Z-LOCKMOVE');

  const lock = await svc.lock();
  assert.equal(lock.ok, true);
  assert.equal(svc.getZState().locked, true);
  // Regression: lock is a driver-state command and must NOT mark Z as moving.
  assert.equal(svc.getZState().moving, false);

  // moveZ (step) must NOT be rejected as BUSY right after a successful lock.
  const step = await svc.moveStep('-', 15);
  assert.equal(step.ok, true); // not rejected as XYZ_Z_BUSY
  assert.ok(fake.writes.includes('#-Z 15#'));
  assert.equal(svc.getZState().moving, false);
  await svc.disconnect();
});

test('loosenZ updates locked only — never moving — and allows an immediate step move', async () => {
  const fake = makeFakePort();
  const svc = await connectedService(fake, 'COM-Z-LOOSEMOVE');

  const loosen = await svc.unlock();
  assert.equal(loosen.ok, true);
  assert.equal(svc.getZState().locked, false);
  assert.equal(svc.getZState().moving, false);

  const step = await svc.moveStep('+', 15);
  assert.equal(step.ok, true);
  assert.ok(fake.writes.includes('#+Z 15#'));
  await svc.disconnect();
});

test('step move sets moving ONLY during the command and clears it after >Z:', async () => {
  const fake = makeFakePort();
  const svc = await connectedService(fake, 'COM-Z-MOVING');
  await svc.lock();

  const pending = svc.moveStep('+', 15);
  assert.equal(svc.getZState().moving, true); // in flight
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(svc.getZState().moving, false); // cleared after the real >Z: reply
  await svc.disconnect();
});

test('lock clears a stale moving=true so step movement is unblocked again', async () => {
  const fake = makeFakePort();
  const svc = await connectedService(fake, 'COM-Z-RECOVER');

  // Enter a jog (moving=true), then lock — lock must reset to a known-idle state.
  await svc.startJog('+');
  assert.equal(svc.getZState().moving, true);
  const lock = await svc.lock();
  assert.equal(lock.ok, true);
  assert.equal(svc.getZState().moving, false);
  assert.equal(svc.getZState().locked, true);

  const step = await svc.moveStep('-', 15);
  assert.equal(step.ok, true);
  await svc.disconnect();
});

test('stopJog handles a PLC ERROR on #SSS# without hanging and unblocks movement', async () => {
  const fake = makeFakePort({ stopReply: 'ERROR\n' });
  const svc = await connectedService(fake, 'COM-Z-STOPERR');
  await svc.lock();
  await svc.startJog('+');
  assert.equal(svc.getZState().moving, true);

  const stop = await svc.stopJog();
  // ERROR is a real PLC response — definitive failure, not a timeout/hang.
  assert.equal(stop.ok, false);
  assert.equal(stop.ok ? '' : stop.error, 'Z_STOP_PLC_ERROR');
  assert.ok(fake.writes.includes('#SSS#'));

  // Software jog state cleared immediately.
  assert.equal(svc.getZState().moving, false);
  assert.equal(svc.getZState().lastError, 'Z stop returned ERROR from PLC');

  // Future step movement must NOT be blocked by "Z axis is already moving".
  const step = await svc.moveStep('-', 15);
  assert.equal(step.ok, true);
  await svc.disconnect();
});

test('stopJog uses the configured stop payload (#STOP# instead of #SSS#)', async () => {
  // Fake answers the configured stop frame (#STOP#) with UP.
  const fake = makeFakePort({ stopMatch: 'STOP' });
  const svc = await connectedService(fake, 'COM-Z-STOPCFG');
  await svc.lock();
  await svc.startJog('+', 'STOP'); // facade passes the configured payload
  const stop = await svc.stopJog('STOP');
  assert.equal(stop.ok, true);
  assert.ok(fake.writes.includes('#STOP#'), JSON.stringify(fake.writes));
  assert.equal(fake.writes.includes('#SSS#'), false); // never the default once configured
  assert.equal(svc.getZState().moving, false);
  await svc.disconnect();
});

test('diagnoseStop probes the candidate stop payloads', async () => {
  // PLC rejects unknown stop candidates with ERROR — each probe resolves fast.
  const fake = makeFakePort({ defaultReply: 'ERROR\n' });
  const svc = await connectedService(fake, 'COM-Z-STOPDIAG');
  const probes = await svc.diagnoseStop();
  const sent = probes.map((p) => p.tx);
  assert.deepEqual(sent, ['#SSS#', '#S#', '#STOP#', '#ST#', '#UP#']);
  await svc.disconnect();
});

test('continuous jog UP repeatedly sends #+S# and #SSS# on release', async () => {
  const fake = makeFakePort();
  const svc = await connectedService(fake, 'COM-Z-UP');

  const start = await svc.startJog('+');
  assert.equal(start.ok, true);
  assert.equal(svc.getZState().moving, true); // moving only after first real SOK

  await delay(120); // ~6 ticks at 20 ms

  const jogFrames = fake.writes.filter((w) => w === '#+S#').length;
  assert.ok(jogFrames >= 2, `expected repeated #+S#, got ${jogFrames}: ${JSON.stringify(fake.writes)}`);
  // Only the up-jog frame is sent during the loop — never the down frame.
  assert.equal(fake.writes.filter((w) => w === '#-S#').length, 0);

  const stop = await svc.stopJog();
  assert.equal(stop.ok, true);
  assert.ok(fake.writes.includes('#SSS#'));
  assert.equal(svc.getZState().moving, false); // idle only after the real UP reply

  // The loop must not keep firing after release.
  const afterStop = fake.writes.length;
  await delay(80);
  assert.equal(fake.writes.length, afterStop, 'jog loop kept firing after stop');
  await svc.disconnect();
});

test('continuous jog DOWN repeatedly sends #-S# and #SSS# on release', async () => {
  const fake = makeFakePort();
  const svc = await connectedService(fake, 'COM-Z-DOWN');

  const start = await svc.startJog('-');
  assert.equal(start.ok, true);

  await delay(120);

  const jogFrames = fake.writes.filter((w) => w === '#-S#').length;
  assert.ok(jogFrames >= 2, `expected repeated #-S#, got ${jogFrames}: ${JSON.stringify(fake.writes)}`);
  assert.equal(fake.writes.filter((w) => w === '#+S#').length, 0);

  const stop = await svc.stopJog();
  assert.equal(stop.ok, true);
  assert.ok(fake.writes.includes('#SSS#'));
  assert.equal(svc.getZState().moving, false);
  await svc.disconnect();
});

test('step move up/down send #+Z n# / #-Z n# (space) gated on >Z:', async () => {
  const fake = makeFakePort();
  const svc = await connectedService(fake, 'COM-Z-STEP');

  const up = await svc.moveStep('+', 15);
  assert.equal(up.ok, true);
  assert.ok(fake.writes.includes('#+Z 15#'));

  const down = await svc.moveStep('-', 15);
  assert.equal(down.ok, true);
  assert.ok(fake.writes.includes('#-Z 15#'));
  await svc.disconnect();
});

test('probe wraps the payload as #payload# and returns the raw RX line', async () => {
  const fake = makeFakePort();
  const svc = await connectedService(fake, 'COM-Z-PROBE');

  const lk = await svc.probe('LK');
  assert.equal(lk.tx, '#LK#');
  assert.equal(lk.rx, 'OK_LK');

  const move = await svc.probe('+Z 15');
  assert.equal(move.tx, '#+Z 15#');
  assert.equal(move.rx, '>Z:0');
  await svc.disconnect();
});
