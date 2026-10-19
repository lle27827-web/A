import { createContext } from 'react';

export type ScreenReaderContextValue = {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
};

export const ScreenReaderContext = createContext<ScreenReaderContextValue | null>(null);
