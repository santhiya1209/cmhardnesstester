import { memo } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import InputAdornment from '@mui/material/InputAdornment';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import ShowChartRoundedIcon from '@mui/icons-material/ShowChartRounded';
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { SxProps, Theme } from '@mui/material/styles';
import { useMultipoint } from '@/hooks/useMultipoint';
import type { ImpressMode, PatternMode, PatternOption } from '@/types/patternProgram';
import LinearPatternForm from './LinearPatternForm';
import MatrixPatternForm from './MatrixPatternForm';
import CaseDepthPatternForm from './CaseDepthPatternForm';
import CirclePatternForm from './CirclePatternForm';
import EquidistantMultipointForm from './EquidistantMultipointForm';
import EquidistantThreePointForm from './EquidistantThreePointForm';
import FreePatternForm from './FreePatternForm';
import VerticalLineFreePointsForm from './VerticalLineFreePointsForm';
import MultiLineCompositeForm from './MultiLineCompositeForm';
import EquidistantTriangleForm from './EquidistantTriangleForm';
import PatternPreviewTable from './PatternPreviewTable';

const PATTERN_OPTIONS: PatternOption[] = ['Line', 'Rectangle', 'Circle', 'Custom'];
// The UI exposes every PatternMode member the engine supports.
const MODE_OPTIONS: PatternMode[] = [
  'Vertical Mode',
  'Horizontal Mode',
  'Matrix Mode',
  'Free Mode',
  'Midpoint Mode',
  'Case Depth Mode',
  'Circle Mode',
  'Equidistant Multipoint Mode',
  'Equidistant Three Point Mode',
  'Vertical Line Free Points Mode',
  'Multiline Composite Pattern',
  'Equidistant Triangle Mode',
];
const IMPRESS_MODE_OPTIONS: ImpressMode[] = ['indenting', 'onePass', 'twoPass'];
const IMPRESS_LABELS: Record<ImpressMode, string> = {
  indenting: 'Indenting',
  onePass: 'One Pass Impress',
  twoPass: 'Two Pass Impress',
};

// Grey base behind the floating form card (matches the panel's `background.default`).
const SCROLL_SX: SxProps<Theme> = { flex: 1, minHeight: 0, p: 1, bgcolor: 'background.default', overflowY: 'auto', overflowX: 'hidden' };
// White form card with the design-reference soft shadow.
const CARD_SX: SxProps<Theme> = { display: 'flex', flexDirection: 'column', gap: 1.25, p: 2, borderRadius: 2, border: 1, borderColor: 'divider', bgcolor: 'background.paper', boxShadow: '0 6px 20px rgba(0,0,0,0.06)' };
const TWO_COL_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 1fr 96px 1fr', alignItems: 'center', gap: 1 };
const LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const BTN_ROW_SX: SxProps<Theme> = { display: 'flex', gap: 1, alignItems: 'center' };
const BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5, minWidth: 96 };
const ADORN_ICON_SX: SxProps<Theme> = { fontSize: 16, color: 'text.disabled' };
const OPTION_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' };
const RADIO_SX: SxProps<Theme> = { '& .MuiFormControlLabel-label': { fontSize: 12 } };
const INFO_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' };
const INFO_TEXT_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const INFO_LINK_SX: SxProps<Theme> = { fontSize: 12, color: 'primary.main', fontWeight: 500 };

