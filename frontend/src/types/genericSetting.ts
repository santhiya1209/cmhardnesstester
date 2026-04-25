export const HARDNESS_TEST_MODES = ['HV', 'HK'] as const;

export type HardnessTestMode = (typeof HARDNESS_TEST_MODES)[number];

export type GenericSettingPayload = {
  caseDepthHardness: number;
  hardnessTestMode: HardnessTestMode;
};

export type GenericSetting = GenericSettingPayload & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type GenericSettingSavePayload = {
  id?: string;
  values: GenericSettingPayload;
};

export const DEFAULT_GENERIC_SETTING: GenericSettingPayload = {
  caseDepthHardness: 250,
  hardnessTestMode: 'HV',
};
