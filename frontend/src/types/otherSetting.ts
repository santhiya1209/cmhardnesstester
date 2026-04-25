export const LANGUAGE_OPTIONS = [
  'English',
  'Tamil',
  'Hindi',
  'Chinese',
  'Japanese',
] as const;

export const HARDNESS_CONVERT_TABLE_OPTIONS = ['Common Convert Table'] as const;
export const ACCURACY_OPTIONS = [0, 1, 2, 3, 4, 5, 6] as const;

export type Language = (typeof LANGUAGE_OPTIONS)[number];
export type HardnessConvertTable = (typeof HARDNESS_CONVERT_TABLE_OPTIONS)[number];

export type OtherSettingPayload = {
  language: Language;
  hardnessValueAccuracy: number;
  conversionValueAccuracy: number;
  hardnessConvertTable: HardnessConvertTable;
  trimFast: number;
  trimSlow: number;
  historyImageCount: number;
  historyImageSizeMb: number;
};

export type OtherSetting = OtherSettingPayload & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type OtherSettingSavePayload = {
  id?: string;
  values: OtherSettingPayload;
};

export const DEFAULT_OTHER_SETTING: OtherSettingPayload = {
  language: 'English',
  hardnessValueAccuracy: 1,
  conversionValueAccuracy: 1,
  hardnessConvertTable: 'Common Convert Table',
  trimFast: 5,
  trimSlow: 1,
  historyImageCount: 29,
  historyImageSizeMb: 557,
};
