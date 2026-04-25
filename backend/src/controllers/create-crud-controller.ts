import type { Response } from 'express';
import { asyncHandler } from '../lib/http';
import type { CrudService } from '../lib/services/create-crud.service';
import type { ValidatedRequest } from '../lib/validate';

type IdParams = {
  id: string;
};

export function createCrudController<TEntity, TCreate, TUpdate>(
  service: CrudService<TEntity, TCreate, TUpdate>
) {
  return {
    create: asyncHandler(async (req, res: Response) => {
      const validatedReq = req as ValidatedRequest<TCreate>;
      const created = await service.create(validatedReq.validated.body as TCreate);
      res.status(201).json(created);
    }),

    getAll: asyncHandler(async (_req, res: Response) => {
      const items = await service.getAll();
      res.json(items);
    }),

    getById: asyncHandler(async (req, res: Response) => {
      const validatedReq = req as ValidatedRequest<unknown, IdParams>;
      const { id } = validatedReq.validated.params as IdParams;
      const item = await service.getById(id);
      res.json(item);
    }),

    update: asyncHandler(async (req, res: Response) => {
      const validatedReq = req as ValidatedRequest<TUpdate, IdParams>;
      const { id } = validatedReq.validated.params as IdParams;
      const updated = await service.update(id, validatedReq.validated.body as TUpdate);
      res.json(updated);
    }),

    remove: asyncHandler(async (req, res: Response) => {
      const validatedReq = req as ValidatedRequest<unknown, IdParams>;
      const { id } = validatedReq.validated.params as IdParams;
      await service.delete(id);
      res.status(204).send();
    }),
  };
}
