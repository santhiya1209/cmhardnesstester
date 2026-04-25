import { memo, useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import AddIcon from '@mui/icons-material/Add';
import type { SxProps, Theme } from '@mui/material/styles';
import { useSavePatternProgram } from '@/hooks/mutations/useSavePatternProgram';
import type {
  ImpressMode,
  PatternMode,
  PatternOption,
  PatternProgram,
  PatternProgramPayload,
} from '@/types/patternProgram';

const PATTERN_OPTIONS: PatternOption[] = ['Line', 'Rectangle', 'Circle', 'Custom'];
const MODE_OPTIONS: PatternMode[] = [
  'Horizontal Mode',
  'Vertical Mode',
  'Case Depth Mode',
  'Free Mode',
  'Matrix Mode',
  'Circle Mode',
  'Midpoint Mode',
  'Equidistant Multipoint Mode',
  'Equidistant Three Point Mode',
  'Equidistant Triangle Mode',
  'Multiline Composite Pattern',
  'Vertical Line Free Points Mode',
];
const IMPRESS_MODE_OPTIONS: ImpressMode[] = ['indenting', 'onePass', 'twoPass'];

const SECTION_SX: SxProps<Theme> = { px: 1.5, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25 };
const ROW_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 1fr 1fr auto', alignItems: 'center', gap: 1 };
const TWO_COL_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 1fr 96px 1fr', alignItems: 'center', gap: 1 };
const LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const BTN_ROW_SX: SxProps<Theme> = { display: 'flex', gap: 1, alignItems: 'center' };
const BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5, minWidth: 96 };
const OPTION_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' };
const RADIO_SX: SxProps<Theme> = { '& .MuiFormControlLabel-label': { fontSize: 12 } };
const ADD_BTN_SX: SxProps<Theme> = { border: 1, borderColor: 'divider', borderRadius: 0.5, p: 0.25 };
const INFO_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' };
const INFO_TEXT_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };

type MultipointFormState = {
  pattern: PatternOption;
  mode: PatternMode;
  refX: string;
  refY: string;
  interval: string;
  offset: string;
  firstOffset: string;
  number: string;
  multiset: boolean;
  focusAll: boolean;
  impressMode: ImpressMode;
};

type Props = {
  patternPrograms: PatternProgram[];
  patternProgramsError: string | null;
  patternProgramsLoading: boolean;
  refetchPatternPrograms: () => Promise<void>;
};

const DEFAULT_FORM_STATE: MultipointFormState = {
  pattern: 'Line',
  mode: 'Horizontal Mode',
  refX: '',
  refY: '',
  interval: '',
  offset: '',
  firstOffset: '',
  number: '',
  multiset: false,
  focusAll: false,
  impressMode: 'indenting',
};

function toFormState(program: PatternProgram | null): MultipointFormState {
  if (!program) {
    return DEFAULT_FORM_STATE;
  }

  return {
    pattern: program.pattern,
    mode: program.mode,
    refX: program.refX === null ? '' : String(program.refX),
    refY: program.refY === null ? '' : String(program.refY),
    interval: program.interval === null ? '' : String(program.interval),
    offset: program.offset === null ? '' : String(program.offset),
    firstOffset: program.firstOffset === null ? '' : String(program.firstOffset),
    number: program.number === null ? '' : String(program.number),
    multiset: program.multiset,
    focusAll: program.focusAll,
    impressMode: program.impressMode,
  };
}

function parseOptionalNumber(value: string, allowNegative = false): number | null | 'invalid' {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return 'invalid';
  }

  if (!allowNegative && parsed < 0) {
    return 'invalid';
  }

  return parsed;
}

function parseOptionalInteger(value: string): number | null | 'invalid' {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 'invalid';
  }

  return parsed;
}

function getValidationMessage(formState: MultipointFormState): string | null {
  if (parseOptionalNumber(formState.refX, true) === 'invalid') {
    return 'Reference X must be a valid number.';
  }

  if (parseOptionalNumber(formState.refY, true) === 'invalid') {
    return 'Reference Y must be a valid number.';
  }

  if (parseOptionalNumber(formState.interval) === 'invalid') {
    return 'Interval must be a valid non-negative number.';
  }

  if (parseOptionalNumber(formState.offset) === 'invalid') {
    return 'Offset must be a valid non-negative number.';
  }

  if (parseOptionalNumber(formState.firstOffset) === 'invalid') {
    return 'First Offset must be a valid non-negative number.';
  }

  if (parseOptionalInteger(formState.number) === 'invalid') {
    return 'Number must be a valid non-negative integer.';
  }

  return null;
}

