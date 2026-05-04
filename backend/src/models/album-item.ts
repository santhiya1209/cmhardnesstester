import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema, NonEmptyStringSchema } from './common';

export const AlbumItemPayloadSchema = z.object({
  title: NonEmptyStringSchema,
  previewLabel: NonEmptyStringSchema,
  hardnessImage: z.boolean(),
  capturedAt: IsoDateTimeSchema,
  imageDataUrl: z.string().optional(),
  measurementId: z.string().optional(),
});

export const AlbumItemModel = AlbumItemPayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type AlbumItemPayload = z.infer<typeof AlbumItemPayloadSchema>;
export type AlbumItem = z.infer<typeof AlbumItemModel>;
