import { baseApi } from './baseApi';
import type { AutoMeasureSettings, AutoMeasureSettingsPayload } from '@/types/autoMeasureSettings';
import type { CalibrationSettings, CalibrationSettingsSavePayload } from '@/types/calibrationSettings';
import type { CameraSetting, CameraSettingPayload } from '@/types/cameraSetting';
import type { DepthImageSetting, DepthImageSettingPayload } from '@/types/depthImageSetting';
import type { GenericSetting, GenericSettingPayload } from '@/types/genericSetting';
import type { LineColorSetting, LineColorSettingPayload } from '@/types/lineColorSetting';
import type { MachineSettings, MachineSettingsPayload } from '@/types/machineSettings';
import type { MicrometerConfig, MicrometerConfigPayload } from '@/types/micrometerConfig';
import type { OtherSetting, OtherSettingPayload } from '@/types/otherSetting';
import type { ReportHeaderSetting, ReportHeaderSettingPayload } from '@/types/reportHeaderSetting';
import type { SerialPortSetting, SerialPortSettingPayload } from '@/types/serialPortSetting';
import type { ToolbarState, ToolbarStatePayload } from '@/types/toolbarState';
import type { XYZPlatformSettings, XYZPlatformSettingsPayload } from '@/types/xyzPlatformSettings';

const SINGLE = 'CURRENT';

