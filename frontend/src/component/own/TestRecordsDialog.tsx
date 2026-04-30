import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useDeleteTestRecord } from '@/hooks/mutations/useDeleteTestRecord';
import { useSaveTestRecord } from '@/hooks/mutations/useSaveTestRecord';
import { useTestRecords } from '@/hooks/queries/useTestRecords';
import type { Measurement } from '@/types/measurement';
import type { TestRecord, TestRecordSavePayload } from '@/types/testRecord';

type Props = {
  open: boolean;
  onClose: () => void;
  measurements: Measurement[];
  initialMeasurementIds?: string[];
  onStatusChange?: (message: string) => void;
};

type FormState = {
  sampleName: string;
  testMethod: string;
  measurementIds: string[];
};

const DEFAULT_FORM_STATE: FormState = {
  sampleName: '',
  testMethod: 'HV',
  measurementIds: [],
};

function toFormState(record: TestRecord | null, initialMeasurementIds: string[]): FormState {
  if (!record) {
    return {
      ...DEFAULT_FORM_STATE,
      measurementIds: initialMeasurementIds,
    };
  }

  return {
    sampleName: record.sampleName,
    testMethod: record.testMethod,
    measurementIds: record.measurementIds,
  };
}

function toPayload(formState: FormState): TestRecordSavePayload | null {
  const sampleName = formState.sampleName.trim();
  const testMethod = formState.testMethod.trim();

  if (!sampleName || !testMethod || formState.measurementIds.length === 0) {
    return null;
  }

  return {
    sampleName,
    testMethod,
    measurementIds: formState.measurementIds,
  };
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatMeasurementLabel(measurement: Measurement): string {
  const hv = measurement.hv === null ? '-' : measurement.hv;
  return `HV ${hv} | D1 ${measurement.d1} ${measurement.unit} | D2 ${measurement.d2} ${measurement.unit}`;
}

function TestRecordsDialogImpl({
  open,
  onClose,
  measurements,
  initialMeasurementIds = [],
  onStatusChange,
}: Props) {
  const { data: testRecords, error: loadError, loading, refetch } = useTestRecords();
  const { error: saveError, saveTestRecord, saving } = useSaveTestRecord();
  const { error: deleteError, deleting, removeTestRecord } = useDeleteTestRecord();
  const [selectedRecordId, setSelectedRecordId] = useState<string>('');
  const [formState, setFormState] = useState<FormState>(DEFAULT_FORM_STATE);
  const [showValidationError, setShowValidationError] = useState(false);

  const selectedRecord = useMemo(
    () => testRecords.find((record) => record.id === selectedRecordId) ?? null,
    [selectedRecordId, testRecords]
  );
  const payload = useMemo(() => toPayload(formState), [formState]);
  const validationError =
    showValidationError && payload === null
      ? 'Sample name, test method, and at least one measurement are required.'
      : null;
  const errorMessage = loadError ?? saveError ?? deleteError ?? validationError;
  const busy = loading || saving || deleting;

  useEffect(() => {
    if (open) {
      void refetch();
    }
  }, [open, refetch]);

  useEffect(() => {
    if (open && !loading) {
      setFormState(toFormState(selectedRecord, initialMeasurementIds));
      setShowValidationError(false);
    }
  }, [initialMeasurementIds, loading, open, selectedRecord]);

  const handleRecordChange = useCallback((event: SelectChangeEvent) => {
    const value = event.target.value;
    setSelectedRecordId(value);
    setShowValidationError(false);
  }, []);

  const handleFieldChange = useCallback(
    (field: 'sampleName' | 'testMethod') =>
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        setShowValidationError(false);
        setFormState((current) => ({
          ...current,
          [field]: value,
        }));
      },
    []
  );

  const handleMeasurementToggle = useCallback((measurementId: string) => {
    setShowValidationError(false);
    setFormState((current) => {
      const isSelected = current.measurementIds.includes(measurementId);

      return {
        ...current,
        measurementIds: isSelected
          ? current.measurementIds.filter((id) => id !== measurementId)
          : [...current.measurementIds, measurementId],
      };
    });
  }, []);

  const handleNew = useCallback(() => {
    setSelectedRecordId('');
    setFormState(toFormState(null, initialMeasurementIds));
    setShowValidationError(false);
  }, [initialMeasurementIds]);

  const handleSave = useCallback(async () => {
    if (!payload) {
      setShowValidationError(true);
      return;
    }

    await saveTestRecord({
      id: selectedRecord?.id,
      values: payload,
    });

    onStatusChange?.('Test record saved.');
    await refetch();
    handleNew();
  }, [handleNew, onStatusChange, payload, refetch, saveTestRecord, selectedRecord?.id]);

  const handleDelete = useCallback(async () => {
    if (!selectedRecord) {
      return;
    }

    await removeTestRecord(selectedRecord.id);
    onStatusChange?.('Test record deleted.');
    await refetch();
    handleNew();
  }, [handleNew, onStatusChange, refetch, removeTestRecord, selectedRecord]);

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>Reports / Test Records</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Box>
            <Typography variant="caption">Saved Record</Typography>
            <Select fullWidth size="small" value={selectedRecordId} disabled={busy} onChange={handleRecordChange}>
              <MenuItem value="">New Record</MenuItem>
              {testRecords.map((record) => (
                <MenuItem key={record.id} value={record.id}>
                  {record.sampleName} ({formatTimestamp(record.createdAt)})
                </MenuItem>
              ))}
            </Select>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <Box>
              <Typography variant="caption">Sample Name</Typography>
              <TextField
                fullWidth
                size="small"
                value={formState.sampleName}
                disabled={busy}
                onChange={handleFieldChange('sampleName')}
              />
            </Box>
            <Box>
              <Typography variant="caption">Test Method</Typography>
              <TextField
                fullWidth
                size="small"
                value={formState.testMethod}
                disabled={busy}
                onChange={handleFieldChange('testMethod')}
              />
            </Box>
          </Box>

          <Divider />

          <Box>
            <Typography variant="caption">Measurements</Typography>
            <Stack sx={{ mt: 1 }}>
              {measurements.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No measurements available yet.
                </Typography>
              ) : (
                measurements.map((measurement) => (
                  <FormControlLabel
                    key={measurement.id}
                    control={
                      <Checkbox
                        size="small"
                        checked={formState.measurementIds.includes(measurement.id)}
                        disabled={busy}
                        onChange={() => handleMeasurementToggle(measurement.id)}
                      />
                    }
                    label={formatMeasurementLabel(measurement)}
                  />
                ))
              )}
            </Stack>
          </Box>

          {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleNew} disabled={busy}>
          New
        </Button>
        <Button onClick={onClose} disabled={busy}>
          Close
        </Button>
        <Button onClick={() => { void handleDelete(); }} disabled={busy || !selectedRecord} color="error">
          Delete
        </Button>
        <Button variant="contained" onClick={() => { void handleSave(); }} disabled={busy}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default memo(TestRecordsDialogImpl);
