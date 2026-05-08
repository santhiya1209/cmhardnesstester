import { createCrudController } from './create-crud-controller';
import { reportHeaderSettingService } from '../lib/services/report-header-setting.service';

export const {
  create: createReportHeaderSetting,
  getAll: getReportHeaderSettings,
  getById: getReportHeaderSettingById,
  update: updateReportHeaderSetting,
  remove: deleteReportHeaderSetting,
} = createCrudController(reportHeaderSettingService);
