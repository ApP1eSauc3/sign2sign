import { create } from 'zustand';
import { AppMode } from '../data/SignJob';

interface AppStore {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  mode: AppMode.Undecided,
  setMode: (mode) => set({ mode }),
}));
