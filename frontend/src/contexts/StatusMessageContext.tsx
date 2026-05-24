import { createContext, useContext, useState, type ReactNode } from 'react';

// Split read/write contexts so the writer (App) does NOT re-render when the
// message changes. React guarantees `useState` setters are referentially stable,
// so the WriteContext value never changes and consumers of `useSetStatusMessage`
// never re-render due to status updates. Readers (StatusBar) subscribe to the
// ReadContext and re-render only when the message text actually changes.

const DEFAULT_MESSAGE = 'System Status: Ready';

const StatusMessageReadContext = createContext<string>(DEFAULT_MESSAGE);
const StatusMessageWriteContext = createContext<(next: string) => void>(() => {});

export function StatusMessageProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string>(DEFAULT_MESSAGE);
  return (
    <StatusMessageWriteContext.Provider value={setMessage}>
      <StatusMessageReadContext.Provider value={message}>
        {children}
      </StatusMessageReadContext.Provider>
    </StatusMessageWriteContext.Provider>
  );
}

export function useStatusMessage(): string {
  return useContext(StatusMessageReadContext);
}

export function useSetStatusMessage(): (next: string) => void {
  return useContext(StatusMessageWriteContext);
}
