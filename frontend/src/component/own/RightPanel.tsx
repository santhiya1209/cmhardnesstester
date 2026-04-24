import { memo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
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
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import AddIcon from '@mui/icons-material/Add';
import NorthWestIcon from '@mui/icons-material/NorthWest';
import NorthIcon from '@mui/icons-material/North';
import NorthEastIcon from '@mui/icons-material/NorthEast';
import WestIcon from '@mui/icons-material/West';
import ControlCameraIcon from '@mui/icons-material/ControlCamera';
import EastIcon from '@mui/icons-material/East';
import SouthWestIcon from '@mui/icons-material/SouthWest';
import SouthIcon from '@mui/icons-material/South';
import SouthEastIcon from '@mui/icons-material/SouthEast';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import type { SxProps, Theme } from '@mui/material/styles';

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

const ACTION_ROW_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  gap: 0.75,
  px: 1.5,
  py: 1,
};

const ACTION_BTN_SX: SxProps<Theme> = {
  textTransform: 'none',
  fontSize: 12,
  py: 0.5,
};

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

const INDENTER_SECTION_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: '160px 1fr',
  gap: 1.5,
  px: 1.5,
  py: 1.5,
  alignItems: 'center',
};

const INDENT_BUTTON_SX: SxProps<Theme> = {
  width: 160,
  height: 90,
  textTransform: 'none',
  fontSize: 14,
  fontWeight: 500,
};

const INDENTER_RIGHT_SX: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
};

const ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 1 };
const FIELD_LABEL_SX: SxProps<Theme> = {
  fontSize: 12,
  color: 'text.secondary',
  width: 100,
  flexShrink: 0,
};
const READONLY_VALUE_SX: SxProps<Theme> = {
  px: 1,
  py: 0.5,
  fontSize: 12,
  border: 1,
  borderColor: 'divider',
  borderRadius: 0.5,
  minWidth: 64,
  textAlign: 'center',
};

const LENS_BTN_SX: SxProps<Theme> = {
  textTransform: 'none',
  fontSize: 12,
  minWidth: 56,
  py: 0.25,
};

const SETTINGS_GRID_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr auto 1fr',
  rowGap: 1,
  columnGap: 1,
  alignItems: 'center',
  px: 1.5,
  py: 1.5,
  borderTop: 1,
  borderColor: 'divider',
};

const SETTING_LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };

const FORCE_OPTIONS = ['0.1kgf', '0.2kgf', '0.3kgf', '0.5kgf', '1kgf', '2kgf', '5kgf', '10kgf'];
const OBJECTIVE_OPTIONS = ['5X', '10X', '20X', '40X', '50X', '100X'];
const HARDNESS_LEVEL_OPTIONS = ['Low', 'Middle', 'High'];
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
const PATTERN_OPTIONS = ['Line', 'Rectangle', 'Circle', 'Custom'];
const HORIZONTAL_MODE_OPTIONS = ['HorizontalMode', 'VerticalMode', 'DiagonalMode'];

// Multipoint tab styles
const MP_SECTION_SX: SxProps<Theme> = { px: 1.5, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25 };
const MP_ROW_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 1fr 1fr auto', alignItems: 'center', gap: 1 };
const MP_TWO_COL_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 1fr 96px 1fr', alignItems: 'center', gap: 1 };
const MP_LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const MP_BTN_ROW_SX: SxProps<Theme> = { display: 'flex', gap: 1, alignItems: 'center' };
const MP_BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5, minWidth: 96 };
const MP_OPTION_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' };
const MP_RADIO_SX: SxProps<Theme> = { '& .MuiFormControlLabel-label': { fontSize: 12 } };
const MP_ADD_BTN_SX: SxProps<Theme> = { border: 1, borderColor: 'divider', borderRadius: 0.5, p: 0.25 };