export const settingsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getCalibrationSettings: build.query<CalibrationSettings[], void>({
      query: () => '/api/calibration-settings',
      providesTags: [{ type: 'CalibrationSettings', id: SINGLE }],
    }),
    createCalibrationSettings: build.mutation<CalibrationSettings, CalibrationSettingsSavePayload>({
      query: (body) => ({ url: '/api/calibration-settings', method: 'POST', body }),
      invalidatesTags: [{ type: 'CalibrationSettings', id: SINGLE }],
    }),
    updateCalibrationSettings: build.mutation<CalibrationSettings, { id: string; values: CalibrationSettingsSavePayload }>({
      query: ({ id, values }) => ({ url: `/api/calibration-settings/${id}`, method: 'PUT', body: values }),
      invalidatesTags: [{ type: 'CalibrationSettings', id: SINGLE }],
    }),

    getAutoMeasureSettings: build.query<AutoMeasureSettings[], void>({
      query: () => '/api/auto-measure-settings',
      providesTags: [{ type: 'AutoMeasureSettings', id: SINGLE }],
    }),
    createAutoMeasureSettings: build.mutation<AutoMeasureSettings, AutoMeasureSettingsPayload>({
      query: (body) => ({ url: '/api/auto-measure-settings', method: 'POST', body }),
      invalidatesTags: [{ type: 'AutoMeasureSettings', id: SINGLE }],
    }),
    updateAutoMeasureSettings: build.mutation<AutoMeasureSettings, { id: string; values: AutoMeasureSettingsPayload }>({
      query: ({ id, values }) => ({ url: `/api/auto-measure-settings/${id}`, method: 'PUT', body: values }),
      invalidatesTags: [{ type: 'AutoMeasureSettings', id: SINGLE }],
    }),

    getDepthImageSettings: build.query<DepthImageSetting[], void>({
      query: () => '/api/depth-image-settings',
      providesTags: [{ type: 'DepthImageSettings', id: SINGLE }],
    }),
    createDepthImageSetting: build.mutation<DepthImageSetting, DepthImageSettingPayload>({
      query: (body) => ({ url: '/api/depth-image-settings', method: 'POST', body }),
      invalidatesTags: [{ type: 'DepthImageSettings', id: SINGLE }],
    }),
    updateDepthImageSetting: build.mutation<DepthImageSetting, { id: string; values: DepthImageSettingPayload }>({
      query: ({ id, values }) => ({ url: `/api/depth-image-settings/${id}`, method: 'PUT', body: values }),
      invalidatesTags: [{ type: 'DepthImageSettings', id: SINGLE }],
    }),

    getGenericSetting: build.query<GenericSetting[], void>({
      query: () => '/api/generic-setting',
      providesTags: [{ type: 'GenericSetting', id: SINGLE }],
    }),
    createGenericSetting: build.mutation<GenericSetting, GenericSettingPayload>({
      query: (body) => ({ url: '/api/generic-setting', method: 'POST', body }),
      invalidatesTags: [{ type: 'GenericSetting', id: SINGLE }],
    }),
    updateGenericSetting: build.mutation<GenericSetting, { id: string; values: GenericSettingPayload }>({
      query: ({ id, values }) => ({ url: `/api/generic-setting/${id}`, method: 'PUT', body: values }),
      invalidatesTags: [{ type: 'GenericSetting', id: SINGLE }],
    }),

    getLineColorSetting: build.query<LineColorSetting[], void>({
      query: () => '/api/line-color-setting',
      providesTags: [{ type: 'LineColorSetting', id: SINGLE }],
    }),
    createLineColorSetting: build.mutation<LineColorSetting, LineColorSettingPayload>({
      query: (body) => ({ url: '/api/line-color-setting', method: 'POST', body }),
      invalidatesTags: [{ type: 'LineColorSetting', id: SINGLE }],
    }),
    updateLineColorSetting: build.mutation<LineColorSetting, { id: string; values: LineColorSettingPayload }>({
      query: ({ id, values }) => ({ url: `/api/line-color-setting/${id}`, method: 'PUT', body: values }),
      invalidatesTags: [{ type: 'LineColorSetting', id: SINGLE }],
    }),

    getOtherSetting: build.query<OtherSetting[], void>({
      query: () => '/api/other-setting',
      providesTags: [{ type: 'OtherSetting', id: SINGLE }],
    }),
    createOtherSetting: build.mutation<OtherSetting, OtherSettingPayload>({
      query: (body) => ({ url: '/api/other-setting', method: 'POST', body }),
      invalidatesTags: [{ type: 'OtherSetting', id: SINGLE }],
    }),
    updateOtherSetting: build.mutation<OtherSetting, { id: string; values: OtherSettingPayload }>({
      query: ({ id, values }) => ({ url: `/api/other-setting/${id}`, method: 'PUT', body: values }),
      invalidatesTags: [{ type: 'OtherSetting', id: SINGLE }],
    }),

    getReportHeaderSettings: build.query<ReportHeaderSetting[], void>({
      query: () => '/api/report-header-setting',
      providesTags: [{ type: 'ReportHeaderSetting', id: SINGLE }],
    }),
    createReportHeaderSetting: build.mutation<ReportHeaderSetting, ReportHeaderSettingPayload>({
      query: (body) => ({ url: '/api/report-header-setting', method: 'POST', body }),
      invalidatesTags: [{ type: 'ReportHeaderSetting', id: SINGLE }],
    }),
    updateReportHeaderSetting: build.mutation<ReportHeaderSetting, { id: string; values: ReportHeaderSettingPayload }>({
      query: ({ id, values }) => ({ url: `/api/report-header-setting/${id}`, method: 'PUT', body: values }),
      invalidatesTags: [{ type: 'ReportHeaderSetting', id: SINGLE }],
    }),

    getSerialPortSetting: build.query<SerialPortSetting[], void>({
      query: () => '/api/serial-port-setting',
      providesTags: [{ type: 'SerialPortSetting', id: SINGLE }],
    }),
    createSerialPortSetting: build.mutation<SerialPortSetting, SerialPortSettingPayload>({
      query: (body) => ({ url: '/api/serial-port-setting', method: 'POST', body }),
      invalidatesTags: [{ type: 'SerialPortSetting', id: SINGLE }],
    }),
    updateSerialPortSetting: build.mutation<SerialPortSetting, { id: string; values: SerialPortSettingPayload }>({
      query: ({ id, values }) => ({ url: `/api/serial-port-setting/${id}`, method: 'PUT', body: values }),
      invalidatesTags: [{ type: 'SerialPortSetting', id: SINGLE }],
    }),

    getMicrometerConfig: build.query<MicrometerConfig[], void>({
      query: () => '/api/micrometer-config',
      providesTags: [{ type: 'MicrometerConfig', id: SINGLE }],
    }),
    createMicrometerConfig: build.mutation<MicrometerConfig, MicrometerConfigPayload>({
      query: (body) => ({ url: '/api/micrometer-config', method: 'POST', body }),
      invalidatesTags: [{ type: 'MicrometerConfig', id: SINGLE }],
    }),
    updateMicrometerConfig: build.mutation<MicrometerConfig, { id: string; values: MicrometerConfigPayload }>({
      query: ({ id, values }) => ({ url: `/api/micrometer-config/${id}`, method: 'PUT', body: values }),
      invalidatesTags: [{ type: 'MicrometerConfig', id: SINGLE }],
    }),

    getCameraSetting: build.query<CameraSetting[], void>({
      query: () => '/api/camera-setting',
      providesTags: [{ type: 'CameraSetting', id: SINGLE }],
    }),
    createCameraSetting: build.mutation<CameraSetting, CameraSettingPayload>({
      query: (body) => ({ url: '/api/camera-setting', method: 'POST', body }),
      invalidatesTags: [{ type: 'CameraSetting', id: SINGLE }],
    }),
    updateCameraSetting: build.mutation<CameraSetting, { id: string; values: CameraSettingPayload }>({
      query: ({ id, values }) => ({ url: `/api/camera-setting/${id}`, method: 'PUT', body: values }),
      invalidatesTags: [{ type: 'CameraSetting', id: SINGLE }],
    }),

    getMachineSettings: build.query<MachineSettings[], void>({
      query: () => '/api/machine-settings',
      providesTags: [{ type: 'MachineSettings', id: SINGLE }],
    }),
    createMachineSettings: build.mutation<MachineSettings, MachineSettingsPayload>({
      query: (body) => ({ url: '/api/machine-settings', method: 'POST', body }),
      invalidatesTags: [{ type: 'MachineSettings', id: SINGLE }],
    }),
    updateMachineSettings: build.mutation<MachineSettings, { id: string; values: MachineSettingsPayload }>({
      query: ({ id, values }) => ({ url: `/api/machine-settings/${id}`, method: 'PUT', body: values }),
      invalidatesTags: [{ type: 'MachineSettings', id: SINGLE }],
    }),

    getToolbarStates: build.query<ToolbarState[], void>({
      query: () => '/api/toolbar-states',
      providesTags: [{ type: 'ToolbarState', id: SINGLE }],
    }),
    createToolbarState: build.mutation<ToolbarState, ToolbarStatePayload>({
      query: (body) => ({ url: '/api/toolbar-states', method: 'POST', body }),
      invalidatesTags: [{ type: 'ToolbarState', id: SINGLE }],
    }),
    updateToolbarState: build.mutation<ToolbarState, { id: string; values: ToolbarStatePayload }>({
      query: ({ id, values }) => ({ url: `/api/toolbar-states/${id}`, method: 'PUT', body: values }),
      invalidatesTags: [{ type: 'ToolbarState', id: SINGLE }],
    }),

    getXyzPlatformSettings: build.query<XYZPlatformSettings[], void>({
      query: () => '/api/xyz-platform-settings',
      providesTags: [{ type: 'XyzPlatformSettings', id: SINGLE }],
    }),
    createXyzPlatformSettings: build.mutation<XYZPlatformSettings, XYZPlatformSettingsPayload>({
      query: (body) => ({ url: '/api/xyz-platform-settings', method: 'POST', body }),
      invalidatesTags: [{ type: 'XyzPlatformSettings', id: SINGLE }],
    }),
    updateXyzPlatformSettings: build.mutation<XYZPlatformSettings, { id: string; values: XYZPlatformSettingsPayload }>({
      query: ({ id, values }) => ({ url: `/api/xyz-platform-settings/${id}`, method: 'PUT', body: values }),
      invalidatesTags: [{ type: 'XyzPlatformSettings', id: SINGLE }],
    }),

    restoreFactorySettings: build.mutation<void, void>({
      query: () => ({ url: '/api/factory-reset', method: 'POST' }),
      invalidatesTags: [
        'Measurement',
        'Calibration',
        'CalibrationSettings',
        'AutoMeasureSettings',
        'CameraSetting',
        'MachineSettings',
        'MicrometerConfig',
        'SerialPortSetting',
        'LineColorSetting',
        'DepthImageSettings',
        'GenericSetting',
        'OtherSetting',
        'ReportHeaderSetting',
        'TestRecord',
        'AlbumItem',
        'ToolbarState',
        'XyzPlatformState',
      ],
    }),
  }),
});

