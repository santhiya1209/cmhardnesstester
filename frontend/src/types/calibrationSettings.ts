export type CalibrationSettingsPayload = {
  objective: string;
  pixelToMicron: number;
  calibrationDate: string;
};

export type CalibrationSettingsSavePayload = {
  objective: string;
  pixelToMicron: number;
};

export type CalibrationSettings = CalibrationSettingsPayload & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
