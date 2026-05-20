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

// Micrometer wire format is fixed by the device (2400 8N1). The operator
// selects only the COM port — baud is never configurable from the UI.
export const MICROMETER_BAUD_RATE = 2400;

export type DepthSource = 'device' | 'manual';
