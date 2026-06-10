import { z } from 'zod';

// Action-route payload validation for the live XYZ motion stage. These are
// hardware-control commands and are intentionally separate from the
// xyz-platform-states CRUD persistence schema.

export const XyzDirectionSchema = z.enum([
  'left',
  'right',
  'forward',
  'back',
  'forward-left',
  'forward-right',
  'back-left',
  'back-right',
]);

export const ZDirectionSchema = z.enum(['up', 'down']);
// Four operator XY speed tiers. Values written by the (reverted) six-tier
// expansion are reverse-normalized before validation so old clients/data never
// break: medium→mid; veryFast/superFast/ultraFast→ultra. ZSpeed is a separate
// axis enum and is intentionally left unchanged.
const XY_SPEED_REVERSE_ALIASES: Record<string, string> = {
  medium: 'mid',
  veryFast: 'ultra',
  superFast: 'ultra',
  ultraFast: 'ultra',
};
export const XySpeedSchema = z.preprocess(
  (v) => (typeof v === 'string' && XY_SPEED_REVERSE_ALIASES[v] ? XY_SPEED_REVERSE_ALIASES[v] : v),
  z.enum(['slow', 'mid', 'fast', 'ultra'])
);
export const ZSpeedSchema = z.enum(['ultra', 'fast', 'slow']);

export const ConnectStageSchema = z.object({
  port: z.string().min(1),
  baudRate: z.number().int().positive().optional(),
  dataBits: z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(8)]).optional(),
  stopBits: z.union([z.literal(1), z.literal(1.5), z.literal(2)]).optional(),
  parity: z.enum(['none', 'even', 'odd', 'mark', 'space']).optional(),
});
export type ConnectStageInput = z.infer<typeof ConnectStageSchema>;

// Jog press: direction only. Speed is backend-owned state (set via setXySpeed),
// never passed per move — so no free speed value can ride in on a jog.
export const MoveStageSchema = z.object({
  direction: XyzDirectionSchema,
});
export type MoveStageInput = z.infer<typeof MoveStageSchema>;

// Quick-tap step: direction only. The per-tier step distance is backend-owned
// config (speedProfiles[tier].stepDistanceMm), never passed per move.
export const MoveStepSchema = z.object({
  direction: XyzDirectionSchema,
});
export type MoveStepInput = z.infer<typeof MoveStepSchema>;

export const MoveZSchema = z.object({
  direction: ZDirectionSchema,
  speed: ZSpeedSchema,
});
export type MoveZInput = z.infer<typeof MoveZSchema>;

// Z-axis connect: operator-selected zPortName from Serial Port Setting — NEVER a
// hardcoded/fallback COM. Baud defaults to the legacy 57600 in the service.
export const ConnectZSchema = z.object({
  port: z.string().min(1),
  baudRate: z.number().int().positive().optional(),
  dataBits: z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(8)]).optional(),
  stopBits: z.union([z.literal(1), z.literal(1.5), z.literal(2)]).optional(),
  parity: z.enum(['none', 'even', 'odd', 'mark', 'space']).optional(),
});
export type ConnectZInput = z.infer<typeof ConnectZSchema>;

// Press-and-hold Z jog: direction only (speed is backend-owned, set via setZSpeed).
export const JogZSchema = z.object({ direction: ZDirectionSchema });
export type JogZInput = z.infer<typeof JogZSchema>;

// Optional diagnoseZ flags. includeJog gates the MOTION-causing #+S#/#-S# probes.
export const DiagnoseZSchema = z.object({
  includeJog: z.boolean().optional(),
  speedRegisterValue: z.number().int().nonnegative().optional(),
});
export type DiagnoseZInput = z.infer<typeof DiagnoseZSchema>;

// Manual Z probe (dev-console only). `payload` is the inner Z frame text (without
// the surrounding '#'), sent as "#payload#". Bounded so a stray paste can't flood
// serial; no allowlist by design — it is gated behind a connected Z port.
export const ProbeZSchema = z.object({
  payload: z.string().min(1).max(64),
});
export type ProbeZInput = z.infer<typeof ProbeZSchema>;

export const SetXySpeedSchema = z.object({ speed: XySpeedSchema });
export type SetXySpeedInput = z.infer<typeof SetXySpeedSchema>;

export const SetZSpeedSchema = z.object({ speed: ZSpeedSchema });
export type SetZSpeedInput = z.infer<typeof SetZSpeedSchema>;

export const FocusModeSchema = z.enum(['manual', 'cFocus', 'fFocus']);

export const SetFocusModeSchema = z.object({ mode: FocusModeSchema });
export type SetFocusModeInput = z.infer<typeof SetFocusModeSchema>;

// Expert manual probe (dev-console only). commandText is sent verbatim (or
// checksum-wrapped for "#..!" in checksum mode) — there is no safe-command
// allowlist here by design; it is gated behind a connected port and explicit text.
export const ManualProbeSchema = z.object({
  // NOTE: no .trim() / .transform() — probe bytes (incl. CR/LF/tabs) must reach
  // the wire verbatim. Only bound the length so a stray paste can't flood serial.
  commandText: z.string().min(1).max(64),
  // checksum:false (or omitted) => raw byte-exact; true => append checksum + 0x21.
  checksum: z.boolean().optional(),
  mode: z.enum(['raw', 'checksum']).optional(),
  terminator: z.enum(['none', 'cr', 'crlf']).optional(),
  timeoutMs: z.number().int().positive().max(10000).optional(),
});
export type ManualProbeInput = z.infer<typeof ManualProbeSchema>;
