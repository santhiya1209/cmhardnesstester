import axios from 'axios';
import type {
  ReportHeaderSetting,
  ReportHeaderSettingPayload,
} from '@/types/reportHeaderSetting';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function updateReportHeaderSetting(
  id: string,
  payload: Partial<ReportHeaderSettingPayload>
): Promise<ReportHeaderSetting> {
  const { data } = await axios.put<ReportHeaderSetting>(
    `${API_BASE_URL}/api/report-header-setting/${id}`,
    payload
  );
  return data;
}
