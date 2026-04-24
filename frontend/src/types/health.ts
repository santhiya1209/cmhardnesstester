export type Health = {
  ok: boolean;
  env?: string;
  db?: {
    location?: string;
    filename?: string;
  };
};
