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
import type { SxProps, Theme } from '@mui/material/styles';
import { useMultipoint } from '@/hooks/useMultipoint';
import type { ImpressMode, PatternMode, PatternOption } from '@/types/patternProgram';
import LinearPatternForm from './LinearPatternForm';
import MatrixPatternForm from './MatrixPatternForm';
import CaseDepthPatternForm from './CaseDepthPatternForm';
import FreePatternForm from './FreePatternForm';
import PatternPreviewTable from './PatternPreviewTable';

const PATTERN_OPTIONS: PatternOption[] = ['Line', 'Rectangle', 'Circle', 'Custom'];
// Engine supports all 12 PatternMode members; the UI exposes only these 5 for now.
const MODE_OPTIONS: PatternMode[] = [
  'Vertical Mode',
  'Horizontal Mode',
  'Matrix Mode',
  'Free Mode',
  'Case Depth Mode',
];
const IMPRESS_MODE_OPTIONS: ImpressMode[] = ['indenting', 'onePass', 'twoPass'];
const IMPRESS_LABELS: Record<ImpressMode, string> = {
  indenting: 'Indenting',
  onePass: 'One Pass Impress',
  twoPass: 'Two Pass Impress',
};

const SECTION_SX: SxProps<Theme> = { px: 1.5, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25 };
const TWO_COL_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 1fr 96px 1fr', alignItems: 'center', gap: 1 };
const LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const BTN_ROW_SX: SxProps<Theme> = { display: 'flex', gap: 1, alignItems: 'center' };
const BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5, minWidth: 96 };
const OPTION_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' };
const RADIO_SX: SxProps<Theme> = { '& .MuiFormControlLabel-label': { fontSize: 12 } };
const INFO_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' };
const INFO_TEXT_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };

function MultipointTabImpl() {
  const m = useMultipoint();
  const { config, programMeta } = m;
  const formKey = `${m.mode}-${m.formRevision}`;

  return (
    <Box sx={SECTION_SX}>
      <Box sx={TWO_COL_SX}>
        <Typography sx={LABEL_SX}>Pattern</Typography>
        <FormControl size="small">
          <Select
            value={programMeta.pattern}
            disabled={m.isBusy}
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
            onChange={(event) => m.setMode(event.target.value as PatternMode)}
          >
            {MODE_OPTIONS.map((option) => (
              <MenuItem key={option} value={option}>{option}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      <Box sx={BTN_ROW_SX}>
        <Button variant="outlined" size="small" sx={BTN_SX} disabled={m.isBusy} onClick={() => void m.save()}>
          Save Program
        </Button>
        <Button variant="outlined" size="small" sx={BTN_SX} disabled={m.isBusy} onClick={m.load}>
          Load Program
        </Button>
      </Box>

      {m.mode === 'Matrix Mode' ? (
        <MatrixPatternForm key={formKey} config={config} disabled={m.isBusy} onConfigChange={m.updateConfig} />
      ) : m.mode === 'Free Mode' ? (
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
      ) : (
        <LinearPatternForm key={formKey} config={config} disabled={m.isBusy} onConfigChange={m.updateConfig} />
      )}

      <Box sx={BTN_ROW_SX}>
        <Button variant="outlined" size="small" sx={BTN_SX} disabled={m.isBusy} onClick={() => void m.start()}>Start</Button>
        <Button variant="outlined" size="small" sx={BTN_SX} disabled={m.isBusy || m.isGenerating} onClick={m.generatePattern}>
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
        <Button variant="outlined" size="small" sx={BTN_SX} disabled={m.isBusy} onClick={m.reset}>Reset</Button>
      </Box>

      <PatternPreviewTable
        points={m.generatedPoints}
        selectedIds={m.selectedPointIds}
        onToggleSelect={m.toggleSelect}
        onDeleteSelected={m.removeSelected}
        onClear={m.clearPoints}
      />

      <Box sx={INFO_ROW_SX}>
        <Typography sx={INFO_TEXT_SX}>
          {m.loadedProgram
            ? `Active Program: ${m.loadedProgram.patternName} (${m.loadedProgram.pointCount} point(s))`
            : 'Active Program: Unsaved values'}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {m.isBusy ? <CircularProgress size={12} /> : null}
          <Typography sx={INFO_TEXT_SX}>{m.statusMessage}</Typography>
        </Box>
      </Box>

      {m.errorMessage ? <Alert severity="error">{m.errorMessage}</Alert> : null}
    </Box>
  );
}

export default memo(MultipointTabImpl);
