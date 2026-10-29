import { useEffect, useState } from 'react';
import { vietnamToday } from '@/lib/revenue-period';

export function useVietnamToday(): string {
  const [today, setToday] = useState(vietnamToday);
  useEffect(() => {
    const refresh = () => setToday(vietnamToday());
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);
  return today;
}
