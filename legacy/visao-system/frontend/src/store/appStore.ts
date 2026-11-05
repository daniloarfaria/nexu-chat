import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  darkMode: boolean;
  toggleDarkMode: () => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      darkMode: false,
      toggleDarkMode: () => set((s) => {
        const next = !s.darkMode;
        if (next) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
        return { darkMode: next };
      }),
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    {
      name: 'visao-app-state',
      onRehydrateStorage: () => (state) => {
        if (state?.darkMode) {
          document.documentElement.classList.add('dark');
        }
      },
    }
  )
);
