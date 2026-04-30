import type { SaveImageRequest, SaveImageResult } from '@/types/dialog';

export function saveImageDialog(payload: SaveImageRequest = {}): Promise<SaveImageResult> {
  return window.api.invoke('dialog:saveImage', payload);
}
