import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from './common';
import { XySpeedSchema } from './xyz-platform-state';

// Backend-owned XYZ platform config SINGLETON — only ever one row. Holds the
// operator-taught optical/camera center (absolute controller pulses, the value a
// #10! position query reads when the camera is centered on the reference) AND
// the active XY speed mode, so both survive restart. The optical center is NOT
// the controller's hardware zero/home (#12!), which is a separate position.
// Fields are nullable because speed may be set before a center is taught (and
// vice versa). The collection/table name (xyzCenterCalibration) is historical.
export const XYZCenterCalibrationPayloadSchema = z.object({
  centerX: z.number().finite().nullable(),
  centerY: z.number().finite().nullable(),
  xySpeed: XySpeedSchema.nullable().optional(),
});

export const XYZCenterCalibrationModel = XYZCenterCalibrationPayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type XYZCenterCalibrationPayload = z.infer<typeof XYZCenterCalibrationPayloadSchema>;
export type XYZCenterCalibration = z.infer<typeof XYZCenterCalibrationModel>;
