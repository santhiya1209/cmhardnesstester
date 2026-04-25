export type DepthImageSettingPayload = {
  hardnessImage: boolean;
  previewLabel: string;
};

export type DepthImageSetting = DepthImageSettingPayload & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
