import { useEffect, useState, type ReactNode } from 'react';
import { ScreenReaderAssistant } from '@/components/screen-reader-assistant';
import { ScreenReaderContext } from '@/components/screen-reader-context';
import { normalizeSpeechRate, normalizeSpeechVolume } from '@/components/screen-reader-gestures';

const DEFAULT_STORAGE_KEY = 'so-cong:screen-reader-enabled';
const DEFAULT_SETTINGS = {
  speechRate: 1,
  speechVolume: 0.8,
  voiceURI: '',
  autoReadFocus: true,
  focusSwipesEnabled: true,
  shortcutSwipesEnabled: true,
};

type ReaderPreferences = typeof DEFAULT_SETTINGS;
type ReaderState = ReaderPreferences & {
  enabled: boolean;
  storageKey: string;
};

function readState(storageKey: string): ReaderState {
  let enabled = false;
  let preferences: ReaderPreferences = DEFAULT_SETTINGS;
  try {
    enabled = window.localStorage.getItem(storageKey) === 'true';
  } catch {
    // Keep the default disabled if browser storage is unavailable.
  }
  try {
    const raw = window.localStorage.getItem(`${storageKey}:settings`);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const value = parsed as Record<string, unknown>;
        preferences = {
          speechRate: normalizeSpeechRate(value.speechRate),
          speechVolume: normalizeSpeechVolume(value.speechVolume),
          voiceURI: typeof value.voiceURI === 'string' ? value.voiceURI : '',
          autoReadFocus: typeof value.autoReadFocus === 'boolean'
            ? value.autoReadFocus
            : DEFAULT_SETTINGS.autoReadFocus,
          focusSwipesEnabled:
            typeof value.focusSwipesEnabled === 'boolean'
              ? value.focusSwipesEnabled
              : typeof value.headingSwipesEnabled === 'boolean'
                ? value.headingSwipesEnabled
                : DEFAULT_SETTINGS.focusSwipesEnabled,
          shortcutSwipesEnabled:
            typeof value.shortcutSwipesEnabled === 'boolean'
              ? value.shortcutSwipesEnabled
              : DEFAULT_SETTINGS.shortcutSwipesEnabled,
        };
      }
    }
  } catch {
    // Malformed preferences should not prevent the reader from loading.
  }
  return { storageKey, enabled, ...preferences };
}

export function ScreenReaderAssistantProvider({ children, userId }: {
  children: ReactNode;
  userId?: string;
}) {
  const storageKey = userId ? `${DEFAULT_STORAGE_KEY}:${userId}` : DEFAULT_STORAGE_KEY;
  const [state, setState] = useState(() => readState(storageKey));
  const current = state.storageKey === storageKey ? state : readState(storageKey);

  useEffect(() => {
    if (state.storageKey !== storageKey) {
      setState(readState(storageKey));
    }
  }, [state.storageKey, storageKey]);

  useEffect(() => {
    if (state.storageKey !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, String(state.enabled));
      window.localStorage.setItem(
        `${storageKey}:settings`,
        JSON.stringify({
          speechRate: state.speechRate,
          speechVolume: state.speechVolume,
          voiceURI: state.voiceURI,
          autoReadFocus: state.autoReadFocus,
          focusSwipesEnabled: state.focusSwipesEnabled,
          shortcutSwipesEnabled: state.shortcutSwipesEnabled,
        }),
      );
    } catch {
      // Keep the setting active for this session when browser storage is unavailable.
    }
  }, [state, storageKey]);

  useEffect(() => {
    if (!current.enabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, [current.enabled]);

  function updateState(update: Partial<Omit<ReaderState, 'storageKey'>>) {
    setState((previous) => ({
      ...(previous.storageKey === storageKey ? previous : readState(storageKey)),
      ...update,
      storageKey,
    }));
  }

  return (
    <ScreenReaderContext.Provider value={{
      enabled: current.enabled,
      setEnabled: (enabled) => updateState({ enabled }),
      speechRate: current.speechRate,
      setSpeechRate: (speechRate) => updateState({ speechRate: normalizeSpeechRate(speechRate) }),
      speechVolume: current.speechVolume,
      setSpeechVolume: (speechVolume) => updateState({ speechVolume: normalizeSpeechVolume(speechVolume) }),
      voiceURI: current.voiceURI,
      setVoiceURI: (voiceURI) => updateState({ voiceURI }),
      autoReadFocus: current.autoReadFocus,
      setAutoReadFocus: (autoReadFocus) => updateState({ autoReadFocus }),
      focusSwipesEnabled: current.focusSwipesEnabled,
      setFocusSwipesEnabled: (focusSwipesEnabled) => updateState({ focusSwipesEnabled }),
      shortcutSwipesEnabled: current.shortcutSwipesEnabled,
      setShortcutSwipesEnabled: (shortcutSwipesEnabled) => updateState({ shortcutSwipesEnabled }),
    }}>
      {children}
      <ScreenReaderAssistant />
    </ScreenReaderContext.Provider>
  );
}
