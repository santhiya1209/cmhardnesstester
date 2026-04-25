import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema, NonEmptyStringSchema } from './common';

export const PatternSchema = z.enum(['Line', 'Rectangle', 'Circle', 'Custom']);
export const PatternModeSchema = z.enum([
  'Horizontal Mode',
  'Vertical Mode',
  'Case Depth Mode',
  'Free Mode',
  'Matrix Mode',
  'Circle Mode',
  'Midpoint Mode',
  'Equidistant Multipoint Mode',
  'Equidistant Three Point Mode',
  'Equidistant Triangle Mode',
  'Multiline Composite Pattern',
  'Vertical Line Free Points Mode',
]);
export const ImpressModeSchema = z.enum(['indenting', 'onePass', 'twoPass']);

const NullableFiniteNumberSchema = z.number().finite().nullable();
const NullableNonNegativeNumberSchema = z.number().finite().nonnegative().nullable();
const NullableNonNegativeIntegerSchema = z.number().int().nonnegative().nullable();

export const PatternProgramPayloadSchema = z.object({
  pattern: PatternSchema,
  mode: PatternModeSchema,
  refX: NullableFiniteNumberSchema,
  refY: NullableFiniteNumberSchema,
  interval: NullableNonNegativeNumberSchema,
  offset: NullableNonNegativeNumberSchema,
  firstOffset: NullableNonNegativeNumberSchema,
  number: NullableNonNegativeIntegerSchema,
  multiset: z.boolean(),
  focusAll: z.boolean(),
  impressMode: ImpressModeSchema,
  checked: z.boolean(),
});

export const PatternProgramModel = PatternProgramPayloadSchema.extend({
  id: EntityIdSchema,
  patternName: NonEmptyStringSchema,
  pointCount: z.number().int().nonnegative(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type PatternProgramPayload = z.infer<typeof PatternProgramPayloadSchema>;
export type PatternProgram = z.infer<typeof PatternProgramModel>;
