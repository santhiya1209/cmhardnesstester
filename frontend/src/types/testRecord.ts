export type TestRecordPayload = {
  sampleName: string;
  testMethod: string;
  measurementIds: string[];
  createdAt: string;
  targetMinHv?: number | null;
  targetMaxHv?: number | null;
};

export type TestRecordSavePayload = {
  sampleName: string;
  testMethod: string;
  measurementIds: string[];
  targetMinHv?: number | null;
  targetMaxHv?: number | null;
};

export type TestRecord = TestRecordPayload & {
  id: string;
  updatedAt: string;
};
