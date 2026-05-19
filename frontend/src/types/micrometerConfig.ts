export type MicrometerConfigPayload = {
  enabled: boolean;
};

export type MicrometerConfig = MicrometerConfigPayload & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_MICROMETER_CONFIG: MicrometerConfigPayload = {
  enabled: true,
};

export type DepthSource = 'device' | 'manual';
