import type { AlbumItemPayload } from '../../models/album-item';
import { AlbumItemModel, type AlbumItem } from '../../models/album-item';
import { createCrudService } from './create-crud.service';

export type CreateAlbumItemInput = AlbumItemPayload;
export type UpdateAlbumItemInput = Partial<AlbumItemPayload>;

export const albumItemsService = createCrudService<
  AlbumItem,
  CreateAlbumItemInput,
  UpdateAlbumItemInput
>({
  collection: 'albumItems',
  resourceName: 'Album item',
  schema: AlbumItemModel,
  createEntity: (input, { id, now }) => ({
    id,
    ...input,
    createdAt: now,
    updatedAt: now,
  }),
  updateEntity: (current, input, { now }) => ({
    ...current,
    ...input,
    updatedAt: now,
  }),
});
