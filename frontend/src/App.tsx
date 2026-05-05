import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import AutoMeasureSettingsDialog from '@/component/own/AutoMeasureSettingsDialog';
import CalibrationDialog from '@/component/own/CalibrationDialog';
import CameraSettingDialog from '@/component/own/CameraSettingDialog';
import LineColorSettingDialog from '@/component/own/LineColorSettingDialog';
import GenericSettingDialog from '@/component/own/GenericSettingDialog';
import OtherSettingDialog from '@/component/own/OtherSettingDialog';
import RestoreFactoryDialog from '@/component/own/RestoreFactoryDialog';
import SerialPortSettingDialog from '@/component/own/SerialPortSettingDialog';
import { useLineColorSetting } from '@/hooks/queries/useLineColorSetting';
import { useSerialPortSetting } from '@/hooks/queries/useSerialPortSetting';
import { useCalibrationSettings } from '@/hooks/queries/useCalibrationSettings';
import { useCalibrations } from '@/hooks/queries/useCalibrations';
import { useAutoMeasureSettings } from '@/hooks/queries/useAutoMeasureSettings';
import { useMachineStateSnapshot } from '@/hooks/queries/useMachineStateSnapshot';
import { useConnectMachine } from '@/hooks/mutations/useConnectMachine';
import { useSaveMeasurement } from '@/hooks/mutations/useSaveMeasurement';
import { getLatestMicrometerReading } from '@/api/getLatestMicrometerReading';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';
import { measureVickersAuto } from '@/api/measureVickersAuto';
import {
  DEFAULT_AUTO_MEASURE_SETTINGS,
  normalizeAutoMeasureSettings,
  type AutoMeasureSettingsPayload,
} from '@/types/autoMeasureSettings';
import { DEFAULT_LINE_COLOR, LINE_COLOR_HEX } from '@/types/lineColorSetting';
import MenuBar from '@/component/own/MenuBar';
import Toolbar from '@/component/own/Toolbar';
import LeftPanel from '@/component/own/LeftPanel';
import type { CameraWindowHandle } from '@/component/own/CameraWindow';
import RightPanel from '@/component/own/RightPanel';
import StatusBar from '@/component/own/StatusBar';
import TestRecordsDialog from '@/component/own/TestRecordsDialog';
import { useSaveToolbarState } from '@/hooks/mutations/useSaveToolbarState';
import { useMeasurements } from '@/hooks/queries/useMeasurements';
import { useToolbarState } from '@/hooks/queries/useToolbarState';
import { useActiveTool } from '@/hooks/useActiveTool';
import { useImageOverlay } from '@/hooks/useImageOverlay';
import { openImageDialog } from '@/api/openImageDialog';
import { saveImageDialog } from '@/api/saveImageDialog';
import { exitApp } from '@/api/exitApp';
import { dispatchToolbarAction, type ToolDispatchContext } from '@/utils/toolDispatcher';
import { dispatchMenuAction } from '@/utils/menuDispatcher';
import type { ToolbarActionId } from '@/types/tool';
import type { ConfigDialogId, MenuActionId } from '@/types/menu';
import type { AutoMeasureCorners, AutoMeasureGraphics } from '@/types/autoMeasure';
import type { ManualMeasureDragResult } from '@/types/manualMeasure';
import {
  calculateVickersFromPixels,
  calculateManualDiagonalsFromPixels,
  normalizeObjectiveName,
  parseForceKgf,
  resolveManualCalibration,
} from '@/utils/manualMeasure';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import DialogContentText from '@mui/material/DialogContentText';
import MuiButton from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';

const ROOT_SX: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  width: '100%',
  overflow: 'hidden',
};

// Workspace = two side-by-side panels:
//   [ LeftPanel ] [ RightPanel ]
const WORKSPACE_SX: SxProps<Theme> = {
  flex: 1,
  display: 'flex',
  flexDirection: 'row',
  minHeight: 0,
  minWidth: 0,
};