function toPayload(formState: MultipointFormState, checked: boolean): PatternProgramPayload | null {
  const refX = parseOptionalNumber(formState.refX, true);
  const refY = parseOptionalNumber(formState.refY, true);
  const interval = parseOptionalNumber(formState.interval);
  const offset = parseOptionalNumber(formState.offset);
  const firstOffset = parseOptionalNumber(formState.firstOffset);
  const number = parseOptionalInteger(formState.number);

  if (
    refX === 'invalid' ||
    refY === 'invalid' ||
    interval === 'invalid' ||
    offset === 'invalid' ||
    firstOffset === 'invalid' ||
    number === 'invalid'
  ) {
    return null;
  }

  return {
    pattern: formState.pattern,
    mode: formState.mode,
    refX,
    refY,
    interval,
    offset,
    firstOffset,
    number,
    multiset: formState.multiset,
    focusAll: formState.focusAll,
    impressMode: formState.impressMode,
    checked,
  };
}

function MultipointTabImpl({
  patternPrograms,
  patternProgramsError,
  patternProgramsLoading,
  refetchPatternPrograms,
}: Props) {
  const { error: saveError, savePatternProgram, saving } = useSavePatternProgram();
  const [formState, setFormState] = useState<MultipointFormState>(DEFAULT_FORM_STATE);
  const [loadedProgramId, setLoadedProgramId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('No saved pattern program yet.');
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const currentProgram = patternPrograms[0] ?? null;
  const loadedProgram = useMemo(
    () => patternPrograms.find((program) => program.id === loadedProgramId) ?? currentProgram,
    [currentProgram, loadedProgramId, patternPrograms]
  );
  const validationError = hasSubmitted ? getValidationMessage(formState) : null;
  const errorMessage = patternProgramsError ?? saveError ?? validationError;
  const isBusy = patternProgramsLoading || saving;

  useEffect(() => {
    if (currentProgram) {
      setLoadedProgramId(currentProgram.id);
      setFormState(toFormState(currentProgram));
      setStatusMessage(`Loaded ${currentProgram.patternName}.`);
      return;
    }

    setLoadedProgramId(null);
    setFormState(DEFAULT_FORM_STATE);
    setStatusMessage('No saved pattern program yet.');
  }, [currentProgram?.id]);

  const handleSelectChange = useCallback(
    (field: 'pattern' | 'mode') =>
      (event: SelectChangeEvent) => {
        const value = event.target.value as PatternOption | PatternMode;
        setFormState((current) => ({
          ...current,
          [field]: value,
        }));
      },
    []
  );

  const handleTextFieldChange = useCallback(
    (field: 'refX' | 'refY' | 'interval' | 'offset' | 'firstOffset' | 'number') =>
      (event: ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        setFormState((current) => ({
          ...current,
          [field]: value,
        }));
      },
    []
  );

  const handleToggleField = useCallback(
    (field: 'multiset' | 'focusAll') =>
      (event: ChangeEvent<HTMLInputElement>) => {
        const value = event.target.checked;
        setFormState((current) => ({
          ...current,
          [field]: value,
        }));
      },
    []
  );

  const handleImpressModeChange = useCallback((value: ImpressMode) => {
    setFormState((current) => ({
      ...current,
      impressMode: value,
    }));
  }, []);

  const handleAddReferencePoint = useCallback(() => {
    setFormState((current) => ({
      ...current,
      refX: current.refX || '0',
      refY: current.refY || '0',
    }));
    setStatusMessage('Mock reference point inserted. Save Program to persist it.');
  }, []);

  const handleSaveProgram = useCallback(async () => {
    setHasSubmitted(true);

    const payload = toPayload(formState, loadedProgram?.checked ?? true);
    if (!payload) {
      return;
    }

    const saved = await savePatternProgram({
      id: loadedProgram?.id,
      values: payload,
    });

    setLoadedProgramId(saved.id);
    setStatusMessage(`Saved ${saved.patternName}.`);
    await refetchPatternPrograms();
  }, [formState, loadedProgram?.checked, loadedProgram?.id, refetchPatternPrograms, savePatternProgram]);

  const handleLoadProgram = useCallback(() => {
    if (!currentProgram) {
      setStatusMessage('No saved pattern program to load.');
      return;
    }

    setLoadedProgramId(currentProgram.id);
    setFormState(toFormState(currentProgram));
    setHasSubmitted(false);
    setStatusMessage(`Loaded ${currentProgram.patternName}.`);
  }, [currentProgram]);

  const handleStart = useCallback(() => {
    setStatusMessage('Machine start is disabled until N-API integration is added.');
  }, []);

  const handleGenerate = useCallback(() => {
    setHasSubmitted(true);

    const payload = toPayload(formState, loadedProgram?.checked ?? true);
    if (!payload) {
      return;
    }

    const pointCount = payload.number ?? 0;
    setStatusMessage(`Generated mock preview for ${pointCount} point(s) using ${payload.mode}.`);
  }, [formState, loadedProgram?.checked]);

  const handleReset = useCallback(() => {
    setFormState(toFormState(loadedProgram));
    setHasSubmitted(false);
    setStatusMessage(
      loadedProgram ? `Reset to ${loadedProgram.patternName}.` : 'Reset to default multipoint values.'
    );
  }, [loadedProgram]);

  return (
    <Box sx={SECTION_SX}>
      <Box sx={TWO_COL_SX}>
        <Typography sx={LABEL_SX}>Pattern</Typography>
        <FormControl size="small">
          <Select value={formState.pattern} disabled={isBusy} onChange={handleSelectChange('pattern')}>
            {PATTERN_OPTIONS.map((option) => (
              <MenuItem key={option} value={option}>{option}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography sx={LABEL_SX}>Mode</Typography>
        <FormControl size="small">
          <Select value={formState.mode} disabled={isBusy} onChange={handleSelectChange('mode')}>
            {MODE_OPTIONS.map((option) => (
              <MenuItem key={option} value={option}>{option}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      <Box sx={BTN_ROW_SX}>
        <Button
          variant="outlined"
          size="small"
          sx={BTN_SX}
          disabled={isBusy}
          onClick={() => void handleSaveProgram()}
        >
          Save Program
        </Button>
        <Button variant="outlined" size="small" sx={BTN_SX} disabled={isBusy} onClick={handleLoadProgram}>
          Load Program
        </Button>
      </Box>

      <Box sx={ROW_SX}>
        <Typography sx={LABEL_SX}>Reference Point</Typography>
        <TextField size="small" label="X" value={formState.refX} disabled={isBusy} onChange={handleTextFieldChange('refX')} />
        <TextField size="small" label="Y" value={formState.refY} disabled={isBusy} onChange={handleTextFieldChange('refY')} />
        <IconButton size="small" aria-label="Add reference point" sx={ADD_BTN_SX} disabled={isBusy} onClick={handleAddReferencePoint}>
          <AddIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box sx={TWO_COL_SX}>
        <Typography sx={LABEL_SX}>Interval</Typography>
        <TextField size="small" value={formState.interval} disabled={isBusy} onChange={handleTextFieldChange('interval')} />
        <Typography sx={LABEL_SX}>Offset</Typography>
        <TextField size="small" value={formState.offset} disabled={isBusy} onChange={handleTextFieldChange('offset')} />
      </Box>

      <Box sx={TWO_COL_SX}>
        <Typography sx={LABEL_SX}>First Offset</Typography>
        <TextField size="small" value={formState.firstOffset} disabled={isBusy} onChange={handleTextFieldChange('firstOffset')} />
        <Typography sx={LABEL_SX}>Number</Typography>
        <TextField size="small" type="number" value={formState.number} disabled={isBusy} onChange={handleTextFieldChange('number')} />
      </Box>

      <Box sx={BTN_ROW_SX}>
        <Button variant="outlined" size="small" sx={BTN_SX} disabled={isBusy} onClick={handleStart}>Start</Button>
        <Button variant="outlined" size="small" sx={BTN_SX} disabled={isBusy} onClick={handleGenerate}>Generate</Button>
        <FormControlLabel
          control={<Checkbox size="small" checked={formState.multiset} disabled={isBusy} onChange={handleToggleField('multiset')} />}
          label="Multiset"
          sx={RADIO_SX}
        />
      </Box>

      <Box sx={OPTION_ROW_SX}>
        <RadioGroup
          row
          value={formState.impressMode}
          onChange={(event) => handleImpressModeChange(event.target.value as ImpressMode)}
        >
          {IMPRESS_MODE_OPTIONS.map((option) => (
            <FormControlLabel
              key={option}
              value={option}
              control={<Radio size="small" />}
              label={
                option === 'indenting'
                  ? 'Indenting'
                  : option === 'onePass'
                    ? 'One Pass Impress'
                    : 'Two Pass Impress'
              }
              sx={RADIO_SX}
            />
          ))}
        </RadioGroup>
        <FormControlLabel
          control={<Checkbox size="small" checked={formState.focusAll} disabled={isBusy} onChange={handleToggleField('focusAll')} />}
          label="FocusAll"
          sx={RADIO_SX}
        />
        <Button variant="outlined" size="small" sx={BTN_SX} disabled={isBusy} onClick={handleReset}>Reset</Button>
      </Box>

      <Box sx={INFO_ROW_SX}>
        <Typography sx={INFO_TEXT_SX}>
          {loadedProgram
            ? `Active Program: ${loadedProgram.patternName} (${loadedProgram.pointCount} point(s))`
            : 'Active Program: Unsaved values'}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {isBusy ? <CircularProgress size={12} /> : null}
          <Typography sx={INFO_TEXT_SX}>{statusMessage}</Typography>
        </Box>
      </Box>

      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
    </Box>
  );
}

export default memo(MultipointTabImpl);
