import type { PatternProgramPayload } from '../../models/pattern-program';
import { PatternProgramModel, type PatternProgram } from '../../models/pattern-program';
import { createCrudService } from './create-crud.service';

export type CreatePatternProgramInput = PatternProgramPayload;
export type UpdatePatternProgramInput = Partial<PatternProgramPayload>;

function createPatternName(pattern: string, sequence: number): string {
  return `${pattern} Program ${sequence}`;
}

function resolvePointCount(value: number | null | undefined): number {
  return value ?? 0;
}

export const patternProgramsService = createCrudService<
  PatternProgram,
  CreatePatternProgramInput,
  UpdatePatternProgramInput
>({
  collection: 'patternPrograms',
  resourceName: 'Pattern program',
  schema: PatternProgramModel,
  createEntity: (input, { id, now, database }) => ({
    id,
    ...input,
    patternName: createPatternName(input.pattern, database.patternPrograms.length + 1),
    pointCount: resolvePointCount(input.number),
    createdAt: now,
    updatedAt: now,
  }),
  updateEntity: (current, input, { now }) => {
    const nextNumber = input.number === undefined ? current.number : input.number;

    return {
      ...current,
      ...input,
      pointCount: resolvePointCount(nextNumber),
      updatedAt: now,
    };
  },
});
