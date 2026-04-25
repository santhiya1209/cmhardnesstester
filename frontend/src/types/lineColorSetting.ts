export const LINE_COLOR_OPTIONS = [
  'Purple',
  'Yellow',
  'Red',
  'Green',
  'Blue',
  'White',
  'Black',
] as const;

export type LineColor = (typeof LINE_COLOR_OPTIONS)[number];

export const LINE_COLOR_HEX: Record<LineColor, string> = {
  Purple: '#800080',
  Yellow: '#FFFF00',
  Red: '#D32F2F',
  Green: '#0F6E56',
  Blue: '#1E3A5F',
  White: '#FFFFFF',
  Black: '#000000',
};

export const DEFAULT_LINE_COLOR: LineColor = 'Purple';

export type LineColorSettingPayload = {
  lineColor: LineColor;
};

export type LineColorSetting = LineColorSettingPayload & {
  id: string;
  updatedAt: string;
};

export type LineColorSettingSavePayload = {
  id?: string;
  values: LineColorSettingPayload;
};
