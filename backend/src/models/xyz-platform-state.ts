import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema, NonEmptyStringSchema } from './common';

export const XySpeedSchema = z.enum(['slow', 'mid', 'fast']);
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
