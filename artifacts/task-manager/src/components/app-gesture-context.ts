import { createContext } from 'react';

export type AppGestureContextValue = {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
};

export const AppGestureContext = createContext<AppGestureContextValue | null>(null);
