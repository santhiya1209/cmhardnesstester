import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from './common';

// Bounds match the DVP SDK descriptor envelope (microseconds for exposure,
// gain in SDK units). Live clamping to the active camera's actual descriptor
// happens in the native addon.
const AnalogGainSchema = z.number().finite().min(0).max(64);
const ExposureTimeMsSchema = z.number().finite().min(0).max(1_000_000);

export const CameraSettingPayloadSchema = z.object({
  analogGain: AnalogGainSchema,
  exposureTimeMs: ExposureTimeMsSchema,
});

export const CameraSettingModel = CameraSettingPayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type CameraSettingPayload = z.infer<typeof CameraSettingPayloadSchema>;
export type CameraSetting = z.infer<typeof CameraSettingModel>;