function MultipointTabImpl() {
  const m = useMultipoint();
  const { config, programMeta } = m;
  const formKey = `${m.mode}-${m.formRevision}`;

  return (
    <Box sx={SCROLL_SX}>
      <Box sx={CARD_SX}>
      <Box sx={TWO_COL_SX}>
        <Typography sx={LABEL_SX}>Pattern</Typography>
        <FormControl size="small">
          <Select
            value={programMeta.pattern}
            disabled={m.isBusy}
            startAdornment={
              <InputAdornment position="start">
                <ShowChartRoundedIcon sx={ADORN_ICON_SX} />
              </InputAdornment>
            }
            onChange={(event) => m.updateProgramMeta({ pattern: event.target.value as PatternOption })}
          >
            {PATTERN_OPTIONS.map((option) => (
              <MenuItem key={option} value={option}>{option}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography sx={LABEL_SX}>Mode</Typography>
        <FormControl size="small">
          <Select
            value={m.mode}
            disabled={m.isBusy}
            startAdornment={
              <InputAdornment position="start">
                <SwapHorizRoundedIcon sx={ADORN_ICON_SX} />
              </InputAdornment>
            }
            onChange={(event) => m.setMode(event.target.value as PatternMode)}
          >
            {MODE_OPTIONS.map((option) => (
              <MenuItem key={option} value={option}>{option}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      <Box sx={BTN_ROW_SX}>
        <Button variant="contained" color="primary" size="small" sx={BTN_SX} startIcon={<SaveOutlinedIcon />} disabled={m.isBusy} onClick={() => void m.save()}>
          Save
        </Button>
        <Button variant="outlined" size="small" sx={BTN_SX} startIcon={<FolderOpenOutlinedIcon />} disabled={m.isBusy} onClick={m.load}>
          Load
        </Button>
      </Box>

      {m.mode === 'Matrix Mode' ? (
        <MatrixPatternForm key={formKey} config={config} disabled={m.isBusy} onConfigChange={m.updateConfig} />
      ) : m.mode === 'Free Mode' || m.mode === 'Midpoint Mode' ? (
        <FreePatternForm
          points={config.freePoints ?? []}
          disabled={m.isBusy}
          stageReady={m.stageReady}
          onAddPoint={m.addFreePoint}
          onCapture={m.captureFreePoint}
          onUpdate={m.updateFreePoint}
          onDelete={m.deleteFreePoint}
          onClear={m.clearFreePoints}
        />
      ) : m.mode === 'Case Depth Mode' ? (
        <CaseDepthPatternForm
          key={formKey}
          config={config}
          disabled={m.isBusy}
          stageReady={m.stageReady}
          onCaptureReference={m.captureReferencePoint}
          onReferenceChange={m.updateReferencePoint}
          onConfigChange={m.updateConfig}
        />
      ) : m.mode === 'Circle Mode' ? (
        <CirclePatternForm
          key={formKey}
          config={config}
          disabled={m.isBusy}
          stageReady={m.stageReady}
          onCaptureCircle={m.captureCirclePoint}
          onReferenceChange={m.updateReferencePoint}
          onConfigChange={m.updateConfig}
        />
      ) : m.mode === 'Equidistant Multipoint Mode' ? (
        <EquidistantMultipointForm
          key={formKey}
          config={config}
          disabled={m.isBusy}
          stageReady={m.stageReady}
          onCaptureReference={m.captureReferenceSlot}
          onReferenceChange={m.setReferenceSlot}
          onAddReference={m.addReferenceSlot}
          onConfigChange={m.updateConfig}
        />
      ) : m.mode === 'Equidistant Three Point Mode' ? (
        <EquidistantThreePointForm
          key={formKey}
          config={config}
          disabled={m.isBusy}
          multiset={programMeta.multiset}
          onAddRow={m.addThreePointRow}
          onUpdateCell={m.updateThreePointCell}
          onDeleteRow={m.deleteThreePointRow}
          onClear={m.clearThreePointRows}
          onConfigChange={m.updateConfig}
        />
      ) : m.mode === 'Vertical Line Free Points Mode' ? (
        <VerticalLineFreePointsForm
          points={config.freePoints ?? []}
          disabled={m.isBusy}
          stageReady={m.stageReady}
          alignmentOverride={m.alignmentOverride}
          onAddPoint={m.addFreePoint}
          onCapture={m.captureFreePoint}
          onUpdate={m.updateFreePoint}
          onDelete={m.deleteFreePoint}
          onClear={m.clearFreePoints}
          onAlignmentOverrideChange={m.setAlignmentOverride}
        />
      ) : m.mode === 'Multiline Composite Pattern' ? (
        <MultiLineCompositeForm
          lines={config.lines ?? []}
          disabled={m.isBusy}
          onAddLine={m.addCompositeLine}
          onUpdateLine={m.updateCompositeLine}
          onDeleteLine={m.deleteCompositeLine}
          onMoveLine={m.moveCompositeLine}
        />
      ) : m.mode === 'Equidistant Triangle Mode' ? (
        <EquidistantTriangleForm
          key={formKey}
          triangles={config.triangles ?? []}
          interval={config.interval}
          disabled={m.isBusy}
          multiset={programMeta.multiset}
          onAddTriangle={m.addTriangle}
          onUpdateTriangle={m.updateTriangle}
          onDeleteTriangles={m.deleteTriangles}
          onClearTriangles={m.clearTriangles}
          onConfigChange={m.updateConfig}
        />
      ) : (
        <LinearPatternForm key={formKey} config={config} disabled={m.isBusy} onConfigChange={m.updateConfig} />
      )}

      <Box sx={BTN_ROW_SX}>
        <Button variant="contained" color="primary" size="small" sx={BTN_SX} startIcon={<PlayArrowRoundedIcon />} disabled={m.isBusy} onClick={() => void m.start()}>Start</Button>
        <Button variant="contained" color="primary" size="small" sx={BTN_SX} startIcon={<AutoAwesomeOutlinedIcon />} disabled={m.isBusy || m.isGenerating} onClick={m.generatePattern}>
          Generate
        </Button>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={programMeta.multiset}
              disabled={m.isBusy}
              onChange={(event) => m.updateProgramMeta({ multiset: event.target.checked })}
            />
          }
          label="Multiset"
          sx={RADIO_SX}
        />
      </Box>

      <Box sx={OPTION_ROW_SX}>
        <RadioGroup
          row
          value={programMeta.impressMode}
          onChange={(event) => m.updateProgramMeta({ impressMode: event.target.value as ImpressMode })}
        >
          {IMPRESS_MODE_OPTIONS.map((option) => (
            <FormControlLabel
              key={option}
              value={option}
              control={<Radio size="small" />}
              label={IMPRESS_LABELS[option]}
              sx={RADIO_SX}
            />
          ))}
        </RadioGroup>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={programMeta.focusAll}
              disabled={m.isBusy}
              onChange={(event) => m.updateProgramMeta({ focusAll: event.target.checked })}
            />
          }
          label="FocusAll"
          sx={RADIO_SX}
        />
        <Button variant="outlined" color="error" size="small" sx={BTN_SX} startIcon={<RefreshRoundedIcon />} disabled={m.isBusy} onClick={m.reset}>Reset</Button>
      </Box>

      <PatternPreviewTable
        points={m.generatedPoints}
        selectedIds={m.selectedPointIds}
        onToggleSelect={m.toggleSelect}
        onToggleSelectAll={m.toggleSelectAll}
        onDeleteSelected={m.removeSelected}
        onClear={m.clearPoints}
      />

      <Box sx={INFO_ROW_SX}>
        <Typography sx={INFO_LINK_SX}>
          {m.loadedProgram
            ? `Active Program: ${m.loadedProgram.patternName} (${m.loadedProgram.pointCount} point(s))`
            : 'Active Program: Unsaved values'}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {m.isBusy ? <CircularProgress size={12} /> : <InfoOutlinedIcon sx={{ fontSize: 14, color: 'text.disabled' }} />}
          <Typography sx={INFO_TEXT_SX}>{m.statusMessage}</Typography>
        </Box>
      </Box>

      {m.errorMessage ? <Alert severity="error">{m.errorMessage}</Alert> : null}
      </Box>
    </Box>
  );
}

export default memo(MultipointTabImpl);
