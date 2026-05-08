export type ReportHeaderSettingPayload = {
  sampleName: string;
  sampleSerialNumber: string;
  inspectionCompany: string;
  tester: string;
  reviewer: string;
  hardnessMin: number | null;
  hardnessMax: number | null;
};

export type ReportHeaderSetting = ReportHeaderSettingPayload & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_REPORT_HEADER_SETTING: ReportHeaderSettingPayload = {
  sampleName: '',
  sampleSerialNumber: '',
  inspectionCompany: '',
  tester: '',
  reviewer: '',
  hardnessMin: 300,
  hardnessMax: 800,
};
