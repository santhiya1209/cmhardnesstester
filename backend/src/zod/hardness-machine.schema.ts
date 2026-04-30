import { z } from 'zod';

export const ConnectMachineSchema = z.object({
  port: z.string().min(1),
  baudRate: z.number().int().positive().optional(),
  dataBits: z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(8)]).optional(),
  stopBits: z.union([z.literal(1), z.literal(1.5), z.literal(2)]).optional(),
  parity: z.enum(['none', 'even', 'odd', 'mark', 'space']).optional(),
});
export type ConnectMachineInput = z.infer<typeof ConnectMachineSchema>;

export const SetMachineControlSchema = z.object({
  key: z.enum(['force', 'lightness', 'loadTime', 'objective', 'hardnessLevel']),
  value: z.union([z.string(), z.number()]),
});
export type SetMachineControlInput = z.infer<typeof SetMachineControlSchema>;
