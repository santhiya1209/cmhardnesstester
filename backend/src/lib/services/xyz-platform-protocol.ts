// XYZ motion-stage (SYJKPlatform + ZAxis) RS232 protocol adapter.
//
// This is the SINGLE place XYZ command bytes are built. The exact wire bytes
// from the original managed Communication.dll are NOT yet known, so every
// builder below THROWS `XYZ command not configured: <name>`. The serial service
// catches that and surfaces a structured error instead of inventing/faking a
// command. No dummy bytes ever reach the wire.
//
// Old DLL surface this maps to (Labtt.Communication):
//   SYJKPlatform: MoveLeft / MoveRight / MoveForward / MoveBack / MoveX / MoveY
//                 MoveXTo / MoveYTo / MoveTo / MoveToCenter / LocateCenter
//                 SetMoveSpeed / UpdateCurrentLocation / Stop / GetChecksum
//                 Write / ReadTo / OnLocationChanged
//   ZAxis:        Lock / Loosen / Move / MoveUpward / MoveDownward
//                 WriteAndRead / TryRead
//
// To enable a command: replace its `throw` with the confirmed frame builder.
// Nothing else in the stack changes.

import { Buffer } from 'node:buffer';

export type XyzDirection =
  | 'left'
  | 'right'
  | 'forward'
  | 'back'
  | 'forward-left'
  | 'forward-right'
  | 'back-left'
  | 'back-right';

export type ZDirection = 'up' | 'down';

export type XySpeed = 'slow' | 'mid' | 'fast';
export type ZSpeed = 'ultra' | 'fast' | 'slow';

export type XyzCommandKey =
  | 'moveStage'
  | 'stopStage'
  | 'moveZ'
  | 'stopZ'
  | 'lockZ'
  | 'unlockZ'
  | 'setXySpeed'
  | 'setZSpeed'
  | 'getPosition'
  | 'moveToCenter'
  | 'locateCenter';

export interface XyzPosition {
  x: number;
  y: number;
  z: number;
}

/** Uniform "not configured" failure — no builder ever returns dummy bytes. */
function notConfigured(name: XyzCommandKey): never {
  throw new Error(`XYZ command not configured: ${name}`);
}

// --- Command builders (all TODO placeholders) -------------------------------
// Each THROWS until the confirmed wire bytes are filled in. Signatures are
// stable so the service/controllers never change when bytes land.

// SYJKPlatform.MoveLeft / MoveRight / MoveForward / MoveBack (+ diagonals).
export function buildMoveStageCommand(_direction: XyzDirection, _speed: XySpeed): Buffer {
  return notConfigured('moveStage');
}

// SYJKPlatform.Stop — halt X/Y motion. MUST stay sendable even after a timeout.
export function buildStopStageCommand(): Buffer {
  return notConfigured('stopStage');
}

// ZAxis.MoveUpward / MoveDownward — continuous Z move until Stop.
export function buildMoveZCommand(_direction: ZDirection, _speed: ZSpeed): Buffer {
  return notConfigured('moveZ');
}

// ZAxis stop (paired with Move*, like SYJKPlatform.Stop).
export function buildStopZCommand(): Buffer {
  return notConfigured('stopZ');
}

// ZAxis.Lock / ZAxis.Loosen.
export function buildLockZCommand(): Buffer {
  return notConfigured('lockZ');
}

export function buildUnlockZCommand(): Buffer {
  return notConfigured('unlockZ');
}

// SYJKPlatform.SetMoveSpeed (X/Y).
export function buildSetXySpeedCommand(_speed: XySpeed): Buffer {
  return notConfigured('setXySpeed');
}

// ZAxis move-speed (mirrors SetMoveSpeed for Z).
export function buildSetZSpeedCommand(_speed: ZSpeed): Buffer {
  return notConfigured('setZSpeed');
}

// SYJKPlatform.UpdateCurrentLocation — query current X/Y/Z position.
export function buildGetPositionCommand(): Buffer {
  return notConfigured('getPosition');
}

// SYJKPlatform.MoveToCenter — move X/Y to the configured center.
export function buildMoveToCenterCommand(): Buffer {
  return notConfigured('moveToCenter');
}

// SYJKPlatform.LocateCenter — re-home/locate the center reference.
export function buildLocateCenterCommand(): Buffer {
  return notConfigured('locateCenter');
}

// SYJKPlatform.GetChecksum — frame checksum used by Write/WriteAndRead.
// Throws so it can never silently produce a fake byte.
export function getChecksum(_frame: Buffer): number {
  throw new Error('XYZ command not configured: getChecksum');
}

// RX decoder — SYJKPlatform.ReadTo / ZAxis.TryRead + OnLocationChanged feed.
// Until the protocol is known we cannot parse a position, so every frame is
// 'unknown'. Returning a position here is the ONLY way coordinates ever update,
// so leaving this unparsed guarantees no fake coordinate movement.
export type ParsedXyzFrame =
  | { kind: 'position'; position: XyzPosition }
  | { kind: 'ack' }
  | { kind: 'nak'; message?: string }
  | { kind: 'unknown'; raw: Buffer };

export function parseXyzFrame(rawFrame: Buffer): ParsedXyzFrame {
  // TODO(protocol): decode OnLocationChanged / ReadTo frames once known.
  return { kind: 'unknown', raw: rawFrame };
}
