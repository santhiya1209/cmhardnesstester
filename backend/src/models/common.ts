import { z } from 'zod';

export const EntityIdSchema = z.string().uuid();
export const IsoDateTimeSchema = z.string().datetime();
export const NonEmptyStringSchema = z.string().trim().min(1);
export const NonNegativeNumberSchema = z.number().finite().nonnegative();
export const PositiveNumberSchema = z.number().finite().positive();

export function uniqueStringArraySchema(itemSchema: z.ZodString) {
  return z.array(itemSchema).superRefine((value, ctx) => {
    if (new Set(value).size !== value.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Array values must be unique.',
      });
    }
  });
}
