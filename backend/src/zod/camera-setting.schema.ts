import { buildUpdateSchema } from './common.schema';
import { CameraSettingPayloadSchema } from '../models/camera-setting';

export const CreateCameraSettingSchema = CameraSettingPayloadSchema;
export const UpdateCameraSettingSchema = buildUpdateSchema(CreateCameraSettingSchema);

export type CreateCameraSettingInput = typeof CreateCameraSettingSchema._output;
export type UpdateCameraSettingInput = typeof UpdateCameraSettingSchema._output;
