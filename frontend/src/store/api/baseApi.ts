import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { API_BASE_URL } from '@/utils/baseUrl';

/**
 * Single RTK Query API for all HTTP CRUD. Domain endpoints are attached via
 * `baseApi.injectEndpoints` in `store/api/<domain>Api.ts`, and the hand-written
 * `hooks/queries|mutations` hooks are thin adapters over the generated hooks so
 * every consumer keeps its existing shape. IPC/bridge calls (machine, xyz,
 * camera commands) are NOT CRUD and stay on their own hooks.
 */
export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({ baseUrl: API_BASE_URL }),
  tagTypes: [
    'Measurement',
    'MultipointResult',
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
    'PatternProgram',
    'TestRecord',
    'AlbumItem',
    'ToolbarState',
    'XyzPlatformState',
    'XyzPlatformSettings',
    'Health',
  ],
  endpoints: () => ({}),
});
