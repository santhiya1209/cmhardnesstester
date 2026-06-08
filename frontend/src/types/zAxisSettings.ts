// Z Axis settings DTO — mirrors the backend `zAxisSettings` singleton. The
// backend service is the source of truth; the renderer only displays/edits a
// draft and persists through IPC.

export const IMAGE_SELECTION_OPTIONS = [30, 40, 50, 60, 70, 80, 90, 100] as const;
export type ImageSelection = (typeof IMAGE_SELECTION_OPTIONS)[number];

export type ZAxisSettingsPayload = {
  reverseDirection: boolean;
  pulsePerMm: number;
  stepDistanceMm: number;
  hasEmptyTrip: boolean;
  upwardEmptyTripMm: number;
  downwardEmptyTripMm: number;
  imageSelection: ImageSelection;
};

export type ZAxisSettings = ZAxisSettingsPayload & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

/** Backend action result for every Z-settings IPC call. */
export type ZAxisSettingsResult =
  | { ok: true; settings: ZAxisSettings }
  | { ok: false; error?: string; message?: string };
