export type OpenImageResult =
  | {
      ok: true;
      canceled: false;
      filePath: string;
      fileName: string;
      size: number;
      buffer: ArrayBufferLike;
    }
  | { ok: false; canceled: true }
  | { ok: false; canceled: false; error: string; message?: string };

export type SaveImageRequest = { defaultName?: string };

export type SaveImageResult =
  | { ok: true; canceled: false; filePath: string; fileName: string }
  | { ok: false; canceled: true };

export type SaveReportRequest = {
  defaultName: string;
  bytes: Uint8Array | ArrayBuffer;
  autoOpen?: boolean;
};

export type SaveReportResult =
  | {
      ok: true;
      canceled: false;
      filePath: string;
      fileName: string;
      opened: boolean;
      openError: string | null;
    }
  | { ok: false; canceled: true }
  | { ok: false; canceled: false; error: string; message?: string; filePath?: string };