async function readLatestMicrometerDepthMm(): Promise<number | null> {
  try {
    const reply = await getLatestMicrometerReading();
    const value = reply.reading?.value ?? null;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

type DialogKey =
  | 'autoMeasure'
  | 'calibration'
  | 'camera'
  | 'generic'
  | 'lineColor'
  | 'other'
  | 'restoreFactory'
  | 'serialPort'
  | 'testRecords'
  | null;

function App() {
  const [activeDialog, setActiveDialog] = useState<DialogKey>(null);
  const [statusMessage, setStatusMessage] = useState('System Status: Ready');
  const [initialTestRecordMeasurementIds, setInitialTestRecordMeasurementIds] = useState<string[]>([]);
  const {
    data: measurements,
    error: measurementsError,
    loading: measurementsLoading,
    refetch: refetchMeasurements,
  } = useMeasurements();
  const {
    data: toolbarState,
    error: toolbarStateError,
    loading: toolbarStateLoading,
    refetch: refetchToolbarState,
  } = useToolbarState();
  const { saveToolbarState } = useSaveToolbarState();
  const { data: lineColorSetting, refetch: refetchLineColor } = useLineColorSetting();
  const { data: calibrationSettings, items: calibrationSettingsList } = useCalibrationSettings();
  const { data: calibrations, refetch: refetchCalibrations } = useCalibrations();
  const { data: autoMeasureSettings, refetch: refetchAutoMeasureSettings } = useAutoMeasureSettings();
  const { data: serialPortSetting } = useSerialPortSetting();
  const { connect: connectMachineFn, disconnect: disconnectMachineFn } = useConnectMachine();
  const { saveMeasurement: saveManualMeasurement } = useSaveMeasurement();
  const { getSnapshot: getMachineStateSnapshot } = useMachineStateSnapshot();
  const restoredToolbarActionRef = useRef(false);
  const manualMeasurementIdRef = useRef<string | null>(null);
  const { activeTool, setActiveTool } = useActiveTool('pointer');
  const overlay = useImageOverlay();
  const cameraRef = useRef<CameraWindowHandle | null>(null);
  const autoMeasureInFlightRef = useRef(false);
  // Latest preview settings that arrived while a detection was in flight.
  // Why: Slider drags fire faster than the native detection completes
  // (~60–200ms). Without coalescing, the user's final slider position can be
  // dropped, leaving the yellow lines fitted to a stale value.
  const autoMeasurePendingPreviewRef = useRef<AutoMeasureSettingsPayload | null>(null);
  const runAutoMeasureRef = useRef<
    ((settingsInput: AutoMeasureSettingsPayload, preview?: boolean) => void) | null
  >(null);
  const [unavailableMsg, setUnavailableMsg] = useState<string | null>(null);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [manualMeasureResetKey, setManualMeasureResetKey] = useState(0);
  const [autoMeasureGraphics, setAutoMeasureGraphics] = useState<AutoMeasureGraphics | null>(null);
  const [autoMeasuring, setAutoMeasuring] = useState(false);
  const [autoMeasurePreviewSettings, setAutoMeasurePreviewSettings] =
    useState<AutoMeasureSettingsPayload>(DEFAULT_AUTO_MEASURE_SETTINGS);
  const [autoMeasureSettingsRevision, setAutoMeasureSettingsRevision] = useState(0);
  const autoMeasurementIdRef = useRef<string | null>(null);

  // Index loaded calibrations by normalized objective so any debugging /
  // future O(1) lookup paths see the same canonical map the lookup helpers
  // use. Logged once per change so stale state is visible in devtools.
  useEffect(() => {
    const map: Record<string, number> = {};
    for (const item of calibrationSettingsList) {
      map[String(item.objective).trim().toUpperCase()] = item.pixelToMicron;
    }
    // eslint-disable-next-line no-console
    console.log('[calibration] loaded map', map);
  }, [calibrationSettingsList]);

  const resetManualMeasure = useCallback(() => {
    manualMeasurementIdRef.current = null;
    setManualMeasureResetKey((current) => current + 1);
  }, []);

  const handleManualMeasurementUpdated = useCallback(
    (result: ManualMeasureDragResult) => {
      void (async () => {
        try {
          const machineState = await getMachineStateSnapshot();
          const timestamp = new Date().toISOString();
          const isNewManualMeasurement = manualMeasurementIdRef.current === null;
          const depthPayload = isNewManualMeasurement
            ? { depthMm: await readLatestMicrometerDepthMm() }
            : {};
          const pixelValues = calculateManualDiagonalsFromPixels(
            result.d1Px,
            result.d2Px,
            1
          );

          if (!pixelValues) {
            setUnavailableMsg('Manual Measure requires valid D1/D2 values greater than 0.');
            return;
          }

          const targetObjective = machineState?.objective ?? null;
          const forceKgf = parseForceKgf(machineState?.force);
          const conversion = calculateVickersFromPixels({
            calibrationSettings,
            calibrations,
            machineState,
            d1Px: result.d1Px,
            d2Px: result.d2Px,
            forceKgf,
            objective: targetObjective,
            targetObjective,
            calibrationSettingsList,
          });

          // eslint-disable-next-line no-console
          console.log('[manual-measure][calibration] activeCalibrationLoaded', {
            objective: targetObjective,
            normalizedObjective: normalizeObjectiveName(targetObjective),
            found: conversion.ok,
            umPerPixel: conversion.ok ? conversion.value.umPerPixel : null,
            reason: conversion.ok ? null : conversion.reason,
          });

          if (!conversion.ok) {
            setUnavailableMsg(conversion.reason);
            setStatusMessage(`System Status: Manual Measure blocked: ${conversion.reason}`);
            return;
          }

          const values = conversion.value;

          // eslint-disable-next-line no-console
          console.log('[manual-measure][converted]', {
            objective: values.objective,
            normalizedObjective: values.normalizedObjective,
            umPerPixel: values.umPerPixel,
            d1Px: values.d1Px,
            d2Px: values.d2Px,
            d1Um: values.d1Um,
            d2Um: values.d2Um,
            averageUm: values.avgDUm,
            averageMm: values.avgDMm,
            forceKgf: values.forceKgf,
            hv: values.hv,
          });

          const saved = await saveManualMeasurement({
            id: manualMeasurementIdRef.current ?? undefined,
            values: {
              d1: values.d1Um,
              d2: values.d2Um,
              d1Px: values.d1Px,
              d2Px: values.d2Px,
              d1Um: values.d1Um,
              d2Um: values.d2Um,
              averageUm: values.avgDUm,
              averageMm: values.avgDMm,
              hv: values.hv,
              micronPerPixel: values.umPerPixel,
              calibrationName: values.calibrationName,
              objective: values.normalizedObjective,
              testForceKgf: values.forceKgf,
              ...depthPayload,
              method: 'Manual',
              unit: 'um',
              timestamp,
            },
          });

          manualMeasurementIdRef.current = saved.id;
          await refetchMeasurements();
          // eslint-disable-next-line no-console
          console.log('[manual-measure] table row updated', {
            id: saved.id,
            method: saved.method,
          });
          setStatusMessage(`System Status: Manual measurement updated: HV ${values.hv}`);
        } catch (err) {
          setUnavailableMsg(
            `Manual Measure failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      })();
    },
    [
      calibrationSettings,
      calibrationSettingsList,
      calibrations,
      getMachineStateSnapshot,
      refetchMeasurements,
      saveManualMeasurement,
    ]
  );

  useEffect(() => {
    setAutoMeasurePreviewSettings(normalizeAutoMeasureSettings(autoMeasureSettings));
  }, [autoMeasureSettings]);

  const handleAutoMeasureSettingsPreviewChange = useCallback((settings: AutoMeasureSettingsPayload) => {
    setAutoMeasurePreviewSettings(normalizeAutoMeasureSettings(settings));
    setAutoMeasureSettingsRevision((current) => current + 1);
  }, []);

  const runAutoMeasure = useCallback((settingsInput: AutoMeasureSettingsPayload, preview = false) => {
    if (autoMeasuring || autoMeasureInFlightRef.current) {
      // Coalesce: remember the latest preview settings so the trailing run
      // after the in-flight detection picks up the user's final slider value.
      // Non-preview (explicit Auto Measure click) is still ignored while busy.
      if (preview) {
        autoMeasurePendingPreviewRef.current = settingsInput;
      }
      return;
    }

    void (async () => {
      const settings = normalizeAutoMeasureSettings(settingsInput);
      if (!preview) {
        autoMeasurementIdRef.current = null;
      }

      autoMeasureInFlightRef.current = true;
      setAutoMeasuring(true);
      setStatusMessage(preview ? 'System Status: Auto Measure preview running' : 'System Status: Auto Measure running');

      try {
        const machineState = await getMachineStateSnapshot();
        // Prefer the live Machine Control objective toggle (10X/40X/etc.) over
        // the static AutoMeasureSettings dialog value — the panel is what the
        // user clicks to switch magnification, so calibration MUST follow it.
        const objectiveForCalibration =
          machineState?.objective?.trim() ? machineState.objective : settings.objectiveForMeasure;
        const machineStateForAuto = machineState
          ? { ...machineState, objective: objectiveForCalibration }
          : null;
        const calibration = resolveManualCalibration({
          calibrationSettings,
          calibrations,
          machineState: machineStateForAuto,
          targetObjective: objectiveForCalibration,
          calibrationSettingsList,
        });
        const forceKgf = parseForceKgf(machineState?.force);
        // eslint-disable-next-line no-console
        console.log('[auto-measure] calibration lookup', {
          machineObjective: machineState?.objective ?? null,
          dialogObjective: settings.objectiveForMeasure,
          resolvedObjective: objectiveForCalibration,
          micronPerPixel: calibration?.micronPerPixel ?? null,
          calibrationName: calibration?.calibrationName ?? null,
          forceKgf,
          availableCalibrations: calibrationSettingsList.map((c) => ({
            objective: c.objective,
            pixelToMicron: c.pixelToMicron,
          })),
        });
        const minConfidence =
          settings.imageType === 'HV-1' ? 0.52 : settings.imageType === 'HV-3' ? 0.38 : 0.45;
        const displayedFrame = cameraRef.current?.captureDisplayedFrame();

        if (!displayedFrame?.ok) {
          if (preview) {
            // Keep last valid overlay; surface only via status/log.
            // eslint-disable-next-line no-console
            console.log('[auto-measure] preview detection failed: no displayed frame');
            setStatusMessage('System Status: Auto Measure preview detection failed');
            return;
          }
          setAutoMeasureGraphics(null);
          setUnavailableMsg('Auto detection not reliable. Please use manual measure.');
          setStatusMessage(`System Status: Auto Measure rejected: ${displayedFrame?.error ?? 'no displayed image'}`);
          return;
        }

        // eslint-disable-next-line no-console
        console.log('[auto-measure] selected settings', settings);

        const result = await measureVickersAuto({
          ...settings,
          frameBuffer: displayedFrame.buffer,
          width: displayedFrame.width,
          height: displayedFrame.height,
          pixelFormat: displayedFrame.pixelFormat,
          bits: displayedFrame.bits,
          source: displayedFrame.source,
          micronPerPixel: calibration?.micronPerPixel ?? null,
          pxPerMm: calibration ? 1000 / calibration.micronPerPixel : null,
          testForceKgf: forceKgf,
          minConfidence,
          timeoutMs: 4000,
          maxFrameAgeMs: 1200,
        });

        // eslint-disable-next-line no-console
        console.log('[auto-measure] result', result);

        if (!result.ok || result.confidence < minConfidence || result.lines.length !== 4) {
          const reason = result.ok ? 'low confidence' : result.reason;
          if (preview) {
            // Preview rejection: keep last valid overlay; do NOT clear or
            // pop the unavailable modal — only update status/log.
            // eslint-disable-next-line no-console
            console.log('[auto-measure] preview detection failed:', reason);
            setStatusMessage(`System Status: Auto Measure preview detection failed: ${reason}`);
            return;
          }
          setAutoMeasureGraphics(null);
          setStatusMessage(`System Status: Auto Measure rejected: ${reason}`);
          setUnavailableMsg('Auto detection not reliable. Please use manual measure.');
          return;
        }

        setAutoMeasureGraphics({
          corners: result.corners,
          lines: result.lines,
        });

        const timestamp = new Date().toISOString();
        const depthMm = await readLatestMicrometerDepthMm();

        const conversion = calculateVickersFromPixels({
          calibrationSettings,
          calibrationSettingsList,
          calibrations,
          d1Px: result.d1Pixels,
          d2Px: result.d2Pixels,
          forceKgf,
          machineState: machineStateForAuto,
          objective: objectiveForCalibration,
          targetObjective: objectiveForCalibration,
        });

        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure][calibration] activeObjective=${objectiveForCalibration} normalized=${normalizeObjectiveName(objectiveForCalibration)}`
        );
        // eslint-disable-next-line no-console
        console.log('[auto-measure][calibration]', {
          found: conversion.ok,
          umPerPixel: conversion.ok ? conversion.value.umPerPixel : null,
          reason: conversion.ok ? null : conversion.reason,
        });
        // eslint-disable-next-line no-console
        console.log(
          `[objective][measure] using objective=${normalizeObjectiveName(objectiveForCalibration)} umPerPixel=${
            conversion.ok ? conversion.value.umPerPixel : 'n/a'
          }`
        );

        if (!conversion.ok) {
          setUnavailableMsg(conversion.reason);
          setStatusMessage(`System Status: Auto Measure blocked: ${conversion.reason}`);
          return;
        }

        const values = conversion.value;

        // eslint-disable-next-line no-console
        console.log('[auto-measure][diagonal]', { d1Px: values.d1Px, d2Px: values.d2Px });
        // eslint-disable-next-line no-console
        console.log('[auto-measure][converted]', {
          d1Um: values.d1Um,
          d2Um: values.d2Um,
          d1Mm: values.d1Mm,
          d2Mm: values.d2Mm,
          avgDUm: values.avgDUm,
          avgDMm: values.avgDMm,
        });
        // eslint-disable-next-line no-console
        console.log('[auto-measure][hv]', {
          forceKgf: values.forceKgf,
          avgDmm: values.avgDMm,
          hv: values.hv,
        });

        const saved = await saveManualMeasurement({
          id: autoMeasurementIdRef.current ?? undefined,
          values: {
            d1: values.d1Um,
            d2: values.d2Um,
            d1Px: values.d1Px,
            d2Px: values.d2Px,
            d1Um: values.d1Um,
            d2Um: values.d2Um,
            averageUm: values.avgDUm,
            averageMm: values.avgDMm,
            hv: values.hv,
            micronPerPixel: values.umPerPixel,
            calibrationName: values.calibrationName,
            objective: values.normalizedObjective,
            testForceKgf: values.forceKgf,
            depthMm,
            method: 'Auto',
            unit: 'um',
            timestamp,
          },
        });

        autoMeasurementIdRef.current = saved.id;
        await refetchMeasurements();
        setStatusMessage(
          saved.hv
            ? `System Status: Auto measurement ${preview ? 'updated' : 'added'}: HV ${saved.hv}`
            : `System Status: Auto measurement ${preview ? 'updated' : 'added'}: ${values.d1Um} µm / ${values.d2Um} µm`
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[auto-measure] failed:', err);
        if (preview) {
          // Preview-time exception: keep overlay, just log + status.
          setStatusMessage('System Status: Auto Measure preview detection failed');
        } else {
          setAutoMeasureGraphics(null);
          setUnavailableMsg('Auto detection not reliable. Please use manual measure.');
        }
      } finally {
        autoMeasureInFlightRef.current = false;
        setAutoMeasuring(false);
        // Drain coalesced preview: if a slider tick arrived while we were
        // running, fire one more pass with the latest settings so the user's
        // final position always wins.
        const pending = autoMeasurePendingPreviewRef.current;
        if (pending) {
          autoMeasurePendingPreviewRef.current = null;
          window.setTimeout(() => runAutoMeasureRef.current?.(pending, true), 0);
        }
      }
    })();
  }, [
    autoMeasuring,
    calibrationSettings,
    calibrationSettingsList,
    calibrations,
    getMachineStateSnapshot,
    refetchMeasurements,
    saveManualMeasurement,
  ]);

  // Keep a ref to the latest runAutoMeasure so the in-flight finally block
  // can schedule a coalesced trailing run without depending on itself.
  useEffect(() => {
    runAutoMeasureRef.current = runAutoMeasure;
  }, [runAutoMeasure]);

  const handleAutoMeasure = useCallback(() => {
    runAutoMeasure(autoMeasurePreviewSettings, false);
  }, [autoMeasurePreviewSettings, runAutoMeasure]);

  // Live recompute when the user drags edges/corners on the auto-measure
  // overlay. We coalesce rapid drag events with a 90ms trailing debounce so
  // the DB save and refetch don't fire 60×/sec while we still update the
  // overlay/graphics in real time on every move.
  const adjustSaveTimerRef = useRef<number | null>(null);
  const lastAdjustedCornersRef = useRef<AutoMeasureCorners | null>(null);
  const handleAutoMeasureAdjusted = useCallback(
    (newCorners: AutoMeasureCorners) => {
      lastAdjustedCornersRef.current = newCorners;
      // Update graphics immediately so the overlay & any downstream readers
      // see the new corners on the next frame.
      setAutoMeasureGraphics((current) =>
        current ? { ...current, corners: newCorners } : current
      );

      if (adjustSaveTimerRef.current !== null) {
        window.clearTimeout(adjustSaveTimerRef.current);
      }
      adjustSaveTimerRef.current = window.setTimeout(() => {
        adjustSaveTimerRef.current = null;
        const corners = lastAdjustedCornersRef.current;
        if (!corners) return;
        void (async () => {
          try {
            const settings = normalizeAutoMeasureSettings(autoMeasureSettings);
            const machineState = await getMachineStateSnapshot();
            const objectiveForCalibration =
              machineState?.objective?.trim() ? machineState.objective : settings.objectiveForMeasure;
            const machineStateForAuto = machineState
              ? { ...machineState, objective: objectiveForCalibration }
              : null;
            const forceKgf = parseForceKgf(machineState?.force);

            const d1Px = Math.hypot(
              corners.right.x - corners.left.x,
              corners.right.y - corners.left.y
            );
            const d2Px = Math.hypot(
              corners.bottom.x - corners.top.x,
              corners.bottom.y - corners.top.y
            );

            const targetId = autoMeasurementIdRef.current ?? undefined;
            const timestamp = new Date().toISOString();

            const conversion = calculateVickersFromPixels({
              calibrationSettings,
              calibrationSettingsList,
              calibrations,
              d1Px,
              d2Px,
              forceKgf,
              machineState: machineStateForAuto,
              objective: objectiveForCalibration,
              targetObjective: objectiveForCalibration,
            });
            if (!conversion.ok) {
              setUnavailableMsg(conversion.reason);
              setStatusMessage(`System Status: Auto (Adjusted) blocked: ${conversion.reason}`);
              return;
            }
            const values = conversion.value;

            // eslint-disable-next-line no-console
            console.log('[auto-measure] adjusted recompute', {
              machineObjective: machineState?.objective ?? null,
              dialogObjective: settings.objectiveForMeasure,
              resolvedObjective: objectiveForCalibration,
              micronPerPixel: values.umPerPixel,
              d1Px: values.d1Px,
              d2Px: values.d2Px,
              d1Um: values.d1Um,
              d2Um: values.d2Um,
              averageUm: values.avgDUm,
              averageMm: values.avgDMm,
              forceKgf: values.forceKgf,
              hv: values.hv,
              corners,
            });

            const saved = await saveManualMeasurement({
              id: targetId,
              values: {
                d1: values.d1Um,
                d2: values.d2Um,
                d1Px: values.d1Px,
                d2Px: values.d2Px,
                d1Um: values.d1Um,
                d2Um: values.d2Um,
                averageUm: values.avgDUm,
                averageMm: values.avgDMm,
                hv: values.hv,
                micronPerPixel: values.umPerPixel,
                calibrationName: values.calibrationName,
                objective: values.normalizedObjective,
                testForceKgf: values.forceKgf,
                method: 'Auto (Adjusted)',
                unit: 'um',
                timestamp,
              },
            });
            autoMeasurementIdRef.current = saved.id;
            await refetchMeasurements();
            setStatusMessage(
              saved.hv
                ? `System Status: Auto (Adjusted) updated: HV ${saved.hv}`
                : `System Status: Auto (Adjusted) updated: ${values.d1Um} µm / ${values.d2Um} µm`
            );
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[auto-measure] adjust save failed:', err);
          }
        })();
      }, 90);
    },
    [
      autoMeasureSettings,
      calibrationSettings,
      calibrationSettingsList,
      calibrations,
      getMachineStateSnapshot,
      refetchMeasurements,
      saveManualMeasurement,
    ]
  );

  useEffect(() => {
    return () => {
      if (adjustSaveTimerRef.current !== null) {
        window.clearTimeout(adjustSaveTimerRef.current);
      }
    };
  }, []);

  // Auto Measure Settings dialog drives a live re-fit of the yellow lines on
  // the camera image. ANY change to image type / erosion / dilation / factor /
  // objective triggers a fresh detection so the user can dial in the sliders
  // until the lines snap to the true diamond corners.
  useEffect(() => {
    if (activeDialog !== 'autoMeasure') {
      return;
    }

    // Fire an immediate preview when the dialog opens (revision === 0) and
    // again after every settings change (revision bumps), with a short debounce
    // so dragging a slider doesn't fire 60×/sec.
    const delay = autoMeasureSettingsRevision === 0 ? 0 : 40;
    const timer = window.setTimeout(() => {
      // eslint-disable-next-line no-console
      console.log('[auto-measure] settings preview re-fit', {
        revision: autoMeasureSettingsRevision,
        imageType: autoMeasurePreviewSettings.imageType,
        erosion: autoMeasurePreviewSettings.erosion,
        dilation: autoMeasurePreviewSettings.dilation,
        factor: autoMeasurePreviewSettings.factor,
        objectiveForMeasure: autoMeasurePreviewSettings.objectiveForMeasure,
      });
      runAutoMeasure(autoMeasurePreviewSettings, true);
    }, delay);

    return () => window.clearTimeout(timer);
  }, [activeDialog, autoMeasurePreviewSettings, autoMeasureSettingsRevision, runAutoMeasure]);

  const buildSharedCtx = useCallback(
    (): ToolDispatchContext => ({
      setActiveTool,
      setStatus: (message) => setStatusMessage(`System Status: ${message}`),
      notifyUnavailable: (label) =>
        setUnavailableMsg(`${label} is not available yet.`),
      clearGraphics: () => {
        overlay.clearAll();
        setAutoMeasureGraphics(null);
        autoMeasurementIdRef.current = null;
        resetManualMeasure();
      },
      autoMeasure: handleAutoMeasure,
      trimLastMeasurement: overlay.trimLast,
      toggleCenterCrossLine: overlay.toggleCrossLine,
      resumeImage: () => {
        const nowFrozen = cameraRef.current?.toggleFreeze() ?? false;
        setStatusMessage(`System Status: Image ${nowFrozen ? 'frozen' : 'resumed'}`);
      },
      zoomIn: () => {
        const z = cameraRef.current?.zoomIn() ?? 1;
        setStatusMessage(`System Status: Zoom ${Math.round(z * 100)}%`);
      },
      zoomOut: () => {
        const z = cameraRef.current?.zoomOut() ?? 1;
        setStatusMessage(`System Status: Zoom ${Math.round(z * 100)}%`);
      },
      openImage: () => {
        void (async () => {
          try {
            // eslint-disable-next-line no-console
            console.log('[ipc] dialog:openImage →');
            const reply = await openImageDialog();
            // eslint-disable-next-line no-console
            console.log('[ipc] dialog:openImage ←', { ok: reply.ok });
            if (!reply.ok) {
              if (!reply.canceled) {
                setUnavailableMsg(
                  `Open Image failed: ${reply.error}${reply.message ? `: ${reply.message}` : ''}`
                );
              }
              return;
            }
            const loaded = await cameraRef.current?.loadImageFromBuffer(reply.buffer);
            if (loaded?.ok) {
              resetManualMeasure();
              setAutoMeasureGraphics(null);
              autoMeasurementIdRef.current = null;
              setStatusMessage(`System Status: Loaded ${reply.fileName}`);
            } else {
              setUnavailableMsg(
                `Open Image failed: ${loaded?.error ?? 'unable to render'}`
              );
            }
          } catch (err) {
            setUnavailableMsg(
              `Open Image failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        })();
      },
      saveImage: () => {
        void (async () => {
          try {
            // eslint-disable-next-line no-console
            console.log('[ipc] dialog:saveImage →');
            const reply = await saveImageDialog({
              defaultName: `hardness-${Date.now()}.png`,
            });
            // eslint-disable-next-line no-console
            console.log('[ipc] dialog:saveImage ←', { ok: reply.ok });
            if (!reply.ok) return;
            const blob = await cameraRef.current?.exportImageBlob('image/png');
            if (!blob) {
              setUnavailableMsg('Save Image failed: no image to save');
              return;
            }
            const buf = await blob.arrayBuffer();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([buf], { type: 'image/png' }));
            a.download = reply.fileName;
            a.click();
            URL.revokeObjectURL(a.href);
            setStatusMessage(`System Status: Image saved as ${reply.fileName}`);
          } catch (err) {
            setUnavailableMsg(
              `Save Image failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        })();
      },
      openCameraDevice: () => {
        void (async () => {
          try {
            // eslint-disable-next-line no-console
            console.log('[ipc] device:open →');
            const reply = await window.hardnessCamera.openDevice({ index: 0 });
            // eslint-disable-next-line no-console
            console.log('[ipc] device:open ←', reply);
            await cameraRef.current?.refetchStatus();
            if (!reply.camera.connected) {
              setUnavailableMsg(
                `Open Camera failed: ${reply.camera.error ?? reply.camera.message ?? 'unknown error'}`
              );
              return;
            }
            if (!reply.camera.streaming) {
              setUnavailableMsg(
                `Start Stream failed: ${reply.camera.error ?? reply.camera.message ?? 'unknown error'}`
              );
              return;
            }
            setStatusMessage('System Status: Camera streaming');

            // Surface micrometer outcome (COM3 open is performed inside the
            // device:open main handler — never on app startup).
            if (reply.micrometer) {
              if (reply.micrometer.connected) {
                setStatusMessage(
                  `System Status: Micrometer connected on ${reply.micrometer.port}`
                );
              } else {
                setUnavailableMsg(
                  `Micrometer (${reply.micrometer.port}) failed: ${
                    reply.micrometer.error ?? reply.micrometer.message ?? 'unknown error'
                  }`
                );
              }
            }

            // Best-effort: also open the hardness machine COM port. Defaults
            // to COM7 (the wired-in port for this machine) if the user hasn't
            // configured one via Serial Port settings. Failure here must NOT
            // break the camera/micrometer flow.
            // Hardness machine is wired to COM7 on this PC. The
            // serial-port-setting record's mainPortName is used by the XYZ
            // platform / micrometer flow, not the machine, so we do NOT read
            // from it here. If the COM port ever changes, update this literal.
            const machinePort = 'COM7';
            void serialPortSetting;
            try {
              // eslint-disable-next-line no-console
              console.log('[machine-main] connect requested', machinePort);
              await connectMachineFn({ port: machinePort });
              setStatusMessage(`System Status: Machine connected on ${machinePort}`);
            } catch (mErr) {
              // eslint-disable-next-line no-console
              console.warn('[machine-main] connect failed:', mErr);
              const detail = getApiErrorMessage(mErr, 'unknown error');
              setUnavailableMsg(`Machine connect failed on ${machinePort}: ${detail}`);
            }
          } catch (err) {
            setUnavailableMsg(
              `Open Device failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        })();
      },
      closeCameraDevice: () => {
        void (async () => {
          try {
            // eslint-disable-next-line no-console
            console.log('[ipc] device:close →');
            const reply = await window.hardnessCamera.closeDevice();
            // eslint-disable-next-line no-console
            console.log('[ipc] device:close ←', reply);
            // Always sync status + clear the last painted frame so the user
            // sees the camera is actually closed.
            await cameraRef.current?.refetchStatus();
            cameraRef.current?.clearLiveCanvas();
            setAutoMeasureGraphics(null);
            autoMeasurementIdRef.current = null;
            resetManualMeasure();
            setStatusMessage('System Status: Device closed');
            void reply;

            // Best-effort machine disconnect — never block close flow.
            try {
              await disconnectMachineFn();
            } catch (mErr) {
              // eslint-disable-next-line no-console
              console.warn('[machine-main] disconnect failed:', mErr);
            }
          } catch (err) {
            setUnavailableMsg(
              `Close Device failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        })();
      },
    }),
    [
      overlay.clearAll,
      overlay.trimLast,
      overlay.toggleCrossLine,
      resetManualMeasure,
      handleAutoMeasure,
      setActiveTool,
      serialPortSetting,
      connectMachineFn,
      disconnectMachineFn,
    ]
  );

  const testRecordMeasurementIds = useMemo(() => {
    if (initialTestRecordMeasurementIds.length > 0) {
      return initialTestRecordMeasurementIds;
    }

    return measurements.map((measurement) => measurement.id);
  }, [initialTestRecordMeasurementIds, measurements]);

  const closeDialog = useCallback(() => {
    setActiveDialog(null);
    setInitialTestRecordMeasurementIds([]);
  }, []);

  const openConfigDialog = useCallback((id: ConfigDialogId) => {
    const map: Record<ConfigDialogId, DialogKey> = {
      'config:lineColor': 'lineColor',
      'config:calibration': 'calibration',
      'config:autoMeasure': 'autoMeasure',
      'config:serialPort': 'serialPort',
      'config:camera': 'camera',
      'config:generic': 'generic',
      'config:other': 'other',
      'config:restoreFactory': 'restoreFactory',
    };
    setActiveDialog(map[id]);
  }, []);

  const handleMenuSelect = useCallback(
    (action: MenuActionId) => {
      dispatchMenuAction(action, {
        ...buildSharedCtx(),
        openConfigDialog,
        openSampleInfo: () => {
          setInitialTestRecordMeasurementIds([]);
          setActiveDialog('testRecords');
        },
        exitApplication: () => setExitConfirmOpen(true),
      });
    },
    [buildSharedCtx, openConfigDialog]
  );

  const handleToolbarSelect = useCallback(
    (action: ToolbarActionId) => {
      // eslint-disable-next-line no-console
      console.log('[toolbar] click', action);
      dispatchToolbarAction(action, buildSharedCtx());
      void (async () => {
        try {
          await saveToolbarState({
            id: toolbarState?.id,
            values: { lastAction: action },
          });
          await refetchToolbarState();
        } catch {
          // error surfaces via useSaveToolbarState's own error state
        }
      })();
    },
    [buildSharedCtx, refetchToolbarState, saveToolbarState, toolbarState?.id]
  );


  useEffect(() => {
    const hex = LINE_COLOR_HEX[lineColorSetting?.lineColor ?? DEFAULT_LINE_COLOR];
    document.documentElement.style.setProperty('--line-color', hex);
  }, [lineColorSetting?.lineColor]);

  useEffect(() => {
    if (toolbarStateLoading || restoredToolbarActionRef.current) {
      return;
    }

    restoredToolbarActionRef.current = true;

    if (toolbarStateError) {
      setStatusMessage(`System Status: ${toolbarStateError}`);
      return;
    }

    if (toolbarState) {
      setStatusMessage(`System Status: Last toolbar action: ${toolbarState.lastAction}`);
    }
  }, [toolbarState, toolbarStateError, toolbarStateLoading]);

  const handleOpenTestRecords = useCallback((measurementIds: string[]) => {
    setInitialTestRecordMeasurementIds(measurementIds);
    setActiveDialog('testRecords');
    setStatusMessage('System Status: Test Records opened');
  }, []);

  return (
    <Box sx={ROOT_SX}>
      <MenuBar onSelect={handleMenuSelect} />
      <Toolbar activeTool={activeTool} onSelect={handleToolbarSelect} />

      <Box sx={WORKSPACE_SX}>
        <LeftPanel
          ref={cameraRef}
          activeTool={activeTool}
          overlayShapes={overlay.shapes}
          autoMeasureGraphics={autoMeasureGraphics}
          crossLineVisible={overlay.crossLineVisible}
          onAddShape={overlay.addShape}
          manualMeasureResetKey={manualMeasureResetKey}
          onManualMeasurementUpdated={handleManualMeasurementUpdated}
          onAutoMeasureAdjusted={handleAutoMeasureAdjusted}
        />
        <RightPanel
          measurements={measurements}
          measurementsError={measurementsError}
          measurementsLoading={measurementsLoading}
          refetchMeasurements={refetchMeasurements}
          onOpenTestRecords={handleOpenTestRecords}
        />
      </Box>

      <StatusBar message={statusMessage} />

      <AutoMeasureSettingsDialog
        open={activeDialog === 'autoMeasure'}
        onClose={closeDialog}
        onPreviewChange={handleAutoMeasureSettingsPreviewChange}
        onSaved={() => {
          void refetchAutoMeasureSettings();
        }}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
      />
      <CalibrationDialog
        open={activeDialog === 'calibration'}
        onClose={closeDialog}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
        onChanged={() => {
          void refetchCalibrations();
        }}
      />
      <LineColorSettingDialog
        open={activeDialog === 'lineColor'}
        onClose={closeDialog}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
        onSaved={() => {
          void refetchLineColor();
        }}
      />
      <SerialPortSettingDialog
        open={activeDialog === 'serialPort'}
        onClose={closeDialog}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
      />
      <CameraSettingDialog
        open={activeDialog === 'camera'}
        onClose={closeDialog}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
      />
      <GenericSettingDialog
        open={activeDialog === 'generic'}
        onClose={closeDialog}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
      />
      <OtherSettingDialog
        open={activeDialog === 'other'}
        onClose={closeDialog}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
      />
      <RestoreFactoryDialog
        open={activeDialog === 'restoreFactory'}
        onClose={closeDialog}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
        onRestored={() => {
          void refetchLineColor();
          void refetchMeasurements();
          void refetchToolbarState();
        }}
      />
      <Dialog
        open={exitConfirmOpen}
        onClose={() => setExitConfirmOpen(false)}
      >
        <DialogTitle>Exit Hardness Tester?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Any unsaved measurements will be lost. Continue?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <MuiButton onClick={() => setExitConfirmOpen(false)}>Cancel</MuiButton>
          <MuiButton
            color="error"
            variant="contained"
            onClick={() => {
              // eslint-disable-next-line no-console
              console.log('[ipc] app:exit →');
              void exitApp().catch((err) => {
                setExitConfirmOpen(false);
                setUnavailableMsg(
                  `Exit failed: ${err instanceof Error ? err.message : String(err)}`
                );
              });
            }}
          >
            Exit
          </MuiButton>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={unavailableMsg !== null}
        autoHideDuration={unavailableMsg?.startsWith('Calibration not found') ? null : 3000}
        onClose={() => setUnavailableMsg(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity="warning"
          variant="filled"
          onClose={() => setUnavailableMsg(null)}
          action={
            unavailableMsg?.startsWith('Calibration not found') ? (
              <MuiButton
                color="inherit"
                size="small"
                onClick={() => {
                  setUnavailableMsg(null);
                  setActiveDialog('calibration');
                }}
              >
                Go to Calibration
              </MuiButton>
            ) : undefined
          }
          sx={{ width: '100%' }}
        >
          {unavailableMsg}
        </Alert>
      </Snackbar>

      <TestRecordsDialog
        open={activeDialog === 'testRecords'}
        onClose={closeDialog}
        measurements={measurements}
        initialMeasurementIds={testRecordMeasurementIds}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
      />
    </Box>
  );
}

export default App;
