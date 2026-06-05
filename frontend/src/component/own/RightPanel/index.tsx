import { memo, useCallback, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import type { SxProps, Theme } from '@mui/material/styles';
import { useAlbumItems } from '@/hooks/queries/useAlbumItems';
import { usePatternPrograms } from '@/hooks/queries/usePatternPrograms';
import type { AlbumItem } from '@/types/albumItem';
import type { Measurement } from '@/types/measurement';
import type { PatternProgram } from '@/types/patternProgram';
import type { ToolId, ToolbarActionId, MeasureSelection } from '@/types/tool';
import { tokens } from '@/theme/theme';
import { useRenderCount } from '@/utils/renderStats';

import MeasurementsWorkspace, { type MeasurementDisplayValues } from './MeasurementsWorkspace';
import MachineControlTab from './MachineControlTab';
import XYZPlatformTab from './XYZPlatformTab';
import MultipointTab from './MultipointTab';
import PatternListTab from './PatternListTab';
import StatisticsInfoTab from './StatisticsInfoTab';
import AlbumTab from './AlbumTab';
import DepthImageTab from './DepthImageTab';
import TrimMeasurePanel, { type TrimCorner } from '@/component/own/TrimMeasurePanel';

type ObjectiveCommitSource = 'ack';

const TAB_ITEMS = [
  'Machine Control',
  'XYZ Platform Control',
  'Multipoint',
  'Pattern List',
  'Statistics Info',
  'Album',
  'Depth Image',
];

const PANEL_SX: SxProps<Theme> = {
  flex: 1,
  minWidth: 0,
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  bgcolor: 'background.paper',
  borderLeft: 1,
  borderColor: 'divider',
  overflow: 'hidden',
};

const TABS_SX: SxProps<Theme> = {
  minHeight: 38,
  borderBottom: 1,
  borderColor: 'divider',
  bgcolor: 'background.paper',
  px: 0.5,
  '& .MuiTabs-indicator': {
    backgroundColor: tokens.accentSecondary.base,
    height: 2,
    borderRadius: '2px 2px 0 0',
  },
  '& .MuiTab-root': {
    minHeight: 38,
    py: 0.5,
    px: 1.75,
    fontSize: 12,
    fontWeight: 500,
    textTransform: 'none',
    color: 'text.secondary',
    transition: 'color 160ms ease',
    '&:hover': {
      color: tokens.accentSecondary.base,
      backgroundColor: 'transparent',
    },
    '&.Mui-selected': {
      color: tokens.accentSecondary.base,
      fontWeight: 600,
    },
  },
  '& .MuiTabs-scrollButtons': {
    color: 'text.secondary',
    '&.Mui-disabled': { opacity: 0.35 },
  },
};

type TabContentProps = {
  measurements: Measurement[];
  patternPrograms: PatternProgram[];
  patternProgramsError: string | null;
  patternProgramsLoading: boolean;
  refetchPatternPrograms: () => Promise<void>;
  albumItems: AlbumItem[];
  refetchAlbumItems: () => Promise<void>;
  measurementDisplay: MeasurementDisplayValues;
  activeObjective?: string | null;
  onObjectiveChange?: (objective: '10X' | '40X', source: ObjectiveCommitSource) => void;
  onCenterCommit?: () => void;
  onTurretIntent?: () => void;
  onObjectiveChangeIntent?: (target: '10X' | '40X') => void;
  onToolbarAction?: (action: ToolbarActionId) => void;
  activeTool?: ToolId;
  selectedMeasureMode?: MeasureSelection;
  cameraReady?: boolean;
  micrometerEnabled: boolean;
  targetMinHv: number | null;
  targetMaxHv: number | null;
  chdTargetInput: string;
  onChdTargetInputChange: (value: string) => void;
};

function renderTab(
  tab: number,
  {
    measurements,
    patternPrograms,
    patternProgramsError,
    patternProgramsLoading,
    refetchPatternPrograms,
    albumItems,
    refetchAlbumItems,
    measurementDisplay,
    activeObjective,
    onObjectiveChange,
    onCenterCommit,
    onTurretIntent,
    onObjectiveChangeIntent,
    onToolbarAction,
    selectedMeasureMode,
    micrometerEnabled,
    targetMinHv,
    targetMaxHv,
    chdTargetInput,
    onChdTargetInputChange,
  }: TabContentProps
) {
  switch (tab) {
    case 0:
      return (
        <MachineControlTab
          hvDisplay={measurementDisplay.hvDisplay}
          hvTypeValue={measurementDisplay.hvType}
          hardnessValue={measurementDisplay.hardnessValue}
          hvTargetColor={measurementDisplay.hvTargetColor}
          hardnessQualified={measurementDisplay.qualified}
          measurementTimestamp={measurementDisplay.timestamp}
          convertDisabled={measurementDisplay.convertDisabled}
          convertOptions={measurementDisplay.convertOptions}
          onConvertTypeChange={measurementDisplay.onConvertTypeChange}
          activeObjective={activeObjective}
          onObjectiveChange={onObjectiveChange}
          onCenterCommit={onCenterCommit}
          onTurretIntent={onTurretIntent}
          onObjectiveChangeIntent={onObjectiveChangeIntent}
          onToolbarAction={onToolbarAction}
          selectedMeasureMode={selectedMeasureMode}
          micrometerEnabled={micrometerEnabled}
        />
      );
    case 1: return <XYZPlatformTab />;
    case 2:
      return (
        <MultipointTab
          patternPrograms={patternPrograms}
          patternProgramsError={patternProgramsError}
          patternProgramsLoading={patternProgramsLoading}
          refetchPatternPrograms={refetchPatternPrograms}
        />
      );
    case 3:
      return (
        <PatternListTab
          patternPrograms={patternPrograms}
          patternProgramsError={patternProgramsError}
          patternProgramsLoading={patternProgramsLoading}
          refetchPatternPrograms={refetchPatternPrograms}
        />
      );
    case 4:
      return (
        <StatisticsInfoTab
          measurements={measurements}
          targetMinHv={targetMinHv}
          targetMaxHv={targetMaxHv}
        />
      );
    case 5:
      return <AlbumTab measurements={measurements} />;
    case 6:
      return (
        <DepthImageTab
          albumItemCount={albumItems.length}
          onAlbumChanged={refetchAlbumItems}
          measurements={measurements}
          chdTargetInput={chdTargetInput}
          onChdTargetInputChange={onChdTargetInputChange}
        />
      );
    default: return null;
  }
}

type Props = {
  measurements: Measurement[];
  measurementsError: string | null;
  measurementsLoading: boolean;
  refetchMeasurements: () => Promise<void>;
  onOpenTestRecords: (measurementIds: string[]) => void;
  onMeasurementsCleared?: () => void;
  activeObjective?: string | null;
  onObjectiveChange?: (objective: '10X' | '40X', source: ObjectiveCommitSource) => void;
  onCenterCommit?: () => void;
  onTurretIntent?: () => void;
  onObjectiveChangeIntent?: (target: '10X' | '40X') => void;
  onToolbarAction?: (action: ToolbarActionId) => void;
  activeTool?: ToolId;
  selectedMeasureMode?: MeasureSelection;
  cameraReady?: boolean;
  trimMeasureOpen: boolean;
  onCloseTrimMeasure: () => void;
  onTrimAdjust: (corner: TrimCorner, dx: number, dy: number) => void;
  calibrationActive?: boolean;
  /**
   * Calibration controls. Rendered as the right-panel content when the
   * calibration screen is active. Slot
   * pattern (vs. drilling all 9 calibration props) so the camera + machine
   * controls + measurement table remain visible and interactive while the
   * user calibrates â€” no modal blocking, matches industrial-software UX.
   */
  calibrationSlot?: ReactNode;
  micrometerEnabled: boolean;
  targetMinHv: number | null;
  targetMaxHv: number | null;
};

function RightPanelImpl({
  measurements,
  measurementsError,
  measurementsLoading,
  onOpenTestRecords,
  onMeasurementsCleared,
  refetchMeasurements,
  activeObjective,
  onObjectiveChange,
  onCenterCommit,
  onTurretIntent,
  onObjectiveChangeIntent,
  onToolbarAction,
  activeTool,
  selectedMeasureMode,
  cameraReady,
  trimMeasureOpen,
  onCloseTrimMeasure,
  onTrimAdjust,
  calibrationActive = false,
  calibrationSlot,
  micrometerEnabled,
  targetMinHv,
  targetMaxHv,
}: Props) {
  useRenderCount('RightPanel');
  const [tab, setTab] = useState(0);
  // CHD target hardness — single source of truth shared by the Depth Image tab
  // and the Export Report dialog so the value (and the exported graph) never
  // drift. Lives here (not inside DepthImageTab) so it survives tab switches.
  const [chdTargetInput, setChdTargetInput] = useState('550');
  const {
    data: patternPrograms,
    error: patternProgramsError,
    loading: patternProgramsLoading,
    refetch: refetchPatternPrograms,
  } = usePatternPrograms();
  const {
    data: albumItems,
    refetch: refetchAlbumItems,
  } = useAlbumItems();
  const [measurementDisplay, setMeasurementDisplay] = useState<MeasurementDisplayValues>({
    hvDisplay: '',
    hvType: 'HV',
    hardnessValue: 'N/A',
    hvTargetColor: 'inherit',
    qualified: null,
    timestamp: null,
    convertDisabled: false,
    convertOptions: [],
    onConvertTypeChange: () => {},
  });
  const handleMeasurementDisplayValuesChange = useCallback((next: MeasurementDisplayValues) => {
    setMeasurementDisplay((current) =>
      current.hvDisplay === next.hvDisplay &&
      current.hvType === next.hvType &&
      current.hardnessValue === next.hardnessValue &&
      current.hvTargetColor === next.hvTargetColor &&
      current.qualified === next.qualified &&
      current.timestamp === next.timestamp &&
      current.convertDisabled === next.convertDisabled &&
      current.onConvertTypeChange === next.onConvertTypeChange
        ? current
        : next
    );
  }, []);

  return (
    <Box sx={PANEL_SX}>
      {calibrationSlot}
      {calibrationActive ? null : (
        <>
          <MeasurementsWorkspace
            measurements={measurements}
            loading={measurementsLoading}
            error={measurementsError}
            refetch={refetchMeasurements}
            onOpenStatisticsTab={() => setTab(4)}
            onOpenTestRecords={onOpenTestRecords}
            onMeasurementsCleared={onMeasurementsCleared}
            onDisplayValuesChange={handleMeasurementDisplayValuesChange}
            micrometerEnabled={micrometerEnabled}
            targetMinHv={targetMinHv}
            targetMaxHv={targetMaxHv}
            chdTargetInput={chdTargetInput}
            onChdTargetInputChange={setChdTargetInput}
          />

          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={TABS_SX}
          >
            {TAB_ITEMS.map((label) => (
              <Tab key={label} label={label} />
            ))}
          </Tabs>

          {renderTab(tab, {
            measurements,
            patternPrograms,
            patternProgramsError,
            patternProgramsLoading,
            refetchPatternPrograms,
            albumItems,
            refetchAlbumItems,
            measurementDisplay,
            activeObjective,
            onObjectiveChange,
            onCenterCommit,
            onTurretIntent,
            onObjectiveChangeIntent,
            onToolbarAction,
            activeTool,
            selectedMeasureMode,
            cameraReady,
            micrometerEnabled,
            targetMinHv,
            targetMaxHv,
            chdTargetInput,
            onChdTargetInputChange: setChdTargetInput,
          })}

          <TrimMeasurePanel
            open={trimMeasureOpen}
            onClose={onCloseTrimMeasure}
            onAdjust={onTrimAdjust}
          />
        </>
      )}
    </Box>
  );
}

export default memo(RightPanelImpl);
