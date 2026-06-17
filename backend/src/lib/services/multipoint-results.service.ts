import type { MultipointResultPayload } from '../../models/multipoint-result';
import { MultipointResultModel, type MultipointResult } from '../../models/multipoint-result';
import { createCrudService } from './create-crud.service';

export type CreateMultipointResultInput = Omit<MultipointResultPayload, 'timestamp'> & {
  timestamp?: string;
};

export type UpdateMultipointResultInput = Partial<CreateMultipointResultInput>;

export const multipointResultsService = createCrudService<
  MultipointResult,
  CreateMultipointResultInput,
  UpdateMultipointResultInput
>({
  collection: 'multipointResults',
  resourceName: 'MultipointResult',
  schema: MultipointResultModel,
  createEntity: (input, { id, now }) => {
    // eslint-disable-next-line no-console
    console.log(
      `[MULTIPOINT_RESULT_SAVE] runId=${input.runId} pointNo=${input.pointNo} indent=${input.indentStatus} measure=${input.measureStatus} hv=${input.hv ?? 'null'} durationMs=${input.durationMs ?? 'null'}`
    );
    return {
      id,
      runId: input.runId,
      pointNo: input.pointNo,
      pointId: input.pointId ?? null,
      pass: input.pass ?? null,
      xMm: input.xMm,
      yMm: input.yMm,
      focusStatus: input.focusStatus ?? 'not-available',
      indentStatus: input.indentStatus ?? 'pending',
      measureStatus: input.measureStatus ?? 'pending',
      hv: input.hv ?? null,
      d1Um: input.d1Um ?? null,
      d2Um: input.d2Um ?? null,
      averageUm: input.averageUm ?? null,
      testForceKgf: input.testForceKgf ?? null,
      objective: input.objective ?? null,
      confidence: input.confidence ?? null,
      measurementId: input.measurementId ?? null,
      imageDataUrl: input.imageDataUrl ?? null,
      diamond: input.diamond ?? null,
      centerNorm: input.centerNorm ?? null,
      operator: input.operator ?? null,
      durationMs: input.durationMs ?? null,
      timestamp: input.timestamp ?? now,
      createdAt: now,
      updatedAt: now,
    };
  },
  updateEntity: (current, input, { now }) => ({
    ...current,
    ...input,
    pointId: input.pointId === undefined ? current.pointId : input.pointId,
    pass: input.pass === undefined ? current.pass : input.pass,
    focusStatus: input.focusStatus ?? current.focusStatus,
    indentStatus: input.indentStatus ?? current.indentStatus,
    measureStatus: input.measureStatus ?? current.measureStatus,
    hv: input.hv === undefined ? current.hv : input.hv,
    d1Um: input.d1Um === undefined ? current.d1Um : input.d1Um,
    d2Um: input.d2Um === undefined ? current.d2Um : input.d2Um,
    averageUm: input.averageUm === undefined ? current.averageUm : input.averageUm,
    testForceKgf: input.testForceKgf === undefined ? current.testForceKgf : input.testForceKgf,
    objective: input.objective === undefined ? current.objective : input.objective,
    confidence: input.confidence === undefined ? current.confidence : input.confidence,
    measurementId: input.measurementId === undefined ? current.measurementId : input.measurementId,
    operator: input.operator === undefined ? current.operator : input.operator,
    durationMs: input.durationMs === undefined ? current.durationMs : input.durationMs,
    timestamp: input.timestamp ?? current.timestamp,
    updatedAt: now,
  }),
});
