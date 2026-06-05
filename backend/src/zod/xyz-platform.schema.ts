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
export const XySpeedSchema = z.enum(['slow', 'mid', 'fast']);
export const ZSpeedSchema = z.enum(['ultra', 'fast', 'slow']);

export const ConnectStageSchema = z.object({
  port: z.string().min(1),
  baudRate: z.number().int().positive().optional(),
  dataBits: z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(8)]).optional(),
  stopBits: z.union([z.literal(1), z.literal(1.5), z.literal(2)]).optional(),
  parity: z.enum(['none', 'even', 'odd', 'mark', 'space']).optional(),
});
export type ConnectStageInput = z.infer<typeof ConnectStageSchema>;

export const MoveStageSchema = z.object({
  direction: XyzDirectionSchema,
  speed: XySpeedSchema,
});
export type MoveStageInput = z.infer<typeof MoveStageSchema>;

export const MoveZSchema = z.object({
  direction: ZDirectionSchema,
  speed: ZSpeedSchema,
});
export type MoveZInput = z.infer<typeof MoveZSchema>;

export const SetXySpeedSchema = z.object({ speed: XySpeedSchema });
export type SetXySpeedInput = z.infer<typeof SetXySpeedSchema>;

export const SetZSpeedSchema = z.object({ speed: ZSpeedSchema });
export type SetZSpeedInput = z.infer<typeof SetZSpeedSchema>;

export const FocusModeSchema = z.enum(['manual', 'cFocus', 'fFocus']);

export const SetFocusModeSchema = z.object({ mode: FocusModeSchema });
export type SetFocusModeInput = z.infer<typeof SetFocusModeSchema>;
