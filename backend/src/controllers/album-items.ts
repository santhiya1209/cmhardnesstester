import { createCrudController } from './create-crud-controller';
import { albumItemsService } from '../lib/services/album-items.service';

export const {
  create: createAlbumItem,
  getAll: getAlbumItems,
  getById: getAlbumItemById,
  update: updateAlbumItem,
  remove: deleteAlbumItem,
} = createCrudController(albumItemsService);
