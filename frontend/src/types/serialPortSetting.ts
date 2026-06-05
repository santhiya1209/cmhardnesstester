export type SerialPortSettingPayload = {
  machineComPort: string | null;
  xyPortName: string | null;
  zPortName: string | null;
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
  machineComPort: null,
  xyPortName: null,
  zPortName: null,
};

export const MACHINE_BAUD_RATE = 9600;
