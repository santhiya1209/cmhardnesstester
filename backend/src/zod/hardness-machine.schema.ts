import { z } from 'zod';

const FORCE_VALUES = new Set([
  '0.01kgf',
  '0.025kgf',
  '0.05kgf',
  '0.1kgf',
  '0.2kgf',
  '0.3kgf',
  '0.5kgf',
  '1kgf',
]);
const OBJECTIVE_VALUES = new Set(['2.5X', '5X', '10X', '20X', '40X', '50X']);
const HARDNESS_LEVEL_VALUES = new Set(['Low', 'Middle', 'High']);

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
}).superRefine((input, ctx) => {
  const text = String(input.value).trim();
  switch (input.key) {
    case 'force':
      if (!FORCE_VALUES.has(text)) {
        ctx.addIssue({ code: 'custom', message: 'invalid force', path: ['value'] });
      }
      break;
    case 'objective':
      if (!OBJECTIVE_VALUES.has(text.toUpperCase())) {
        ctx.addIssue({ code: 'custom', message: 'invalid objective', path: ['value'] });
      }
      break;
    case 'lightness': {
      const numeric = Number(text);
      if (!Number.isInteger(numeric) || numeric < 0 || numeric > 10) {
        ctx.addIssue({ code: 'custom', message: 'invalid lightness', path: ['value'] });
      }
      break;
    }
    case 'loadTime': {
      const numeric = Number(text);
      if (!Number.isInteger(numeric) || numeric < 1 || numeric > 99) {
        ctx.addIssue({ code: 'custom', message: 'invalid loadTime', path: ['value'] });
      }
      break;
    }
    case 'hardnessLevel':
      if (!HARDNESS_LEVEL_VALUES.has(text)) {
        ctx.addIssue({ code: 'custom', message: 'invalid hardnessLevel', path: ['value'] });
      }
      break;
    default: {
      const exhaustive: never = input.key;
      return exhaustive;
    }
  }
});
export type SetMachineControlInput = z.infer<typeof SetMachineControlSchema>;

export const SendTurretSchema = z.object({
  direction: z.enum(['left', 'front', 'right']),
});
export type SendTurretInput = z.infer<typeof SendTurretSchema>;
