import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Identifies which long-lived dialog is currently open. Only one of these
 * can be open at a time — opening a new one auto-closes the previous.
 *
 * Boolean toggles like `exitConfirmOpen` and `trimMeasureOpen` are separate
 * concerns and live as their own fields on the dialog context so the small
 * one-off confirmations don't have to fight for slots in this union.
 */
export type DialogKey =
  | 'autoMeasure'
  | 'calibration'
  | 'camera'
  | 'generic'
  | 'lineColor'
  | 'micrometer'
  | 'other'
  | 'restoreFactory'
  | 'serialPort'
  | 'testRecords'
  | 'xyPlatform'
  | 'zAxis'
  | null;

type DialogContextValue = {
  activeDialog: DialogKey;
  setActiveDialog: (next: DialogKey | ((prev: DialogKey) => DialogKey)) => void;
  exitConfirmOpen: boolean;
  setExitConfirmOpen: (next: boolean) => void;
  trimMeasureOpen: boolean;
  setTrimMeasureOpen: (next: boolean) => void;
  initialTestRecordMeasurementIds: string[];
  setInitialTestRecordMeasurementIds: (ids: string[]) => void;
  /** Closes whichever long-lived dialog is open and clears the test-records seed. */
  closeDialog: () => void;
  /** Convenience: open the test records dialog seeded with explicit measurement ids. */
  openTestRecordsDialog: (ids: string[]) => void;
};

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [activeDialog, setActiveDialog] = useState<DialogKey>(null);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [trimMeasureOpen, setTrimMeasureOpen] = useState(false);
  const [initialTestRecordMeasurementIds, setInitialTestRecordMeasurementIds] = useState<string[]>(
    []
  );

  const closeDialog = useCallback(() => {
    setActiveDialog(null);
    setInitialTestRecordMeasurementIds([]);
  }, []);

  const openTestRecordsDialog = useCallback((ids: string[]) => {
    setInitialTestRecordMeasurementIds(ids);
    setActiveDialog('testRecords');
  }, []);

  const value = useMemo<DialogContextValue>(
    () => ({
      activeDialog,
      setActiveDialog,
      exitConfirmOpen,
      setExitConfirmOpen,
      trimMeasureOpen,
      setTrimMeasureOpen,
      initialTestRecordMeasurementIds,
      setInitialTestRecordMeasurementIds,
      closeDialog,
      openTestRecordsDialog,
    }),
    [
      activeDialog,
      exitConfirmOpen,
      trimMeasureOpen,
      initialTestRecordMeasurementIds,
      closeDialog,
      openTestRecordsDialog,
    ]
  );

  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
}

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error('useDialog must be used within DialogProvider');
  }
  return ctx;
}
