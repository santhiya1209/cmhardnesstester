import axios from 'axios';
import type { ReportHeaderSetting } from '@/types/reportHeaderSetting';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function getReportHeaderSettings(): Promise<ReportHeaderSetting[]> {
  const { data } = await axios.get<ReportHeaderSetting[]>(
    `${API_BASE_URL}/api/report-header-setting`
  );
  return data;
}
