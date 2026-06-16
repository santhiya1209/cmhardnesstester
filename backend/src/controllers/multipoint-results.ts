import { createCrudController } from './create-crud-controller';
import { multipointResultsService } from '../lib/services/multipoint-results.service';

export const {
  create: createMultipointResult,
  getAll: getMultipointResults,
  getById: getMultipointResultById,
  update: updateMultipointResult,
  remove: deleteMultipointResult,
} = createCrudController(multipointResultsService);
