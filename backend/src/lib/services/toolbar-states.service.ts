import type { ToolbarStatePayload } from '../../models/toolbar-state';
import { ToolbarStateModel, type ToolbarState } from '../../models/toolbar-state';
import { createCrudService } from './create-crud.service';

export type CreateToolbarStateInput = ToolbarStatePayload;
export type UpdateToolbarStateInput = Partial<ToolbarStatePayload>;

export const toolbarStatesService = createCrudService<
  ToolbarState,
  CreateToolbarStateInput,
  UpdateToolbarStateInput
>({
  collection: 'toolbarStates',
  resourceName: 'toolbar state',
  schema: ToolbarStateModel,
  createEntity: (input, { id, now }) => ({
    id,
    ...input,
    createdAt: now,
    updatedAt: now,
  }),
  updateEntity: (current, input, { now }) => ({
    ...current,
    ...input,
    updatedAt: now,
  }),
});
