import { z } from 'zod';
import {
  ImageSelectionSchema,
  ZAxisSettingsPayloadSchema,
} from '../models/z-axis-settings';

// Save validates the FULL Z-axis settings payload (Confirm). Field constraints
// (pulsePerMm > 0, stepDistanceMm > 0, empty-trip >= 0, imageSelection in the
// allowed set) are inherited from the model's payload schema.
export const SaveZAxisSettingsSchema = ZAxisSettingsPayloadSchema;
export type SaveZAxisSettingsInput = z.infer<typeof SaveZAxisSettingsSchema>;

// Preview validates ONLY the image-selection value — preview touches nothing else
// and must never move hardware or send Z serial commands.
export const PreviewZAxisSettingsSchema = z.object({ imageSelection: ImageSelectionSchema });
export type PreviewZAxisSettingsInput = z.infer<typeof PreviewZAxisSettingsSchema>;
