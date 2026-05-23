import { Fragment, memo, useCallback, useMemo, useRef, useState } from 'react';
import AppBar from '@mui/material/AppBar';
import MuiToolbar from '@mui/material/Toolbar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import type { MenuActionId } from '@/types/menu';

const BAR_HEIGHT = 24;

type MenuItemDef = {
  label: string;
  action: MenuActionId;
  dividerBefore?: boolean;
  shortcut?: string;
};

type TopMenuDef = {
  id: string;
  label: string;
  items: MenuItemDef[];
};

const TOP_MENUS: TopMenuDef[] = [
  {
    id: 'file',
    label: 'File',
    items: [
      { label: 'Open Image', action: 'file:open', shortcut: 'Ctrl+O' },
      { label: 'Save Image', action: 'file:save', shortcut: 'Ctrl+S' },
      { label: 'Save Original Image', action: 'file:saveOriginal' },
      { label: 'Exit', action: 'file:exit', dividerBefore: true, shortcut: 'Alt+F4' },
    ],
  },
  {
    id: 'device',
    label: 'Device',
    items: [
      { label: 'Open Camera', action: 'device:openCamera' },
      { label: 'Close Camera', action: 'device:closeCamera' },
    ],
  },
  {
    id: 'data',
    label: 'Data',
    items: [{ label: 'Sample Info', action: 'data:sampleInfo' }],
  },
  {
    id: 'tools',
    label: 'Tools',
    items: [
      { label: 'Auto Measure', action: 'tools:autoMeasure' },
      { label: 'Manual Measure', action: 'tools:manualMeasure' },
      { label: 'Pointer', action: 'tools:pointer' },
      { label: 'Measure Length', action: 'tools:measureLength', dividerBefore: true },
      { label: 'Measure Angle', action: 'tools:measureAngle' },
      { label: 'Magnifier', action: 'tools:magnifier' },
      { label: 'Resume Image', action: 'tools:resumeImage', dividerBefore: true },
      { label: 'Clear Graphics', action: 'tools:clearGraphics' },
      { label: 'Trim Measure', action: 'tools:trimMeasure' },
      { label: 'Center Cross Line', action: 'tools:centerCrossLine', dividerBefore: true },
      { label: 'Panoramic Scan', action: 'tools:panoramicScan' },
      { label: 'Auto Search Edge', action: 'tools:autoSearchEdge' },
    ],
  },
  {
    id: 'configuration',
    label: 'Configuration',
    items: [
      { label: 'Line Color Setting', action: 'config:lineColor' },
      { label: 'Calibration', action: 'config:calibration' },
      { label: 'Auto Measure Setting', action: 'config:autoMeasure' },
      { label: 'Micrometer Setting', action: 'config:micrometer' },
      { label: 'Camera Setting', action: 'config:camera', dividerBefore: true },
      { label: 'Serial Port Setting', action: 'config:serialPort' },
      { label: 'XY Platform Setting', action: 'config:xyPlatform' },
      { label: 'Z Axis Setting', action: 'config:zAxis' },
      { label: 'Generic Setting', action: 'config:generic', dividerBefore: true },
      { label: 'Other Setting', action: 'config:other' },
      { label: 'Restore Factory Settings', action: 'config:restoreFactory', dividerBefore: true },
    ],
  },
];

const APPBAR_SX: SxProps<Theme> = {
  width: '100%',
  height: BAR_HEIGHT,
  bgcolor: 'background.paper',
  borderBottom: 1,
  borderColor: 'divider',
};

const TOOLBAR_SX: SxProps<Theme> = {
  minHeight: BAR_HEIGHT,
  height: BAR_HEIGHT,
  px: 0,
  width: '100%',
};

const ROW_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'stretch',
  justifyContent: 'flex-start',
  height: BAR_HEIGHT,
  width: '100%',
};

const BUTTON_BASE_SX = {
  textTransform: 'none',
  height: BAR_HEIGHT,
  minHeight: BAR_HEIGHT,
  minWidth: 0,
  px: 1,
  py: 0,
  borderRadius: 0,
  fontSize: 12,
  lineHeight: 1,
  color: 'text.primary',
  '&:hover': { bgcolor: 'action.hover' },
} as const;

const BUTTON_CLOSED_SX: SxProps<Theme> = { ...BUTTON_BASE_SX, bgcolor: 'transparent' };
const BUTTON_OPEN_SX: SxProps<Theme> = { ...BUTTON_BASE_SX, bgcolor: 'action.selected' };

