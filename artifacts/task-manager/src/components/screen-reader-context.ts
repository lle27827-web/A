import { createContext } from 'react';

export type ScreenReaderContextValue = {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  speechRate: number;
  setSpeechRate: (rate: number) => void;
  speechVolume: number;
  setSpeechVolume: (volume: number) => void;
  voiceURI: string;
  setVoiceURI: (voiceURI: string) => void;
  autoReadFocus: boolean;
  setAutoReadFocus: (enabled: boolean) => void;
  focusSwipesEnabled: boolean;
  setFocusSwipesEnabled: (enabled: boolean) => void;
  shortcutSwipesEnabled: boolean;
  setShortcutSwipesEnabled: (enabled: boolean) => void;
};

export const ScreenReaderContext = createContext<ScreenReaderContextValue | null>(null);
