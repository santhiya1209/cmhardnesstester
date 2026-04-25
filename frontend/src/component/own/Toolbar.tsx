import { Fragment, memo, useCallback, type ComponentType } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import type { SxProps, Theme } from '@mui/material/styles';

import { colors } from '@/theme/theme';

import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import SaveIcon from '@mui/icons-material/Save';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import NearMeIcon from '@mui/icons-material/NearMe';
import StraightenIcon from '@mui/icons-material/Straighten';
import ChangeHistoryIcon from '@mui/icons-material/ChangeHistory';
import BackspaceIcon from '@mui/icons-material/Backspace';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import AddIcon from '@mui/icons-material/Add';

type ToolbarItemDef = {
  action: string;
  label: string;
  icon: ComponentType<SvgIconProps>;
  groupEnd?: boolean;
};

const TOOLBAR_ITEMS: ToolbarItemDef[] = [
  { action: 'file:open', label: 'Open Image', icon: FolderOpenIcon },
  { action: 'file:save', label: 'Save Image', icon: SaveIcon, groupEnd: true },

  { action: 'device:openCamera', label: 'Open Camera', icon: PlayArrowIcon },
  { action: 'device:closeCamera', label: 'Close Camera', icon: PauseIcon, groupEnd: true },

  { action: 'tools:autoMeasure', label: 'Auto Measure', icon: CenterFocusStrongIcon },
  { action: 'tools:manualMeasure', label: 'Manual Measure', icon: TouchAppIcon, groupEnd: true },

  { action: 'tools:pointer', label: 'Pointer', icon: NearMeIcon },
  { action: 'tools:measureLength', label: 'Measure Length', icon: StraightenIcon },
  { action: 'tools:measureAngle', label: 'Measure Angle', icon: ChangeHistoryIcon },
  { action: 'tools:eraser', label: 'Eraser', icon: BackspaceIcon, groupEnd: true },

  { action: 'tools:zoomIn', label: 'Zoom In', icon: ZoomInIcon },
  { action: 'tools:zoomOut', label: 'Zoom Out', icon: ZoomOutIcon },
  { action: 'tools:centerCrossLine', label: 'Center Cross Line', icon: AddIcon },
];

const BAR_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: 0.25,
  px: 0.5,
  py: 0.5,
  bgcolor: colors.headingPrimary,
  borderBottom: 1,
  borderColor: colors.border,
};

const SPACER_SX: SxProps<Theme> = { width: 8 };

const ICON_BUTTON_SX: SxProps<Theme> = {
  borderRadius: 0.5,
  color: '#FFFFFF',
  p: 0.5,
  '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.12)' },
};

type ToolbarButtonProps = {
  item: ToolbarItemDef;
  onSelect: (action: string) => void;
};

const ToolbarButton = memo(function ToolbarButton({ item, onSelect }: ToolbarButtonProps) {
  const Icon = item.icon;

  const handleClick = useCallback(() => {
    onSelect(item.action);
  }, [item.action, onSelect]);

  return (
    <Tooltip title={item.label} arrow placement="bottom" enterDelay={300} disableInteractive>
      <IconButton size="small" onClick={handleClick} aria-label={item.label} sx={ICON_BUTTON_SX}>
        <Icon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
});

type Props = {
  onSelect: (action: string) => void;
};

function ToolbarImpl({ onSelect }: Props) {
  return (
    <Box sx={BAR_SX}>
      {TOOLBAR_ITEMS.map((item) => (
        <Fragment key={item.action}>
          <ToolbarButton item={item} onSelect={onSelect} />
          {item.groupEnd && <Box sx={SPACER_SX} />}
        </Fragment>
      ))}
    </Box>
  );
}

export default memo(ToolbarImpl);
