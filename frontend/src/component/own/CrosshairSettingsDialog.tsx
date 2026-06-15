import { memo } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Slider from '@mui/material/Slider';

import type { CrosshairConfig } from '@/types/crosshair';

type Props = {
  open: boolean;
  onClose: () => void;
  config: CrosshairConfig;
  onChange: (next: Partial<CrosshairConfig>) => void;
  visible: boolean;
  onToggleVisible: () => void;
};

// Preset crosshair line colours. Yellow is the industrial-microscope default;
// the rest cover common contrast needs against bright/dark samples.
const COLOR_PRESETS = ['#FFEB3B', '#FFFFFF', '#FF5252', '#76FF03', '#00E5FF'] as const;

function CrosshairSettingsDialogImpl({
  open,
  onClose,
  config,
  onChange,
  visible,
  onToggleVisible,
}: Props) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Crosshair Settings</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3} sx={{ pt: 1 }}>
          <FormControlLabel
            control={<Switch checked={visible} onChange={onToggleVisible} size="small" />}
            label="Show crosshair"
          />

          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Crosshair colour
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              {COLOR_PRESETS.map((preset) => {
                const selected = config.color.toLowerCase() === preset.toLowerCase();
                return (
                  <Box
                    key={preset}
                    role="button"
                    aria-label={`Set crosshair colour ${preset}`}
                    onClick={() => onChange({ color: preset })}
                    sx={{
                      width: 26,
                      height: 26,
                      borderRadius: 1,
                      bgcolor: preset,
                      cursor: 'pointer',
                      boxShadow: selected ? 3 : 0,
                      outline: (theme) =>
                        selected ? `2px solid ${theme.palette.primary.main}` : '1px solid rgba(0,0,0,0.25)',
                      outlineOffset: 1,
                    }}
                  />
                );
              })}
              <Box
                component="input"
                type="color"
                aria-label="Custom crosshair colour"
                value={config.color}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ color: e.target.value })}
                sx={{
                  width: 32,
                  height: 28,
                  p: 0,
                  border: '1px solid rgba(0,0,0,0.25)',
                  borderRadius: 1,
                  bgcolor: 'transparent',
                  cursor: 'pointer',
                }}
              />
            </Stack>
          </Box>

          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Line thickness — {config.thickness}px
            </Typography>
            <Slider
              value={config.thickness}
              min={1}
              max={5}
              step={1}
              marks
              valueLabelDisplay="auto"
              onChange={(_, value) => onChange({ thickness: value as number })}
            />
          </Box>

          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Center marker size — {config.markerSize}px
            </Typography>
            <Slider
              value={config.markerSize}
              min={4}
              max={24}
              step={1}
              valueLabelDisplay="auto"
              onChange={(_, value) => onChange({ markerSize: value as number })}
            />
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export default memo(CrosshairSettingsDialogImpl);
