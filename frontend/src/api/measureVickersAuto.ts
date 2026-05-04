import type {
  VickersAutoMeasureParameters,
  VickersAutoMeasureResult,
} from '@/types/autoMeasure';

export function measureVickersAuto(
  parameters: VickersAutoMeasureParameters
): Promise<VickersAutoMeasureResult> {
  return window.api.invoke('camera:measure-vickers-auto', parameters);
}
