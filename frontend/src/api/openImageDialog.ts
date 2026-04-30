import type { OpenImageResult } from '@/types/dialog';

export function openImageDialog(): Promise<OpenImageResult> {
  return window.api.invoke('dialog:openImage');
}
