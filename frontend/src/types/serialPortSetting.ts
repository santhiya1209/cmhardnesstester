export const COM_PORT_OPTIONS = [
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'COM10',
] as const;

export type ComPort = (typeof COM_PORT_OPTIONS)[number];

export type SerialPortSettingPayload = {
  mainPortName: ComPort;
  xyPortName: ComPort;
  zPortName: ComPort;
};

export type SerialPortSetting = SerialPortSettingPayload & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type SerialPortSettingSavePayload = {
  id?: string;
  values: SerialPortSettingPayload;
};

export const DEFAULT_SERIAL_PORT_SETTING: SerialPortSettingPayload = {
  mainPortName: 'COM1',
  xyPortName: 'COM2',
  zPortName: 'COM3',
};
