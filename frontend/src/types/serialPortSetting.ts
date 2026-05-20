// Machine COM port is intentionally NOT part of this payload — it's a
// per-session selection held in App state. Saving it would cause the app to
// auto-reconnect a stale port on next launch.
export type SerialPortSettingPayload = {
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
  xyPortName: null,
  zPortName: null,
};

// Machine RS-232 wire format is fixed by the hardness tester firmware
// (9600 8N1). The operator selects only the COM port — baud is never
// configurable from the UI.
export const MACHINE_BAUD_RATE = 9600;
