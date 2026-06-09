import type { Request, Response } from 'express';
import {
  xyzPlatformSerialService,
  type XyzCommandResult,
  type XyzStageState,
} from '../lib/services/xyz-platform-serial.service';
import {
  ConnectStageSchema,
  ConnectZSchema,
  DiagnoseZSchema,
  JogZSchema,
  ManualProbeSchema,
  MoveStageSchema,
  MoveStepSchema,
  MoveZSchema,
  RelocateSchema,
  SetFocusModeSchema,
  SetXySpeedSchema,
  SetZSpeedSchema,
} from '../zod/xyz-platform.schema';

// Movement results are already structured ({ ok, position?, rx? } |
// { ok:false, error }). A failed command is NOT an HTTP error — it is a
// truthful "could not move" the renderer renders verbatim — so we always
// respond 200 with the result and never invent a coordinate.
function sendResult(res: Response, result: XyzCommandResult): void {
  res.json(result);
}

export function getStageState(_req: Request, res: Response): void {
  res.json({ ok: true, state: xyzPlatformSerialService.getState() });
}

export async function connectStage(req: Request, res: Response): Promise<void> {
  const parsed = ConnectStageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'ValidationError', details: parsed.error.flatten() });
    return;
  }
  try {
    const state = await xyzPlatformSerialService.connectStage(parsed.data);
    res.json({ ok: true, state });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: 'ConnectFailed', message });
  }
}

export async function disconnectStage(_req: Request, res: Response): Promise<void> {
  const state = await xyzPlatformSerialService.disconnectStage();
  res.json({ ok: true, state });
}

export async function moveStage(req: Request, res: Response): Promise<void> {
  const parsed = MoveStageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'ValidationError', details: parsed.error.flatten() });
    return;
  }
  sendResult(res, await xyzPlatformSerialService.moveStage(parsed.data.direction));
}

export async function moveStep(req: Request, res: Response): Promise<void> {
  const parsed = MoveStepSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'ValidationError', details: parsed.error.flatten() });
    return;
  }
  sendResult(res, await xyzPlatformSerialService.moveStep(parsed.data.direction));
}

export async function stopStage(_req: Request, res: Response): Promise<void> {
  sendResult(res, await xyzPlatformSerialService.stopStage());
}

export async function moveZ(req: Request, res: Response): Promise<void> {
  const parsed = MoveZSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'ValidationError', details: parsed.error.flatten() });
    return;
  }
  sendResult(res, await xyzPlatformSerialService.moveZ(parsed.data.direction, parsed.data.speed));
}

export async function stopZ(_req: Request, res: Response): Promise<void> {
  sendResult(res, await xyzPlatformSerialService.stopZ());
}

export async function connectZAxis(req: Request, res: Response): Promise<void> {
  const parsed = ConnectZSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'ValidationError', details: parsed.error.flatten() });
    return;
  }
  try {
    const state = await xyzPlatformSerialService.connectZ(parsed.data);
    res.json({ ok: true, state });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: 'ConnectFailed', message });
  }
}

export async function disconnectZAxis(_req: Request, res: Response): Promise<void> {
  const state = await xyzPlatformSerialService.disconnectZ();
  res.json({ ok: true, state });
}

export async function startZJog(req: Request, res: Response): Promise<void> {
  const parsed = JogZSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'ValidationError', details: parsed.error.flatten() });
    return;
  }
  sendResult(res, await xyzPlatformSerialService.startZJog(parsed.data.direction));
}

export async function stopZJog(_req: Request, res: Response): Promise<void> {
  sendResult(res, await xyzPlatformSerialService.stopZJog());
}

export async function pollZStatus(_req: Request, res: Response): Promise<void> {
  sendResult(res, await xyzPlatformSerialService.pollZStatus());
}

export async function diagnoseZAxis(req: Request, res: Response): Promise<void> {
  const parsed = DiagnoseZSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'ValidationError', details: parsed.error.flatten() });
    return;
  }
  res.json(await xyzPlatformSerialService.diagnoseZ(parsed.data));
}

export async function lockZ(_req: Request, res: Response): Promise<void> {
  sendResult(res, await xyzPlatformSerialService.lockZ());
}

export async function unlockZ(_req: Request, res: Response): Promise<void> {
  sendResult(res, await xyzPlatformSerialService.unlockZ());
}

export async function lockXy(_req: Request, res: Response): Promise<void> {
  sendResult(res, await xyzPlatformSerialService.lockXy());
}

export async function unlockXy(_req: Request, res: Response): Promise<void> {
  sendResult(res, await xyzPlatformSerialService.unlockXy());
}

export async function setFocusMode(req: Request, res: Response): Promise<void> {
  const parsed = SetFocusModeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'ValidationError', details: parsed.error.flatten() });
    return;
  }
  sendResult(res, await xyzPlatformSerialService.setFocusMode(parsed.data.mode));
}

export async function setXySpeed(req: Request, res: Response): Promise<void> {
  const parsed = SetXySpeedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'ValidationError', details: parsed.error.flatten() });
    return;
  }
  sendResult(res, await xyzPlatformSerialService.setXySpeed(parsed.data.speed));
}

export async function setZSpeed(req: Request, res: Response): Promise<void> {
  const parsed = SetZSpeedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'ValidationError', details: parsed.error.flatten() });
    return;
  }
  sendResult(res, await xyzPlatformSerialService.setZSpeed(parsed.data.speed));
}

export async function getStagePosition(_req: Request, res: Response): Promise<void> {
  sendResult(res, await xyzPlatformSerialService.getPosition());
}

export async function moveStageToCenter(req: Request, res: Response): Promise<void> {
  const parsed = RelocateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'ValidationError', details: parsed.error.flatten() });
    return;
  }
  sendResult(res, await xyzPlatformSerialService.moveToCenter(parsed.data.homeBeforeRelocation ?? false));
}

export async function locateStageCenter(req: Request, res: Response): Promise<void> {
  const parsed = RelocateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'ValidationError', details: parsed.error.flatten() });
    return;
  }
  sendResult(res, await xyzPlatformSerialService.locateCenter(parsed.data.homeBeforeRelocation ?? false));
}

export async function setStageCenter(_req: Request, res: Response): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[xyz-set-center-request] route=/api/xyz-platform/set-center');
  sendResult(res, await xyzPlatformSerialService.setCenter());
}

export async function homeStage(_req: Request, res: Response): Promise<void> {
  sendResult(res, await xyzPlatformSerialService.home());
}

export async function diagnoseStage(_req: Request, res: Response): Promise<void> {
  res.json(await xyzPlatformSerialService.diagnose());
}

export async function testLineControlStage(_req: Request, res: Response): Promise<void> {
  res.json(await xyzPlatformSerialService.testLineControl());
}

export async function probeStage(req: Request, res: Response): Promise<void> {
  const parsed = ManualProbeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'ValidationError', details: parsed.error.flatten() });
    return;
  }
  const { commandText, ...options } = parsed.data;
  res.json(await xyzPlatformSerialService.probe(commandText, options));
}

export function streamStageEvents(req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const send = (state: XyzStageState): void => {
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  };

  send(xyzPlatformSerialService.getState());

  const onState = (state: XyzStageState): void => {
    send(state);
  };
  xyzPlatformSerialService.on('state', onState);

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  const cleanup = (): void => {
    clearInterval(heartbeat);
    xyzPlatformSerialService.off('state', onState);
  };
  req.on('close', cleanup);
  req.on('aborted', cleanup);
}
