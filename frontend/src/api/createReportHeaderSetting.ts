import axios from 'axios';
import type {
  ReportHeaderSetting,
  ReportHeaderSettingPayload,
} from '@/types/reportHeaderSetting';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function createReportHeaderSetting(
  payload: ReportHeaderSettingPayload
): Promise<ReportHeaderSetting> {
  const { data } = await axios.post<ReportHeaderSetting>(
    `${API_BASE_URL}/api/report-header-setting`,
    payload
  );
  return data;
}
