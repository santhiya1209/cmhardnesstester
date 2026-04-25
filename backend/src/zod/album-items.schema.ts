import { buildUpdateSchema } from './common.schema';
import { AlbumItemPayloadSchema } from '../models/album-item';

export const CreateAlbumItemSchema = AlbumItemPayloadSchema;
export const UpdateAlbumItemSchema = buildUpdateSchema(AlbumItemPayloadSchema);

export type CreateAlbumItemInput = typeof CreateAlbumItemSchema._output;
export type UpdateAlbumItemInput = typeof UpdateAlbumItemSchema._output;
