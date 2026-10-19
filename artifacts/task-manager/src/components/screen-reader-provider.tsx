import { useEffect, useState, type ReactNode } from 'react';
import { ScreenReaderAssistant } from '@/components/screen-reader-assistant';
import { ScreenReaderContext } from '@/components/screen-reader-context';

const DEFAULT_STORAGE_KEY = 'so-cong:screen-reader-enabled';

function readPreference(storageKey: string): boolean {
  try {
    return window.localStorage.getItem(storageKey) === 'true';
  } catch {
    return false;
  }
}

export function ScreenReaderAssistantProvider({ children, userId }: {
  children: ReactNode;
  userId?: string;
}) {
  const storageKey = userId ? `${DEFAULT_STORAGE_KEY}:${userId}` : DEFAULT_STORAGE_KEY;
  const [enabled, setEnabled] = useState(() => readPreference(storageKey));

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(enabled));
    } catch {
      // Keep the setting active for this session when browser storage is unavailable.
    }
  }, [enabled, storageKey]);

  useEffect(() => {
    if (!enabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, [enabled]);

  return (
    <ScreenReaderContext.Provider value={{ enabled, setEnabled }}>
      {children}
      <ScreenReaderAssistant />
    </ScreenReaderContext.Provider>
  );
}
