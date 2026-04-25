import { z, type ZodObject, type ZodRawShape } from 'zod';
import { EntityIdSchema } from '../models/common';

export const IdParamsSchema = z.object({
  id: EntityIdSchema,
});

export function buildUpdateSchema<T extends ZodRawShape>(schema: ZodObject<T>) {
  return schema.partial().superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one field must be provided.',
      });
    }
  });
}
