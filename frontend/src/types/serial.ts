export type SerialPortInfo = {
  path: string;
  manufacturer: string | null;
  serialNumber: string | null;
  pnpId: string | null;
  friendlyName: string | null;
  vendorId: string | null;
  productId: string | null;
};

export type SerialPortListResult =
  | { ok: true; ports: SerialPortInfo[] }
  | { ok: false; ports: []; error: string };
