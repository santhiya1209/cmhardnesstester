import { memo, useState } from 'react';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import type { SxProps, Theme } from '@mui/material/styles';
import { useAlbumItems } from '@/hooks/queries/useAlbumItems';
import { usePatternPrograms } from '@/hooks/queries/usePatternPrograms';
import type { AlbumItem } from '@/types/albumItem';
import type { Measurement } from '@/types/measurement';
import type { PatternProgram } from '@/types/patternProgram';
import { colors } from '@/theme/theme';

import MeasurementsWorkspace from './MeasurementsWorkspace';
import MachineControlTab from './MachineControlTab';
import XYZPlatformTab from './XYZPlatformTab';
import MultipointTab from './MultipointTab';
import PatternListTab from './PatternListTab';
import StatisticsInfoTab from './StatisticsInfoTab';
import AlbumTab from './AlbumTab';
import DepthImageTab from './DepthImageTab';

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
  display: 'flex',
  flexDirection: 'column',
  bgcolor: 'background.paper',
  borderLeft: 1,
  borderColor: 'divider',
  overflow: 'hidden',
};

const TABS_SX: SxProps<Theme> = {
  minHeight: 32,
  borderBottom: 1,
  borderColor: 'divider',
  bgcolor: colors.headingPrimary,
  '& .MuiTabs-indicator': {
    backgroundColor: '#FFFFFF',
    height: 2,
  },
  '& .MuiTab-root': {
    minHeight: 32,
    py: 0.5,
    px: 1.5,
    fontSize: 12,
    textTransform: 'none',
    color: 'rgba(255, 255, 255, 0.75)',
    borderBottom: '2px solid transparent',
    transition:
      'background-color 150ms ease, color 150ms ease, border-color 150ms ease',
    '&:hover': {
      backgroundColor: '#475569',
      color: '#FFFFFF',
      borderBottomColor: '#FFFFFF',
    },
    '&.Mui-selected': {
      color: '#FFFFFF',
      fontWeight: 600,
    },
  },
  '& .MuiTabs-scrollButtons': {
    color: '#FFFFFF',
    '&.Mui-disabled': {
      opacity: 0.35,
    },
  },
};

type TabContentProps = {
  measurements: Measurement[];
  patternPrograms: PatternProgram[];
  patternProgramsError: string | null;
  patternProgramsLoading: boolean;
  refetchPatternPrograms: () => Promise<void>;
  albumItems: AlbumItem[];
  albumItemsError: string | null;
  albumItemsLoading: boolean;
  refetchAlbumItems: () => Promise<void>;
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
    albumItemsError,
    albumItemsLoading,
    refetchAlbumItems,
  }: TabContentProps
) {
  switch (tab) {
    case 0: return <MachineControlTab />;
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
    case 4: return <StatisticsInfoTab measurements={measurements} />;
    case 5:
      return (
        <AlbumTab
          albumItems={albumItems}
          albumItemsError={albumItemsError}
          albumItemsLoading={albumItemsLoading}
          refetchAlbumItems={refetchAlbumItems}
        />
      );
    case 6:
      return (
        <DepthImageTab
          albumItemCount={albumItems.length}
          onAlbumChanged={refetchAlbumItems}
          measurements={measurements}
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
};

function RightPanelImpl({
  measurements,
  measurementsError,
  measurementsLoading,
  onOpenTestRecords,
  refetchMeasurements,
}: Props) {
  const [tab, setTab] = useState(0);
  const {
    data: patternPrograms,
    error: patternProgramsError,
    loading: patternProgramsLoading,
    refetch: refetchPatternPrograms,
  } = usePatternPrograms();
  const {
    data: albumItems,
    error: albumItemsError,
    loading: albumItemsLoading,
    refetch: refetchAlbumItems,
  } = useAlbumItems();

  return (
    <Box sx={PANEL_SX}>
      <MeasurementsWorkspace
        measurements={measurements}
        loading={measurementsLoading}
        error={measurementsError}
        refetch={refetchMeasurements}
        onOpenStatisticsTab={() => setTab(4)}
        onOpenTestRecords={onOpenTestRecords}
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
        albumItemsError,
        albumItemsLoading,
        refetchAlbumItems,
      })}
    </Box>
  );
}

export default memo(RightPanelImpl);
