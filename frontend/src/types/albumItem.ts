export type AlbumItemPayload = {
  title: string;
  previewLabel: string;
  hardnessImage: boolean;
  capturedAt: string;
};

export type AlbumItem = AlbumItemPayload & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
