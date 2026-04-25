import { createCrudController } from './create-crud-controller';
import { patternProgramsService } from '../lib/services/pattern-programs.service';

export const {
  create: createPatternProgram,
  getAll: getPatternPrograms,
  getById: getPatternProgramById,
  update: updatePatternProgram,
  remove: deletePatternProgram,
} = createCrudController(patternProgramsService);
