import { Fragment, memo, useCallback, useState, type ComponentType } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import type { SxProps, Theme } from '@mui/material/styles';

import { colors } from '@/theme/theme';
import type { ToolbarActionId } from '@/types/tool';

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
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import LineWeightIcon from '@mui/icons-material/LineWeight';
import TuneIcon from '@mui/icons-material/Tune';

type ToolbarItemDef = {
  action: ToolbarActionId;
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
  { action: 'tools:clearGraphics', label: 'Clear Graphics', icon: BackspaceIcon },
  { action: 'tools:magnifier', label: 'Magnifier', icon: SearchIcon, groupEnd: true },

  { action: 'tools:resumeImage', label: 'Resume Image', icon: RestartAltIcon },
  { action: 'tools:centerCrossLine', label: 'Center Cross Line', icon: AddIcon, groupEnd: true },
  { action: 'config:calibration', label: 'Calibration', icon: TuneIcon, groupEnd: true },
];

const LINE_THICKNESS_MENU: ReadonlyArray<{
  action: Extract<ToolbarActionId, 'tools:lineThin' | 'tools:lineNormal' | 'tools:lineThick'>;
  label: string;
  px: number;
}> = [
  { action: 'tools:lineThin', label: 'Thin', px: 1 },
  { action: 'tools:lineNormal', label: 'Normal', px: 2 },
  { action: 'tools:lineThick', label: 'Thick', px: 4 },
];

const BAR_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  px: '6px',
  py: '4px',
  bgcolor: colors.headingPrimary,
  borderBottom: 1,
  borderColor: colors.border,
  flexWrap: 'nowrap',
  overflow: 'hidden',
};

const SPACER_SX: SxProps<Theme> = {
  width: '1px',
  height: '22px',
  bgcolor: 'rgba(255, 255, 255, 0.18)',
  flexShrink: 0,
};

const ICON_BUTTON_SX: SxProps<Theme> = {
  width: 36,
  height: 36,
  flexShrink: 0,
  borderRadius: 0.5,
  color: '#FFFFFF',
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  '& .MuiSvgIcon-root': { fontSize: 18, width: 18, height: 18 },
  '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.12)' },
};

type ToolbarButtonProps = {
  item: ToolbarItemDef;
  onSelect: (action: ToolbarActionId) => void;
};

const ToolbarButton = memo(function ToolbarButton({ item, onSelect }: ToolbarButtonProps) {
  const Icon = item.icon;

  const handleClick = useCallback(() => {
    onSelect(item.action);
  }, [item.action, onSelect]);

  return (
    <Tooltip title={item.label} arrow placement="bottom" enterDelay={300} disableInteractive>
      <IconButton
        size="small"
        onClick={handleClick}
        aria-label={item.label}
        sx={ICON_BUTTON_SX}
      >
        <Icon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
});

type LineThicknessMenuProps = {
  onSelect: (action: ToolbarActionId) => void;
};

const LineThicknessMenuButton = memo(function LineThicknessMenuButton({
  onSelect,
}: LineThicknessMenuProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = anchorEl !== null;

  const handleOpen = useCallback((event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
    // eslint-disable-next-line no-console
    console.log('[line-thickness-dropdown-open]');
  }, []);

  const handleClose = useCallback(() => {
    setAnchorEl(null);
  }, []);

  const handlePick = useCallback(
    (action: ToolbarActionId) => {
      onSelect(action);
      setAnchorEl(null);
    },
    [onSelect]
  );

  return (
    <>
      <Tooltip title="Lines" arrow placement="bottom" enterDelay={300} disableInteractive>
        <IconButton
          size="small"
          onClick={handleOpen}
          aria-label="Lines"
          aria-haspopup="menu"
          aria-expanded={open}
          sx={ICON_BUTTON_SX}
        >
          <LineWeightIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchorEl} open={open} onClose={handleClose}>
        {LINE_THICKNESS_MENU.map((item) => (
          <MenuItem
            key={item.action}
            dense
            onClick={() => handlePick(item.action)}
          >
            {item.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
});

type Props = {
  onSelect: (action: ToolbarActionId) => void;
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
      <LineThicknessMenuButton onSelect={onSelect} />
    </Box>
  );
}

export default memo(ToolbarImpl);
