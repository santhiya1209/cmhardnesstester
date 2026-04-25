export type MachineSettingsPayload = {
  force: string;
  lightness: number;
  loadTime: number;
  objective: string;
  hardnessLevel: string;
};

export type MachineSettings = MachineSettingsPayload & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
