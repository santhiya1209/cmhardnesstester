import { createCrudController } from './create-crud-controller';
import { toolbarStatesService } from '../lib/services/toolbar-states.service';

export const {
  create: createToolbarState,
  getAll: getToolbarStates,
  getById: getToolbarStateById,
  update: updateToolbarState,
  remove: deleteToolbarState,
} = createCrudController(toolbarStatesService);
