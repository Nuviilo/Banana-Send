import { useEffect } from 'react';
import type { ThemeMode } from '../types';

export function useTheme(theme: ThemeMode): void {
  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const shouldUseDark =
        theme === 'dark' || (theme === 'system' && mediaQuery.matches);
      if (shouldUseDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    };

    applyTheme();

    if (theme === 'system') {
      mediaQuery.addEventListener('change', applyTheme);
      return () => mediaQuery.removeEventListener('change', applyTheme);
    }
  }, [theme]);
}
