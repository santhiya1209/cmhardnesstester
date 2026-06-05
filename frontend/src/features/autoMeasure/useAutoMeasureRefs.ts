import { useRef } from 'react';
import {
  DEFAULT_AUTO_MEASURE_SETTINGS,
  type AutoMeasureSettingsPayload,
} from '@/types/autoMeasureSettings';
import type {
  AutoMeasureDetectionSnapshot,
  CapturedAutoMeasureFrame,
  RunAutoMeasure,
} from '@/features/autoMeasure/autoMeasureHelpers';

/**
 * Single owner for the auto-measure coordination refs that used to be declared
 * loose in App: in-flight gates, the preview pipeline snapshots, and the
 * session/measurement id handles read across the auto-measure flow. Bundling
 * the declarations in one domain module keeps App from owning them directly;
 * behavior is unchanged since these are the same mutable ref objects.
 */
export interface AutoMeasureRefs {
  autoMeasureInFlightRef: React.MutableRefObject<boolean>;
  autoMeasurePendingPreviewRef: React.MutableRefObject<AutoMeasureSettingsPayload | null>;
  latestAutoMeasurePreviewSettingsRef: React.MutableRefObject<AutoMeasureSettingsPayload>;
  runAutoMeasureRef: React.MutableRefObject<RunAutoMeasure | null>;
  autoMeasurePreviewSnapshotRef: React.MutableRefObject<AutoMeasureDetectionSnapshot | null>;
  committedAutoMeasureFrameRef: React.MutableRefObject<CapturedAutoMeasureFrame | null>;
  previewMeasurementRef: React.MutableRefObject<
    { d1Pixels: number; d2Pixels: number; confidence: number } | null
  >;
  autoMeasureSettingsOpenRef: React.MutableRefObject<boolean>;
  autoMeasureClickCountRef: React.MutableRefObject<number>;
  autoMeasurementIdRef: React.MutableRefObject<string | null>;
  autoMeasureSessionIdRef: React.MutableRefObject<number>;
  suppressAutoMeasurePreviewRef: React.MutableRefObject<boolean>;
}

export function useAutoMeasureRefs(): AutoMeasureRefs {
  const autoMeasureInFlightRef = useRef(false);
  const autoMeasurePendingPreviewRef = useRef<AutoMeasureSettingsPayload | null>(null);
  const latestAutoMeasurePreviewSettingsRef = useRef<AutoMeasureSettingsPayload>(
    DEFAULT_AUTO_MEASURE_SETTINGS
  );
  const runAutoMeasureRef = useRef<RunAutoMeasure | null>(null);
  const autoMeasurePreviewSnapshotRef = useRef<AutoMeasureDetectionSnapshot | null>(null);
  const committedAutoMeasureFrameRef = useRef<CapturedAutoMeasureFrame | null>(null);
  const previewMeasurementRef = useRef<
    { d1Pixels: number; d2Pixels: number; confidence: number } | null
  >(null);
  const autoMeasureSettingsOpenRef = useRef(false);
  const autoMeasureClickCountRef = useRef(0);
  const autoMeasurementIdRef = useRef<string | null>(null);
  const autoMeasureSessionIdRef = useRef(0);
  const suppressAutoMeasurePreviewRef = useRef(false);

  return {
    autoMeasureInFlightRef,
    autoMeasurePendingPreviewRef,
    latestAutoMeasurePreviewSettingsRef,
    runAutoMeasureRef,
    autoMeasurePreviewSnapshotRef,
    committedAutoMeasureFrameRef,
    previewMeasurementRef,
    autoMeasureSettingsOpenRef,
    autoMeasureClickCountRef,
    autoMeasurementIdRef,
    autoMeasureSessionIdRef,
    suppressAutoMeasurePreviewRef,
  };
}
