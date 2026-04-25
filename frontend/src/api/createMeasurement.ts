import axios from 'axios';
import type { Measurement, MeasurementSavePayload } from '@/types/measurement';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function createMeasurement(payload: MeasurementSavePayload): Promise<Measurement> {
  const { data } = await axios.post<Measurement>(`${API_BASE_URL}/api/measurements`, payload);
  return data;
}
