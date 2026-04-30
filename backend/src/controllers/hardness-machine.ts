import type { Request, Response } from 'express';
import {
  hardnessMachineSerialService,
  type MachineState,
} from '../lib/services/hardness-machine-serial.service';
import {
  ConnectMachineSchema,
  SetMachineControlSchema,
} from '../zod/hardness-machine.schema';

export async function connectMachine(req: Request, res: Response): Promise<void> {
  const parsed = ConnectMachineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
    return;
  }
  try {
    const state = await hardnessMachineSerialService.connectMachine(parsed.data);
    res.json({ ok: true, state });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: 'ConnectFailed', message });
  }
}

export async function disconnectMachine(_req: Request, res: Response): Promise<void> {
  try {
    const state = await hardnessMachineSerialService.disconnectMachine();
    res.json({ ok: true, state });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: 'DisconnectFailed', message });
  }
}

export function getMachineState(_req: Request, res: Response): void {
  res.json({ ok: true, state: hardnessMachineSerialService.getState() });
}

export async function setMachineControlValue(req: Request, res: Response): Promise<void> {
  const parsed = SetMachineControlSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
    return;
  }
  try {
    const state = await hardnessMachineSerialService.setControlValue(
      parsed.data.key,
      parsed.data.value
    );
    res.json({ ok: true, state });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: 'SetFailed', message });
  }
}

export async function startIndent(_req: Request, res: Response): Promise<void> {
  try {
    const state = await hardnessMachineSerialService.startIndent();
    res.json({ ok: true, state });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: 'IndentFailed', message });
  }
}

export function streamMachineEvents(_req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const send = (state: MachineState): void => {
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  };

  // Send the current state immediately so a fresh consumer gets a snapshot.
  send(hardnessMachineSerialService.getState());

  const onState = (state: MachineState): void => {
    send(state);
  };
  hardnessMachineSerialService.on('state', onState);

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  const cleanup = (): void => {
    clearInterval(heartbeat);
    hardnessMachineSerialService.off('state', onState);
  };
  _req.on('close', cleanup);
  _req.on('aborted', cleanup);
}
