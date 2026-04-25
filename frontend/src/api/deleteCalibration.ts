import axios from 'axios';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function deleteCalibration(id: string): Promise<void> {
  await axios.delete(`${API_BASE_URL}/api/calibrations/${id}`);
}