// XYZ Platform tab styles
const XYZ_SECTION_SX: SxProps<Theme> = { px: 1.5, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1 };
const XYZ_HEADER_ROW_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 };
const XYZ_GROUP_LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary', fontWeight: 600 };
const XYZ_RADIO_ROW_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 };
const XYZ_RADIO_GROUP_SX: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'row',
  gap: 0,
  '& .MuiFormControlLabel-root': { mr: 1.5 },
  '& .MuiFormControlLabel-label': { fontSize: 12 },
  '& .MuiRadio-root': { p: 0.25 },
};
const XYZ_GRIDS_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 };
const XYZ_PAD_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 0.5,
};
const XYZ_PAD_BTN_SX: SxProps<Theme> = {
  minWidth: 0,
  height: 32,
  textTransform: 'none',
  fontSize: 11,
  py: 0,
  px: 0.5,
};
const XYZ_COORD_ROW_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: 3,
  pt: 1,
  borderTop: 1,
  borderColor: 'divider',
};
const XYZ_COORD_SX: SxProps<Theme> = {
  fontSize: 12,
  color: 'text.secondary',
  fontFamily: 'Consolas, monospace',
};

// Pattern List tab styles
const PL_SECTION_SX: SxProps<Theme> = { px: 1.5, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1 };
const PL_TABLE_WRAP_SX: SxProps<Theme> = {
  flex: 1,
  minHeight: 180,
  maxHeight: 260,
  border: 1,
  borderColor: 'divider',
};
const PL_BTN_ROW_SX: SxProps<Theme> = { display: 'flex', gap: 1 };
const PL_BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5, minWidth: 96 };

const PATTERN_LIST_COLUMNS = ['#', 'Pattern Name', 'Number Of Points', 'Checked'];
type PatternListRow = { id: number; name: string; points: number; checked: boolean };
const PATTERN_LIST_EMPTY_ROWS: PatternListRow[] = [];

// Statistics Info tab styles
const STATS_SECTION_SX: SxProps<Theme> = { px: 1.5, py: 2, display: 'flex', flexDirection: 'column', gap: 1 };
const STATS_GRID_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr 1fr',
  gap: 1,
  alignItems: 'center',
};
const STATS_CELL_SX: SxProps<Theme> = {
  border: 1,
  borderColor: 'divider',
  borderRadius: 0.5,
  py: 1,
  px: 1.5,
  fontSize: 12,
  textAlign: 'center',
  color: 'text.primary',
  bgcolor: 'background.paper',
};
const STATS_LABEL_SX: SxProps<Theme> = { ...STATS_CELL_SX, fontWeight: 500 };
const STATS_VALUE_SX: SxProps<Theme> = { ...STATS_CELL_SX, minHeight: 30, color: 'text.secondary' };

// Album / Depth Image tab styles
const ALBUM_SECTION_SX: SxProps<Theme> = { flex: 1, minHeight: 220 };
const DEPTH_SECTION_SX: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 280,
};
const DEPTH_PREVIEW_SX: SxProps<Theme> = {
  flex: 1,
  minHeight: 200,
  border: 1,
  borderColor: 'divider',
  m: 1.5,
  bgcolor: 'background.paper',
};
const DEPTH_ACTION_ROW_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  px: 1.5,
  pb: 1.5,
};
const DEPTH_BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5, minWidth: 96 };
const DEPTH_CHECK_SX: SxProps<Theme> = { '& .MuiFormControlLabel-label': { fontSize: 12 } };

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

const TAB_ITEMS = [
  'Machine Control',
  'XYZ Platform Control',
  'Multipoint',
  'Pattern List',
  'Statistics Info',
  'Album',
  'Depth Image',
];