const MENU_PAPER_SX = { minWidth: 220 } as const;
const MENU_LIST_SX = { p: 0 } as const;
const MENU_SLOT_PROPS = {
  paper: { sx: MENU_PAPER_SX },
  list: { dense: true, sx: MENU_LIST_SX },
} as const;

const MENU_ANCHOR_ORIGIN = { vertical: 'bottom' as const, horizontal: 'left' as const };
const MENU_TRANSFORM_ORIGIN = { vertical: 'top' as const, horizontal: 'left' as const };

const MENU_ITEM_SX: SxProps<Theme> = {
  width: '100%',
  justifyContent: 'flex-start',
  textAlign: 'left',
  px: 1.5,
  pt: 1,
  pb: 0.75,
};

const DIVIDER_SX: SxProps<Theme> = { my: 0.5 };

const PRIMARY_TEXT_SLOT_PROPS = {
  primary: { sx: { textAlign: 'left' as const, fontSize: 13 } },
} as const;

const SHORTCUT_SX: SxProps<Theme> = { ml: 3, color: 'text.secondary' };

type MenuButtonProps = {
  menu: TopMenuDef;
  isOpen: boolean;
  anyOpen: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  onSelect: (action: MenuActionId) => void;
};

const MenuButton = memo(function MenuButton({
  menu,
  isOpen,
  anyOpen,
  onOpen,
  onClose,
  onSelect,
}: MenuButtonProps) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  const handleClick = useCallback(() => {
    onOpen(menu.id);
  }, [menu.id, onOpen]);

  const handleHover = useCallback(() => {
    if (!anyOpen || isOpen) return;
    onOpen(menu.id);
  }, [anyOpen, isOpen, menu.id, onOpen]);

  // Stable onClick handlers for each item, recomputed only when menu/onSelect/onClose change.
  const itemHandlers = useMemo(() => {
    const map: Record<string, () => void> = {};
    for (const item of menu.items) {
      map[item.action] = () => {
        onSelect(item.action);
        onClose();
      };
    }
    return map;
  }, [menu, onSelect, onClose]);

  return (
    <>
      <Button
        ref={anchorRef}
        size="small"
        onClick={handleClick}
        onMouseEnter={handleHover}
        sx={isOpen ? BUTTON_OPEN_SX : BUTTON_CLOSED_SX}
      >
        {menu.label}
      </Button>
      <Menu
        anchorEl={anchorRef.current}
        open={isOpen}
        onClose={onClose}
        anchorOrigin={MENU_ANCHOR_ORIGIN}
        transformOrigin={MENU_TRANSFORM_ORIGIN}
        slotProps={MENU_SLOT_PROPS}
      >
        {menu.items.map((item) => (
          <Fragment key={item.action}>
            {item.dividerBefore && <Divider sx={DIVIDER_SX} />}
            <MenuItem onClick={itemHandlers[item.action]} sx={MENU_ITEM_SX}>
              <ListItemText primary={item.label} slotProps={PRIMARY_TEXT_SLOT_PROPS} />
              {item.shortcut && (
                <Typography variant="caption" sx={SHORTCUT_SX}>
                  {item.shortcut}
                </Typography>
              )}
            </MenuItem>
          </Fragment>
        ))}
      </Menu>
    </>
  );
});

type Props = {
  onSelect?: (action: MenuActionId) => void;
};

function MenuBarImpl({ onSelect }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  const handleOpen = useCallback((id: string) => setOpenId(id), []);
  const handleClose = useCallback(() => setOpenId(null), []);
  const handleSelect = useCallback(
    (action: MenuActionId) => {
      onSelect?.(action);
    },
    [onSelect]
  );

  const anyOpen = openId !== null;

  return (
    <AppBar position="static" elevation={0} color="default" sx={APPBAR_SX}>
      <MuiToolbar disableGutters variant="dense" sx={TOOLBAR_SX}>
        <Box sx={ROW_SX}>
          {TOP_MENUS.map((menu) => (
            <MenuButton
              key={menu.id}
              menu={menu}
              isOpen={openId === menu.id}
              anyOpen={anyOpen}
              onOpen={handleOpen}
              onClose={handleClose}
              onSelect={handleSelect}
            />
          ))}
        </Box>
      </MuiToolbar>
    </AppBar>
  );
}

export default memo(MenuBarImpl);
