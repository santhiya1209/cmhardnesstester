// Machine COM port persists across launches so operators don't reselect it
// every session. The Serial Port Setting dialog is the only writer; the App
// reads it on startup, verifies the port still enumerates, and auto-connects.
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

// Machine RS-232 wire format is fixed by the hardness tester firmware
// (9600 8N1). The operator selects only the COM port — baud is never
// configurable from the UI.
export const MACHINE_BAUD_RATE = 9600;
