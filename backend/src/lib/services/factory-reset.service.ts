import { randomUUID } from 'node:crypto';
import { mutateDatabase } from '../db';
import { AutoMeasureSettingsModel } from '../../models/auto-measure-settings';
import { GenericSettingModel } from '../../models/generic-setting';
import { LineColorSettingModel } from '../../models/line-color-setting';
import { MachineSettingsModel } from '../../models/machine-settings';
import { OtherSettingModel } from '../../models/other-setting';
import { SerialPortSettingModel } from '../../models/serial-port-setting';

export async function resetToFactory(): Promise<void> {
  await mutateDatabase((database) => {
    const now = new Date().toISOString();
    const stamp = { createdAt: now, updatedAt: now };

    const machineSettings = [
      MachineSettingsModel.parse({
        id: randomUUID(),
        force: '0.5kgf',
        lightness: 5,
        loadTime: 5,
        objective: '10X',
        hardnessLevel: 'Middle',
        ...stamp,
      }),
    ];

    const autoMeasureSettings = [
      AutoMeasureSettingsModel.parse({
        id: randomUUID(),
        smoothing: 15,
        threshold: 134,
        turretAfterImpress: true,
        measureAfterImpress: true,
        objectiveForMeasure: '20X',
        ...stamp,
      }),
    ];

    const lineColorSettings = [
      LineColorSettingModel.parse({
        id: randomUUID(),
        lineColor: 'Purple',
        updatedAt: now,
      }),
    ];

    const serialPortSettings = [
      SerialPortSettingModel.parse({
        id: randomUUID(),
        mainPortName: 'COM1',
        xyPortName: 'COM2',
        zPortName: 'COM3',
        ...stamp,
      }),
    ];

    const genericSettings = [
      GenericSettingModel.parse({
        id: randomUUID(),
        caseDepthHardness: 250,
        hardnessTestMode: 'HV',
        ...stamp,
      }),
    ];

    const otherSettings = [
      OtherSettingModel.parse({
        id: randomUUID(),
        language: 'English',
        hardnessValueAccuracy: 1,
        conversionValueAccuracy: 1,
        hardnessConvertTable: 'Common Convert Table',
        trimFast: 5,
        trimSlow: 1,
        historyImageCount: 0,
        historyImageSizeMb: 0,
        ...stamp,
      }),
    ];

    return {
      database: {
        ...database,
        machineSettings,
        autoMeasureSettings,
        lineColorSettings,
        serialPortSettings,
        genericSettings,
        otherSettings,
        calibrations: [],
        calibrationSettings: [],
      },
      result: undefined,
    };
  });
}
