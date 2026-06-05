export type MicrometerConfigPayload = {
  enabled: boolean;
  comPort?: string | null;
};

export type MicrometerConfig = MicrometerConfigPayload & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_MICROMETER_CONFIG: MicrometerConfigPayload = {
  enabled: true,
  comPort: null,
};

export const MICROMETER_BAUD_RATE = 2400;

export type DepthSource = 'device' | 'manual';
