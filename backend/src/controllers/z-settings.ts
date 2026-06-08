import type { Request, Response } from 'express';
import { zSettingsService } from '../lib/services/z-settings.service';
import {
  PreviewZAxisSettingsSchema,
  SaveZAxisSettingsSchema,
} from '../zod/z-axis-settings.schema';

export async function getZSettings(_req: Request, res: Response): Promise<void> {
  res.json({ ok: true, settings: await zSettingsService.get() });
}

export async function saveZSettings(req: Request, res: Response): Promise<void> {
  const parsed = SaveZAxisSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'ValidationError', details: parsed.error.flatten() });
    return;
  }
  res.json({ ok: true, settings: await zSettingsService.save(parsed.data) });
}

export async function previewZSettings(req: Request, res: Response): Promise<void> {
  const parsed = PreviewZAxisSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'ValidationError', details: parsed.error.flatten() });
    return;
  }
  res.json({ ok: true, settings: await zSettingsService.preview(parsed.data.imageSelection) });
}

export async function revertZSettings(_req: Request, res: Response): Promise<void> {
  res.json({ ok: true, settings: await zSettingsService.revert() });
}