function RightPanelImpl() {
  const [convertType, setConvertType] = useState('HV');
  const [hvValue] = useState('');
  const [micrometer, setMicrometer] = useState('0');
  const [tab, setTab] = useState(0);
  const [force, setForce] = useState('0.5kgf');
  const [objective, setObjective] = useState('10X');
  const [hardnessLevel, setHardnessLevel] = useState('Middle');
  const [lightness, setLightness] = useState('5');
  const [loadTime, setLoadTime] = useState('5');
  const [activeLens, setActiveLens] = useState<'10X' | '40X'>('10X');

  // Depth Image tab state
  const [hardnessImage, setHardnessImage] = useState(false);

  // XYZ Platform tab state
  const [xySpeed, setXySpeed] = useState<'slow' | 'mid' | 'fast'>('slow');
  const [zSpeed, setZSpeed] = useState<'ultra' | 'fast' | 'slow'>('fast');
  const [platformX] = useState('0');
  const [platformY] = useState('0');

  // Multipoint tab state
  const [pattern, setPattern] = useState('Line');
  const [horizontalMode, setHorizontalMode] = useState('HorizontalMode');
  const [refX, setRefX] = useState('');
  const [refY, setRefY] = useState('');
  const [interval, setInterval] = useState('');
  const [offset, setOffset] = useState('');
  const [firstOffset, setFirstOffset] = useState('');
  const [number, setNumber] = useState('');
  const [multiset, setMultiset] = useState(false);
  const [focusAll, setFocusAll] = useState(false);
  const [impressMode, setImpressMode] = useState('indenting');

  return (
    <Box sx={PANEL_SX}>
      {/* HV / Convert type / Micrometer */}
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

      {/* Data table */}
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
                <TableCell colSpan={COLUMNS.length} sx={{ fontSize: 12, color: 'text.disabled', textAlign: 'center', py: 4 }}>
                  No measurements yet
                </TableCell>
              </TableRow>
            ) : (
              EMPTY_ROWS.map((r) => (
                <TableRow key={r.id}>
                  <TableCell sx={{ fontSize: 12, py: 0.5, px: 1 }}>{r.id}</TableCell>
                  <TableCell sx={{ fontSize: 12, py: 0.5, px: 1 }}>{r.x}</TableCell>
                  <TableCell sx={{ fontSize: 12, py: 0.5, px: 1 }}>{r.y}</TableCell>
                  <TableCell sx={{ fontSize: 12, py: 0.5, px: 1 }}>{r.hardness}</TableCell>
                  <TableCell sx={{ fontSize: 12, py: 0.5, px: 1 }}>{r.type}</TableCell>
                  <TableCell sx={{ fontSize: 12, py: 0.5, px: 1 }}>{r.qualified}</TableCell>
                  <TableCell sx={{ fontSize: 12, py: 0.5, px: 1 }}>{r.d1}</TableCell>
                  <TableCell sx={{ fontSize: 12, py: 0.5, px: 1 }}>{r.d2}</TableCell>
                  <TableCell sx={{ fontSize: 12, py: 0.5, px: 1 }}>{r.davg}</TableCell>
                  <TableCell sx={{ fontSize: 12, py: 0.5, px: 1 }}>{r.convertType}</TableCell>
                  <TableCell sx={{ fontSize: 12, py: 0.5, px: 1 }}>{r.convertValue}</TableCell>
                  <TableCell sx={{ fontSize: 12, py: 0.5, px: 1 }}>{r.depth}</TableCell>
                  <TableCell sx={{ fontSize: 12, py: 0.5, px: 1 }}>{r.measureTime}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Action buttons */}
      <Box sx={ACTION_ROW_SX}>
        <Button variant="outlined" size="small" sx={ACTION_BTN_SX}>Edit</Button>
        <Button variant="outlined" size="small" sx={ACTION_BTN_SX}>Delete</Button>
        <Button variant="outlined" size="small" sx={ACTION_BTN_SX}>Clear</Button>
        <Button variant="outlined" size="small" sx={ACTION_BTN_SX}>Statistics</Button>
        <Button variant="outlined" size="small" sx={ACTION_BTN_SX}>Report</Button>
      </Box>

      {/* Tabs */}
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

      {tab === 1 ? (
        <Box sx={XYZ_SECTION_SX}>
          {/* X/Y and Z group labels */}
          <Box sx={XYZ_HEADER_ROW_SX}>
            <Typography sx={XYZ_GROUP_LABEL_SX}>X/Y</Typography>
            <Typography sx={XYZ_GROUP_LABEL_SX}>Z</Typography>
          </Box>

          {/* Speed radios */}
          <Box sx={XYZ_RADIO_ROW_SX}>
            <RadioGroup
              row
              value={xySpeed}
              onChange={(e) => setXySpeed(e.target.value as 'slow' | 'mid' | 'fast')}
              sx={XYZ_RADIO_GROUP_SX}
            >
              <FormControlLabel value="slow" control={<Radio size="small" />} label="Slow" />
              <FormControlLabel value="mid" control={<Radio size="small" />} label="Mid" />
              <FormControlLabel value="fast" control={<Radio size="small" />} label="Fast" />
            </RadioGroup>
            <RadioGroup
              row
              value={zSpeed}
              onChange={(e) => setZSpeed(e.target.value as 'ultra' | 'fast' | 'slow')}
              sx={XYZ_RADIO_GROUP_SX}
            >
              <FormControlLabel value="ultra" control={<Radio size="small" />} label="Ultra" />
              <FormControlLabel value="fast" control={<Radio size="small" />} label="Fast" />
              <FormControlLabel value="slow" control={<Radio size="small" />} label="Slow" />
            </RadioGroup>
          </Box>

          {/* Movement pads */}
          <Box sx={XYZ_GRIDS_SX}>
            {/* X/Y D-pad */}
            <Box sx={XYZ_PAD_SX}>
              <Button variant="outlined" sx={XYZ_PAD_BTN_SX}><NorthWestIcon fontSize="small" /></Button>
              <Button variant="outlined" sx={XYZ_PAD_BTN_SX}><NorthIcon fontSize="small" /></Button>
              <Button variant="outlined" sx={XYZ_PAD_BTN_SX}><NorthEastIcon fontSize="small" /></Button>

              <Button variant="outlined" sx={XYZ_PAD_BTN_SX}><WestIcon fontSize="small" /></Button>
              <Button variant="outlined" sx={XYZ_PAD_BTN_SX}><ControlCameraIcon fontSize="small" /></Button>
              <Button variant="outlined" sx={XYZ_PAD_BTN_SX}><EastIcon fontSize="small" /></Button>

              <Button variant="outlined" sx={XYZ_PAD_BTN_SX}><SouthWestIcon fontSize="small" /></Button>
              <Button variant="outlined" sx={XYZ_PAD_BTN_SX}><SouthIcon fontSize="small" /></Button>
              <Button variant="outlined" sx={XYZ_PAD_BTN_SX}><SouthEastIcon fontSize="small" /></Button>
            </Box>

            {/* Z controls */}
            <Box sx={XYZ_PAD_SX}>
              <Button variant="outlined" sx={XYZ_PAD_BTN_SX}>Lock</Button>
              <Button variant="outlined" sx={XYZ_PAD_BTN_SX}>Lock</Button>
              <Button variant="outlined" sx={XYZ_PAD_BTN_SX}>Unlock</Button>

              <Button variant="outlined" sx={XYZ_PAD_BTN_SX}>Unlock</Button>
              <Button variant="outlined" sx={XYZ_PAD_BTN_SX}>Cfocus</Button>
              <Button variant="outlined" sx={XYZ_PAD_BTN_SX}><ArrowUpwardIcon fontSize="small" /></Button>

              <Button variant="outlined" sx={XYZ_PAD_BTN_SX}>Relocatio</Button>
              <Button variant="outlined" sx={XYZ_PAD_BTN_SX}>Ffocus</Button>
              <Button variant="outlined" sx={XYZ_PAD_BTN_SX}><ArrowDownwardIcon fontSize="small" /></Button>
            </Box>
          </Box>

          {/* Coordinates */}
          <Box sx={XYZ_COORD_ROW_SX}>
            <Typography sx={XYZ_COORD_SX}>X: {platformX}</Typography>
            <Typography sx={XYZ_COORD_SX}>Y: {platformY}</Typography>
          </Box>
        </Box>
      ) : tab === 5 ? (
        <Box sx={ALBUM_SECTION_SX} />
      ) : tab === 6 ? (
        <Box sx={DEPTH_SECTION_SX}>
          <Box sx={DEPTH_PREVIEW_SX} />
          <Box sx={DEPTH_ACTION_ROW_SX}>
            <Button variant="outlined" size="small" sx={DEPTH_BTN_SX}>Fresh</Button>
            <Button variant="outlined" size="small" sx={DEPTH_BTN_SX}>Save Image</Button>
            <FormControlLabel
              control={<Checkbox size="small" checked={hardnessImage} onChange={(e) => setHardnessImage(e.target.checked)} />}
              label="HardnessImage"
              sx={DEPTH_CHECK_SX}
            />
          </Box>
        </Box>
      ) : tab === 4 ? (
        <Box sx={STATS_SECTION_SX}>
          <Box sx={STATS_GRID_SX}>
            <Typography sx={STATS_LABEL_SX}>Number</Typography>
            <Typography sx={STATS_VALUE_SX}>&nbsp;</Typography>
            <Typography sx={STATS_LABEL_SX}>Variance</Typography>
            <Typography sx={STATS_VALUE_SX}>&nbsp;</Typography>

            <Typography sx={STATS_LABEL_SX}>Min</Typography>
            <Typography sx={STATS_VALUE_SX}>&nbsp;</Typography>
            <Typography sx={STATS_LABEL_SX}>StdDev</Typography>
            <Typography sx={STATS_VALUE_SX}>&nbsp;</Typography>

            <Typography sx={STATS_LABEL_SX}>Max</Typography>
            <Typography sx={STATS_VALUE_SX}>&nbsp;</Typography>
            <Box />
            <Box />

            <Typography sx={STATS_LABEL_SX}>Average</Typography>
            <Typography sx={STATS_VALUE_SX}>&nbsp;</Typography>
            <Box />
            <Box />
          </Box>
        </Box>
      ) : tab === 3 ? (
        <Box sx={PL_SECTION_SX}>
          <TableContainer sx={PL_TABLE_WRAP_SX}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {PATTERN_LIST_COLUMNS.map((c) => (
                    <TableCell key={c} sx={TABLE_HEAD_CELL_SX}>{c}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {PATTERN_LIST_EMPTY_ROWS.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={PATTERN_LIST_COLUMNS.length} sx={{ fontSize: 12, color: 'text.disabled', textAlign: 'center', py: 6 }}>
                      No patterns
                    </TableCell>
                  </TableRow>
                ) : (
                  PATTERN_LIST_EMPTY_ROWS.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell sx={{ fontSize: 12, py: 0.5, px: 1 }}>{r.id}</TableCell>
                      <TableCell sx={{ fontSize: 12, py: 0.5, px: 1 }}>{r.name}</TableCell>
                      <TableCell sx={{ fontSize: 12, py: 0.5, px: 1 }}>{r.points}</TableCell>
                      <TableCell sx={{ fontSize: 12, py: 0.5, px: 1 }}>
                        <Checkbox size="small" checked={r.checked} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <Box sx={PL_BTN_ROW_SX}>
            <Button variant="outlined" size="small" sx={PL_BTN_SX}>Delete</Button>
            <Button variant="outlined" size="small" sx={PL_BTN_SX}>Clear</Button>
          </Box>
        </Box>
      ) : tab === 2 ? (
        <Box sx={MP_SECTION_SX}>
          <Box sx={MP_TWO_COL_SX}>
            <Typography sx={MP_LABEL_SX}>Pattern</Typography>
            <FormControl size="small">
              <Select value={pattern} onChange={(e: SelectChangeEvent) => setPattern(e.target.value)}>
                {PATTERN_OPTIONS.map((o) => (
                  <MenuItem key={o} value={o}>{o}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Typography sx={MP_LABEL_SX}>Mode</Typography>
            <FormControl size="small">
              <Select value={horizontalMode} onChange={(e: SelectChangeEvent) => setHorizontalMode(e.target.value)}>
                {HORIZONTAL_MODE_OPTIONS.map((o) => (
                  <MenuItem key={o} value={o}>{o}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Box sx={MP_BTN_ROW_SX}>
            <Button variant="outlined" size="small" sx={MP_BTN_SX}>Save Program</Button>
            <Button variant="outlined" size="small" sx={MP_BTN_SX}>Load Program</Button>
          </Box>

          <Box sx={MP_ROW_SX}>
            <Typography sx={MP_LABEL_SX}>Reference Point</Typography>
            <TextField size="small" label="X" value={refX} onChange={(e) => setRefX(e.target.value)} />
            <TextField size="small" label="Y" value={refY} onChange={(e) => setRefY(e.target.value)} />
            <IconButton size="small" aria-label="Add reference point" sx={MP_ADD_BTN_SX}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Box>

          <Box sx={MP_TWO_COL_SX}>
            <Typography sx={MP_LABEL_SX}>Interval</Typography>
            <TextField size="small" value={interval} onChange={(e) => setInterval(e.target.value)} />
            <Typography sx={MP_LABEL_SX}>Offset</Typography>
            <TextField size="small" value={offset} onChange={(e) => setOffset(e.target.value)} />
          </Box>

          <Box sx={MP_TWO_COL_SX}>
            <Typography sx={MP_LABEL_SX}>First Offset</Typography>
            <TextField size="small" value={firstOffset} onChange={(e) => setFirstOffset(e.target.value)} />
            <Typography sx={MP_LABEL_SX}>Number</Typography>
            <TextField size="small" type="number" value={number} onChange={(e) => setNumber(e.target.value)} />
          </Box>

          <Box sx={MP_BTN_ROW_SX}>
            <Button variant="outlined" size="small" sx={MP_BTN_SX}>Start</Button>
            <Button variant="outlined" size="small" sx={MP_BTN_SX}>Generate</Button>
            <FormControlLabel
              control={<Checkbox size="small" checked={multiset} onChange={(e) => setMultiset(e.target.checked)} />}
              label="Multiset"
              sx={MP_RADIO_SX}
            />
          </Box>

          <Box sx={MP_OPTION_ROW_SX}>
            <RadioGroup
              row
              value={impressMode}
              onChange={(e) => setImpressMode(e.target.value)}
            >
              <FormControlLabel value="indenting" control={<Radio size="small" />} label="Indenting" sx={MP_RADIO_SX} />
              <FormControlLabel value="onePass" control={<Radio size="small" />} label="One Pass Impress" sx={MP_RADIO_SX} />
              <FormControlLabel value="twoPass" control={<Radio size="small" />} label="Two Pass Impress" sx={MP_RADIO_SX} />
            </RadioGroup>
            <FormControlLabel
              control={<Checkbox size="small" checked={focusAll} onChange={(e) => setFocusAll(e.target.checked)} />}
              label="FocusAll"
              sx={MP_RADIO_SX}
            />
            <Button variant="outlined" size="small" sx={MP_BTN_SX}>Reset</Button>
          </Box>
        </Box>
      ) : (
      <>
      {/* Indenter section */}
      <Box sx={INDENTER_SECTION_SX}>
        <Button variant="outlined" sx={INDENT_BUTTON_SX}>Indent</Button>

        <Box sx={INDENTER_RIGHT_SX}>
          <Box sx={ROW_SX}>
            <Typography sx={FIELD_LABEL_SX}>Indenter</Typography>
            <Typography sx={READONLY_VALUE_SX}>HV</Typography>
          </Box>
          <Box sx={ROW_SX}>
            <Typography sx={FIELD_LABEL_SX}>Objective Lens</Typography>
            <Stack direction="row" spacing={1}>
              <Button
                variant={activeLens === '10X' ? 'contained' : 'outlined'}
                size="small"
                sx={LENS_BTN_SX}
                onClick={() => setActiveLens('10X')}
              >
                10X
              </Button>
              <Button
                variant={activeLens === '40X' ? 'contained' : 'outlined'}
                size="small"
                sx={LENS_BTN_SX}
                onClick={() => setActiveLens('40X')}
              >
                40X
              </Button>
            </Stack>
          </Box>
        </Box>
      </Box>

      <Divider />

      {/* Settings grid */}
      <Box sx={SETTINGS_GRID_SX}>
        <Typography sx={SETTING_LABEL_SX}>Force</Typography>
        <FormControl size="small">
          <Select value={force} onChange={(e: SelectChangeEvent) => setForce(e.target.value)}>
            {FORCE_OPTIONS.map((o) => (
              <MenuItem key={o} value={o}>{o}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography sx={SETTING_LABEL_SX}>Lightness</Typography>
        <TextField
          size="small"
          type="number"
          value={lightness}
          onChange={(e) => setLightness(e.target.value)}
        />

        <Typography sx={SETTING_LABEL_SX}>Objective</Typography>
        <FormControl size="small">
          <Select value={objective} onChange={(e: SelectChangeEvent) => setObjective(e.target.value)}>
            {OBJECTIVE_OPTIONS.map((o) => (
              <MenuItem key={o} value={o}>{o}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography sx={SETTING_LABEL_SX}>Load Time(s)</Typography>
        <TextField
          size="small"
          type="number"
          value={loadTime}
          onChange={(e) => setLoadTime(e.target.value)}
        />

        <Typography sx={SETTING_LABEL_SX}>Hardness Level</Typography>
        <FormControl size="small">
          <Select value={hardnessLevel} onChange={(e: SelectChangeEvent) => setHardnessLevel(e.target.value)}>
            {HARDNESS_LEVEL_OPTIONS.map((o) => (
              <MenuItem key={o} value={o}>{o}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box />
        <Box />
      </Box>
      </>
      )}
    </Box>
  );
}

export default memo(RightPanelImpl);
