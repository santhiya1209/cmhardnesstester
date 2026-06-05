import { createContext, useContext, useState, type ReactNode } from 'react';


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
