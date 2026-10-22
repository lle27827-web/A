import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { useLocation, useSearch } from 'wouter';
import { AppGestureContext } from '@/components/app-gesture-context';
import {
  attachAppTouchGestures,
  isSafeAppSaveLabel,
  previousAppLocation,
  type AppTouchGesture,
} from '@/components/app-gestures';

const APP_GESTURES_KEY = 'so-cong:save-back-gestures';

function isVisible(element: HTMLElement): boolean {
  return element.isConnected && element.getClientRects().length > 0;
}

function readEnabled(storageKey: string): boolean {
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

function safeSaveTarget(): { form: HTMLFormElement; button: HTMLButtonElement } | null {
  const forms = Array.from(document.querySelectorAll<HTMLFormElement>('form')).filter(isVisible);
  const activeForm = document.activeElement instanceof HTMLElement
    ? document.activeElement.closest('form')
    : null;
  const orderedForms = activeForm && forms.includes(activeForm)
    ? [activeForm, ...forms.filter((form) => form !== activeForm)]
    : forms.reverse();

  for (const form of orderedForms) {
    if (form.getAttribute('role') === 'search') continue;
    const button = Array.from(form.querySelectorAll<HTMLButtonElement>('button[type="submit"]'))
      .find((candidate) => {
        if (candidate.disabled || !isVisible(candidate)) return false;
        const label = candidate.innerText || candidate.getAttribute('aria-label') || '';
        return isSafeAppSaveLabel(label);
      });
    if (button) return { form, button };
  }
  return null;
}

function performBack(
  history: MutableRefObject<string[]>,
  currentLocation: string,
  navigate: (to: string, options?: { replace?: boolean }) => void,
) {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
    .filter(isVisible);
  const activeDialog = dialogs.at(-1);
  const closeButton = activeDialog?.querySelector<HTMLButtonElement>('button[aria-label*="đóng" i]');
  if (closeButton) {
    closeButton.click();
    return;
  }

  const result = previousAppLocation(history.current, currentLocation);
  history.current = result.history;
  if (result.target) navigate(result.target, { replace: true });
}

function performGesture(
  gesture: AppTouchGesture,
  history: MutableRefObject<string[]>,
  currentLocation: string,
  navigate: (to: string, options?: { replace?: boolean }) => void,
) {
  if (gesture === 'back') {
    performBack(history, currentLocation, navigate);
    return;
  }
  const target = safeSaveTarget();
  if (target) target.form.requestSubmit(target.button);
}

export function AppGestureProvider({ children, userId }: {
  children: ReactNode;
  userId?: string;
}) {
  const storageKey = userId ? `${APP_GESTURES_KEY}:${userId}` : APP_GESTURES_KEY;
  const [enabled, setEnabled] = useState(() => readEnabled(storageKey));
  const [location, navigate] = useLocation();
  const search = useSearch();
  const currentLocation = search ? `${location}?${search}` : location;
  const routeHistory = useRef<string[]>([currentLocation]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(enabled));
    } catch {
      // Keep the toggle in memory when browser storage is unavailable.
    }
  }, [enabled, storageKey]);

  useEffect(() => {
    const previousIndex = routeHistory.current.lastIndexOf(currentLocation);
    routeHistory.current = previousIndex >= 0
      ? routeHistory.current.slice(0, previousIndex + 1)
      : [...routeHistory.current, currentLocation];
  }, [currentLocation]);

  useEffect(() => {
    if (!enabled) return;
    return attachAppTouchGestures({
      onGesture: (gesture) => performGesture(gesture, routeHistory, currentLocation, navigate),
    });
  }, [enabled, currentLocation, navigate]);

  return (
    <AppGestureContext.Provider value={{ enabled, setEnabled }}>
      {children}
    </AppGestureContext.Provider>
  );
}
