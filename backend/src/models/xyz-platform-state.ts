import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema, NonEmptyStringSchema } from './common';

// Four operator XY speed tiers. Values written by the (reverted) six-tier
// expansion are reverse-normalized so old persisted rows still validate at load:
// medium→mid; veryFast/superFast/ultraFast→ultra. ZSpeed unchanged.
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
export const FocusModeSchema = z.enum(['manual', 'cFocus', 'fFocus']);

const FiniteNumberSchema = z.number().finite();

export const XYZPlatformStatePayloadSchema = z.object({
  xySpeed: XySpeedSchema,
  zSpeed: ZSpeedSchema,
  platformX: FiniteNumberSchema,
  platformY: FiniteNumberSchema,
  platformZ: FiniteNumberSchema,
  xyLocked: z.boolean(),
  zLocked: z.boolean(),
  focusMode: FocusModeSchema,
  lastAction: NonEmptyStringSchema,
});

export const XYZPlatformStateModel = XYZPlatformStatePayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type XYZPlatformStatePayload = z.infer<typeof XYZPlatformStatePayloadSchema>;
export type XYZPlatformState = z.infer<typeof XYZPlatformStateModel>;
