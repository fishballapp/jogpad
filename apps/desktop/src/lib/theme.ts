import { useEffect } from 'react';
import type { Theme } from '@/lib/api';

const media = window.matchMedia('(prefers-color-scheme: dark)');

/// Both windows run this against their own snapshot, since each has its own
/// document. index.html starts with the dark class so the first paint matches
/// the default before any snapshot arrives.
export function useTheme(theme: Theme | undefined) {
  useEffect(() => {
    if (!theme) return;
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    };
    apply();
    if (theme !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}
