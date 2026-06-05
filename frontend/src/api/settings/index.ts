import type {
  AutoMeasureSettings,
  AutoMeasureSettingsPayload,
} from '@/types/autoMeasureSettings';
import type {
  DepthImageSetting,
  DepthImageSettingPayload,
} from '@/types/depthImageSetting';
import type { GenericSetting, GenericSettingPayload } from '@/types/genericSetting';
import type { LineColorSetting, LineColorSettingPayload } from '@/types/lineColorSetting';
import type { OtherSetting, OtherSettingPayload } from '@/types/otherSetting';
import type {
  ReportHeaderSetting,
  ReportHeaderSettingPayload,
} from '@/types/reportHeaderSetting';
import { apiClient } from '../_client';

export const getAutoMeasureSettings = () =>
  apiClient.get<AutoMeasureSettings[]>('/api/auto-measure-settings');

export const createAutoMeasureSettings = (payload: AutoMeasureSettingsPayload) =>
  apiClient.post<AutoMeasureSettings>('/api/auto-measure-settings', payload);

export const updateAutoMeasureSettings = (
  id: string,
  payload: AutoMeasureSettingsPayload
) => apiClient.put<AutoMeasureSettings>(`/api/auto-measure-settings/${id}`, payload);

export const getDepthImageSettings = () =>
  apiClient.get<DepthImageSetting[]>('/api/depth-image-settings');

export const createDepthImageSetting = (payload: DepthImageSettingPayload) =>
  apiClient.post<DepthImageSetting>('/api/depth-image-settings', payload);

export const updateDepthImageSetting = (id: string, payload: DepthImageSettingPayload) =>
  apiClient.put<DepthImageSetting>(`/api/depth-image-settings/${id}`, payload);

export const getGenericSetting = () =>
  apiClient.get<GenericSetting[]>('/api/generic-setting');

export const createGenericSetting = (payload: GenericSettingPayload) =>
  apiClient.post<GenericSetting>('/api/generic-setting', payload);

export const updateGenericSetting = (id: string, payload: GenericSettingPayload) =>
  apiClient.put<GenericSetting>(`/api/generic-setting/${id}`, payload);

export const getLineColorSetting = () =>
  apiClient.get<LineColorSetting[]>('/api/line-color-setting');

export const createLineColorSetting = (payload: LineColorSettingPayload) =>
  apiClient.post<LineColorSetting>('/api/line-color-setting', payload);

export const updateLineColorSetting = (id: string, payload: LineColorSettingPayload) =>
  apiClient.put<LineColorSetting>(`/api/line-color-setting/${id}`, payload);

export const getOtherSetting = () => apiClient.get<OtherSetting[]>('/api/other-setting');

export const createOtherSetting = (payload: OtherSettingPayload) =>
  apiClient.post<OtherSetting>('/api/other-setting', payload);

export const updateOtherSetting = (id: string, payload: OtherSettingPayload) =>
  apiClient.put<OtherSetting>(`/api/other-setting/${id}`, payload);

export const getReportHeaderSettings = () =>
  apiClient.get<ReportHeaderSetting[]>('/api/report-header-setting');

export const createReportHeaderSetting = (payload: ReportHeaderSettingPayload) =>
  apiClient.post<ReportHeaderSetting>('/api/report-header-setting', payload);

export const updateReportHeaderSetting = (
  id: string,
  payload: Partial<ReportHeaderSettingPayload>
) => apiClient.put<ReportHeaderSetting>(`/api/report-header-setting/${id}`, payload);

export const restoreFactorySettings = () => apiClient.post<void>('/api/factory-reset');
