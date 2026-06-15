import { useEffect } from 'react';
import { useAppSelector } from '@/store/hooks';
import { selectPatternMode } from '@/store/slices/multipoint.selectors';

type Props = {
  /** Pins/unpins the live-camera reticle. Stable identity (from useImageOverlay). */
  onLockChange: (locked: boolean) => void;
};

/**
 * Renders nothing — its only job is to pin the center reticle ON while the
 * Multipoint pattern is in 'Horizontal Capture Mode' (the legacy workflow that
 * requires a permanent sighting reticle). Isolating the Redux mode subscription
 * here keeps the giant App root from re-rendering on every mode change.
 */
function ReticleModeLock({ onLockChange }: Props) {
  const mode = useAppSelector(selectPatternMode);
  const locked = mode === 'Horizontal Capture Mode';
  useEffect(() => {
    onLockChange(locked);
  }, [locked, onLockChange]);
  return null;
}

export default ReticleModeLock;