export const {
  useGetCalibrationSettingsQuery,
  useCreateCalibrationSettingsMutation,
  useUpdateCalibrationSettingsMutation,
  useGetAutoMeasureSettingsQuery,
  useCreateAutoMeasureSettingsMutation,
  useUpdateAutoMeasureSettingsMutation,
  useGetDepthImageSettingsQuery,
  useCreateDepthImageSettingMutation,
  useUpdateDepthImageSettingMutation,
  useGetGenericSettingQuery,
  useCreateGenericSettingMutation,
  useUpdateGenericSettingMutation,
  useGetLineColorSettingQuery,
  useCreateLineColorSettingMutation,
  useUpdateLineColorSettingMutation,
  useGetOtherSettingQuery,
  useCreateOtherSettingMutation,
  useUpdateOtherSettingMutation,
  useGetReportHeaderSettingsQuery,
  useCreateReportHeaderSettingMutation,
  useUpdateReportHeaderSettingMutation,
  useGetSerialPortSettingQuery,
  useCreateSerialPortSettingMutation,
  useUpdateSerialPortSettingMutation,
  useGetMicrometerConfigQuery,
  useCreateMicrometerConfigMutation,
  useUpdateMicrometerConfigMutation,
  useGetCameraSettingQuery,
  useCreateCameraSettingMutation,
  useUpdateCameraSettingMutation,
  useGetMachineSettingsQuery,
  useCreateMachineSettingsMutation,
  useUpdateMachineSettingsMutation,
  useGetToolbarStatesQuery,
  useCreateToolbarStateMutation,
  useUpdateToolbarStateMutation,
  useGetXyzPlatformSettingsQuery,
  useCreateXyzPlatformSettingsMutation,
  useUpdateXyzPlatformSettingsMutation,
  useRestoreFactorySettingsMutation,
} = settingsApi;
