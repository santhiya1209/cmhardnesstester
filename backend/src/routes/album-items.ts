import { Router } from 'express';
import {
  createAlbumItem,
  deleteAlbumItem,
  getAlbumItemById,
  getAlbumItems,
  updateAlbumItem,
} from '../controllers/album-items';
import { validate } from '../lib/validate';
import { IdParamsSchema } from '../zod/common.schema';
import { CreateAlbumItemSchema, UpdateAlbumItemSchema } from '../zod/album-items.schema';

const router = Router();

router.get('/', getAlbumItems);
router.post('/', validate(CreateAlbumItemSchema), createAlbumItem);
router.get('/:id', validate(IdParamsSchema, 'params'), getAlbumItemById);
router.put(
  '/:id',
  validate(IdParamsSchema, 'params'),
  validate(UpdateAlbumItemSchema),
  updateAlbumItem
);
router.delete('/:id', validate(IdParamsSchema, 'params'), deleteAlbumItem);

export default router;
