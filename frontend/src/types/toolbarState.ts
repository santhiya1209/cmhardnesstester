export type ToolbarStatePayload = {
  lastAction: string;
};

export type ToolbarState = ToolbarStatePayload & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
