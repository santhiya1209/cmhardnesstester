import { memo } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

const SECTION_SX: SxProps<Theme> = { flex: 1, minHeight: 220 };

function AlbumTabImpl() {
  return <Box sx={SECTION_SX} />;
}

export default memo(AlbumTabImpl);
