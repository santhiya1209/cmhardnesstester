import axios from 'axios';
import type { Measurement, MeasurementSavePayload } from '@/types/measurement';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function updateMeasurement(
  id: string,
  payload: MeasurementSavePayload
): Promise<Measurement> {
  const { data } = await axios.put<Measurement>(`${API_BASE_URL}/api/measurements/${id}`, payload);
  return data;
}
