import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { mutateDatabase, readCollection } from '../db';
import { NotFoundError } from '../errors';
import type { CollectionName, DatabaseState } from '../../models/database';

export interface CrudService<TEntity, TCreate, TUpdate> {
  create(input: TCreate): Promise<TEntity>;
  getAll(): Promise<TEntity[]>;
  getById(id: string): Promise<TEntity>;
  update(id: string, input: TUpdate): Promise<TEntity>;
  delete(id: string): Promise<TEntity>;
}

type CreateCrudServiceConfig<TEntity extends { id: string }, TCreate, TUpdate> = {
  collection: CollectionName;
  resourceName: string;
  schema: z.ZodType<TEntity>;
  createEntity: (
    input: TCreate,
    context: { id: string; now: string; database: DatabaseState }
  ) => TEntity;
  updateEntity: (
    current: TEntity,
    input: TUpdate,
    context: { now: string; database: DatabaseState }
  ) => TEntity;
  beforeCreate?: (input: TCreate, database: DatabaseState) => Promise<void> | void;
  beforeUpdate?: (
    current: TEntity,
    input: TUpdate,
    database: DatabaseState
  ) => Promise<void> | void;
  beforeDelete?: (current: TEntity, database: DatabaseState) => Promise<void> | void;
};

export function createCrudService<TEntity extends { id: string }, TCreate, TUpdate>(
  config: CreateCrudServiceConfig<TEntity, TCreate, TUpdate>
): CrudService<TEntity, TCreate, TUpdate> {
  const {
    beforeCreate,
    beforeDelete,
    beforeUpdate,
    collection,
    createEntity,
    resourceName,
    schema,
    updateEntity,
  } = config;

  const getItems = (database: DatabaseState): TEntity[] =>
    database[collection] as unknown as TEntity[];

  return {
    async create(input) {
      return mutateDatabase(async (database) => {
        await beforeCreate?.(input, database);

        const entity = schema.parse(
          createEntity(input, {
            id: randomUUID(),
            now: new Date().toISOString(),
            database,
          })
        );

        return {
          database: {
            ...database,
            [collection]: [...getItems(database), entity],
          } as DatabaseState,
          result: entity,
        };
      });
    },

    async getAll() {
      const items = await readCollection(collection);
      return items as unknown as TEntity[];
    },

    async getById(id) {
      const items = (await readCollection(collection)) as unknown as TEntity[];
      const entity = items.find((item) => item.id === id);

      if (!entity) {
        throw new NotFoundError(resourceName, id);
      }

      return entity;
    },

    async update(id, input) {
      return mutateDatabase(async (database) => {
        const items = getItems(database);
        const index = items.findIndex((item) => item.id === id);

        if (index === -1) {
          throw new NotFoundError(resourceName, id);
        }

        const current = items[index];
        await beforeUpdate?.(current, input, database);

        const entity = schema.parse(
          updateEntity(current, input, {
            now: new Date().toISOString(),
            database,
          })
        );

        const nextItems = items.slice();
        nextItems[index] = entity;

        return {
          database: {
            ...database,
            [collection]: nextItems,
          } as DatabaseState,
          result: entity,
        };
      });
    },

    async delete(id) {
      return mutateDatabase(async (database) => {
        const items = getItems(database);
        const index = items.findIndex((item) => item.id === id);

        if (index === -1) {
          throw new NotFoundError(resourceName, id);
        }

        const current = items[index];
        await beforeDelete?.(current, database);

        const nextItems = items.slice();
        const [deleted] = nextItems.splice(index, 1);

        return {
          database: {
            ...database,
            [collection]: nextItems,
          } as DatabaseState,
          result: deleted,
        };
      });
    },
  };
}
