import type {
  VickersAutoMeasureParameters,
  VickersAutoMeasureResult,
} from '@/types/autoMeasure';

export function measureVickersAuto(
  parameters: VickersAutoMeasureParameters
): Promise<VickersAutoMeasureResult> {
  return window.api.invoke('camera:measure-vickers-auto', parameters);
}

export function measureVickersAutoPreview(
  parameters: VickersAutoMeasureParameters
): Promise<VickersAutoMeasureResult> {
  return measureVickersAuto(parameters);
}
