export type AutoMeasureSettingsPayload = {
  claheClipLimit: number;
  blurKernel: number;
  thresholdMode: string;
  morphKernel: number;
  minGradient: number;
  confidenceThreshold: number;
};

export type AutoMeasureSettings = AutoMeasureSettingsPayload & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
