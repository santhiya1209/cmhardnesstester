export type TestRecordPayload = {
  sampleName: string;
  testMethod: string;
  measurementIds: string[];
  createdAt: string;
};

export type TestRecordSavePayload = {
  sampleName: string;
  testMethod: string;
  measurementIds: string[];
};

export type TestRecord = TestRecordPayload & {
  id: string;
  updatedAt: string;
};
