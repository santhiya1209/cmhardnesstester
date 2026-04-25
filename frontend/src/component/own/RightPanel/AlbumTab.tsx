import { memo, useCallback } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useDeleteAlbumItem } from '@/hooks/mutations/useDeleteAlbumItem';
import type { AlbumItem } from '@/types/albumItem';

const COLUMNS = ['#', 'Title', 'Preview', 'Hardness', 'Captured At', 'Action'];

const SECTION_SX: SxProps<Theme> = {
  px: 1.5,
  py: 1.5,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  minHeight: 220,
};
const TABLE_WRAP_SX: SxProps<Theme> = {
  flex: 1,
  minHeight: 180,
  maxHeight: 260,
  border: 1,
  borderColor: 'divider',
};
const HEAD_CELL_SX: SxProps<Theme> = {
  fontSize: 11,
  fontWeight: 600,
  color: 'text.secondary',
  py: 0.5,
  px: 1,
  whiteSpace: 'nowrap',
};
const BODY_CELL_SX: SxProps<Theme> = { fontSize: 12, py: 0.5, px: 1 };
const EMPTY_CELL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.disabled', textAlign: 'center', py: 6 };
const BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5, minWidth: 96 };
const FOOTER_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 };
const STATUS_TEXT_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };

type Props = {
  albumItems: AlbumItem[];
  albumItemsError: string | null;
  albumItemsLoading: boolean;
  refetchAlbumItems: () => Promise<void>;
};

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function AlbumTabImpl({
  albumItems,
  albumItemsError,
  albumItemsLoading,
  refetchAlbumItems,
}: Props) {
  const { deleting, error: deleteError, removeAlbumItem } = useDeleteAlbumItem();
  const isBusy = albumItemsLoading || deleting;
  const errorMessage = albumItemsError ?? deleteError;

  const handleDeleteItem = useCallback(
    async (id: string) => {
      await removeAlbumItem(id);
      await refetchAlbumItems();
    },
    [refetchAlbumItems, removeAlbumItem]
  );

  const handleClearAlbum = useCallback(async () => {
    for (const item of albumItems) {
      await removeAlbumItem(item.id);
    }

    await refetchAlbumItems();
  }, [albumItems, refetchAlbumItems, removeAlbumItem]);

  return (
    <Box sx={SECTION_SX}>
      <TableContainer sx={TABLE_WRAP_SX}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {COLUMNS.map((column) => (
                <TableCell key={column} sx={HEAD_CELL_SX}>{column}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {albumItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMNS.length} sx={EMPTY_CELL_SX}>
                  No saved depth images.
                </TableCell>
              </TableRow>
            ) : (
              albumItems.map((item, index) => (
                <TableRow key={item.id}>
                  <TableCell sx={BODY_CELL_SX}>{index + 1}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{item.title}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{item.previewLabel}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{item.hardnessImage ? 'Enabled' : 'Disabled'}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{formatDateTime(item.capturedAt)}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>
                    <Button
                      variant="outlined"
                      size="small"
                      sx={{ ...BTN_SX, minWidth: 72 }}
                      disabled={isBusy}
                      onClick={() => {
                        void handleDeleteItem(item.id);
                      }}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={FOOTER_SX}>
        <Button
          variant="outlined"
          size="small"
          sx={BTN_SX}
          disabled={isBusy || albumItems.length === 0}
          onClick={() => void handleClearAlbum()}
        >
          Clear Album
        </Button>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {isBusy ? <CircularProgress size={12} /> : null}
          <Typography sx={STATUS_TEXT_SX}>
            {albumItemsLoading ? 'Loading album...' : `${albumItems.length} saved image(s).`}
          </Typography>
        </Box>
      </Box>

      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
    </Box>
  );
}

export default memo(AlbumTabImpl);
