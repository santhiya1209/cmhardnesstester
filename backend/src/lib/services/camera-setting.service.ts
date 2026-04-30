import {
  CameraSettingModel,
  type CameraSetting,
  type CameraSettingPayload,
} from '../../models/camera-setting';
import { createCrudService } from './create-crud.service';

export type CreateCameraSettingInput = CameraSettingPayload;
export type UpdateCameraSettingInput = Partial<CameraSettingPayload>;

export const cameraSettingService = createCrudService<
  CameraSetting,
  CreateCameraSettingInput,
  UpdateCameraSettingInput
>({
  collection: 'cameraSettings',
  resourceName: 'Camera setting',
  schema: CameraSettingModel,
  createEntity: (input, { id, now }) => ({
    id,
    analogGain: input.analogGain,
    exposureTimeMs: input.exposureTimeMs,
    createdAt: now,
    updatedAt: now,
  }),
  updateEntity: (current, input, { now }) => ({
    ...current,
    ...input,
    updatedAt: now,
  }),
});
