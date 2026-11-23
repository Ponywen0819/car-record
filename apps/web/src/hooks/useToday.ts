import { useEffect, useState } from 'react';
import { todayISO } from '../domain';

/** Today's local date; refreshes when the app returns to the foreground or the day changes. */
export function useToday(): string {
  const [today, setToday] = useState(() => todayISO());
  useEffect(() => {
    const update = () => setToday(todayISO());
    document.addEventListener('visibilitychange', update);
    const timer = setInterval(update, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', update);
      clearInterval(timer);
    };
  }, []);
  return today;
}
