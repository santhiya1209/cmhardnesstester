import { useCallback, useState } from 'react';
import type { ToolId } from '@/types/tool';

export function useActiveTool(initial: ToolId = 'pointer') {
  const [activeTool, setActiveToolState] = useState<ToolId>(initial);

  const setActiveTool = useCallback((next: ToolId) => {
    setActiveToolState((prev) => (prev === next ? prev : next));
  }, []);

  return { activeTool, setActiveTool };
}
