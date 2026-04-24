import { memo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableContainer from '@mui/material/TableContainer';
import type { SxProps, Theme } from '@mui/material/styles';

import MachineControlTab from './MachineControlTab';
import XYZPlatformTab from './XYZPlatformTab';
import MultipointTab from './MultipointTab';
import PatternListTab from './PatternListTab';
import StatisticsInfoTab from './StatisticsInfoTab';
import AlbumTab from './AlbumTab';
import DepthImageTab from './DepthImageTab';

const CONVERT_TYPE_OPTIONS = [
  'HV',
  'HK',
  'HBW',
  'HRA',
  'HRB',
  'HRC',
  'HRD',
  'HRF',
  'HR15N',
  'HR30N',
  'HR45N',
  'HR15T',
  'HR30T',
  'HR45T',
];

const TAB_ITEMS = [
  'Machine Control',
  'XYZ Platform Control',
  'Multipoint',
  'Pattern List',
  'Statistics Info',
  'Album',
  'Depth Image',
];

type Reading = {
  id: number;
  x: number;
  y: number;
  hardness: number;
  type: string;
  qualified: string;
  d1: number;
  d2: number;
  davg: number;
  convertType: string;
  convertValue: number;
  depth: number;
  measureTime: string;
};

const COLUMNS = [
  '#',
  'X(mm)',
  'Y(mm)',
  'Hardness',
  'Hardness Type',
  'Qualified',
  'D1(um)',
  'D2(um)',
  'Davg(um)',
  'Convert Type',
  'Convert Value',
  'Depth',
  'Measure Time',
];
const EMPTY_ROWS: Reading[] = [];

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
const SECTION_SX: SxProps<Theme> = { px: 1.5, py: 1 };
const HV_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' };
const HV_LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const HV_FIELD_SX: SxProps<Theme> = { flex: 1, minWidth: 80 };
const HV_DISPLAY_SX: SxProps<Theme> = {
  flex: 1,
  minWidth: 80,
  minHeight: 30,
  px: 1,
  py: 0.5,
  fontSize: 12,
  border: 1,
  borderColor: 'divider',
  borderRadius: 0.5,
  bgcolor: 'background.paper',
  display: 'flex',
  alignItems: 'center',
};
const MICROMETER_FIELD_SX: SxProps<Theme> = { width: 80 };

const TABLE_WRAP_SX: SxProps<Theme> = {
  flex: 1,
  minHeight: 160,
  maxHeight: 220,
  borderTop: 1,
  borderBottom: 1,
  borderColor: 'divider',
};
const TABLE_HEAD_CELL_SX: SxProps<Theme> = {
  fontSize: 11,
  fontWeight: 600,
  color: 'text.secondary',
  py: 0.5,
  px: 1,
  whiteSpace: 'nowrap',
};
const BODY_CELL_SX: SxProps<Theme> = { fontSize: 12, py: 0.5, px: 1 };
const EMPTY_CELL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.disabled', textAlign: 'center', py: 4 };

const ACTION_ROW_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  gap: 0.75,
  px: 1.5,
  py: 1,
};
const ACTION_BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5 };

const TABS_SX: SxProps<Theme> = {
  minHeight: 32,
  borderBottom: 1,
  borderColor: 'divider',
  '& .MuiTab-root': {
    minHeight: 32,
    py: 0.5,
    px: 1,
    fontSize: 12,
    textTransform: 'none',
  },
};

function renderTab(tab: number) {
  switch (tab) {
    case 0: return <MachineControlTab />;
    case 1: return <XYZPlatformTab />;
    case 2: return <MultipointTab />;
    case 3: return <PatternListTab />;
    case 4: return <StatisticsInfoTab />;
    case 5: return <AlbumTab />;
    case 6: return <DepthImageTab />;
    default: return null;
  }
}

function RightPanelImpl() {
  const [convertType, setConvertType] = useState('HV');
  const [hvValue] = useState('');
  const [micrometer, setMicrometer] = useState('0');
  const [tab, setTab] = useState(0);

  return (
    <Box sx={PANEL_SX}>
      <Box sx={SECTION_SX}>
        <Box sx={HV_ROW_SX}>
          <Typography sx={HV_LABEL_SX}>HV</Typography>
          <Box sx={HV_DISPLAY_SX}>{hvValue}</Box>
          <FormControl size="small" sx={HV_FIELD_SX}>
            <Select value={convertType} onChange={(e: SelectChangeEvent) => setConvertType(e.target.value)}>
              {CONVERT_TYPE_OPTIONS.map((o) => (
                <MenuItem key={o} value={o}>{o}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography sx={HV_LABEL_SX}>Micrometer</Typography>
          <TextField
            size="small"
            type="number"
            value={micrometer}
            onChange={(e) => setMicrometer(e.target.value)}
            sx={MICROMETER_FIELD_SX}
          />
        </Box>
      </Box>

      <TableContainer sx={TABLE_WRAP_SX}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {COLUMNS.map((c) => (
                <TableCell key={c} sx={TABLE_HEAD_CELL_SX}>{c}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {EMPTY_ROWS.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMNS.length} sx={EMPTY_CELL_SX}>No measurements yet</TableCell>
              </TableRow>
            ) : (
              EMPTY_ROWS.map((r) => (
                <TableRow key={r.id}>
                  <TableCell sx={BODY_CELL_SX}>{r.id}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{r.x}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{r.y}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{r.hardness}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{r.type}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{r.qualified}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{r.d1}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{r.d2}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{r.davg}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{r.convertType}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{r.convertValue}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{r.depth}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{r.measureTime}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={ACTION_ROW_SX}>
        <Button variant="outlined" size="small" sx={ACTION_BTN_SX}>Edit</Button>
        <Button variant="outlined" size="small" sx={ACTION_BTN_SX}>Delete</Button>
        <Button variant="outlined" size="small" sx={ACTION_BTN_SX}>Clear</Button>
        <Button variant="outlined" size="small" sx={ACTION_BTN_SX}>Statistics</Button>
        <Button variant="outlined" size="small" sx={ACTION_BTN_SX}>Report</Button>
      </Box>

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

      {renderTab(tab)}
    </Box>
  );
}

export default memo(RightPanelImpl);
