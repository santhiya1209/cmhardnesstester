import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from './common';

// Every selectable port is an OS-reported path (COM1..COMnn on Windows,
// /dev/tty* on POSIX). The legacy COM1..COM10 enum is gone — operators
// routinely see ports above COM10 once a few USB serial adapters are
// plugged in, and the dropdowns are now populated by SerialPort.list().
// Machine COM port persists across launches so operators don't reselect it
// every session. On startup the app verifies the saved port is currently
// enumerated; if not, it surfaces a warning instead of silently picking
// another one.
export const SerialPortSettingPayloadSchema = z.object({
  machineComPort: z.string().trim().min(1).nullable().default(null),
  xyPortName: z.string().trim().min(1).nullable().default(null),
  zPortName: z.string().trim().min(1).nullable().default(null),
});

export const SerialPortSettingModel = SerialPortSettingPayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type SerialPortSettingPayload = z.infer<typeof SerialPortSettingPayloadSchema>;
export type SerialPortSetting = z.infer<typeof SerialPortSettingModel>;
