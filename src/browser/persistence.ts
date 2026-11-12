import { defaultStore, parseStore, serializeStore, type ProfileStore } from '../core/profiles';

export const PROFILE_KEY = 'md2word.profiles.v1';
export const SELECTED_KEY = 'md2word.selected.v1';
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function loadPreferences(storage: StorageLike): { store: ProfileStore; selected: string; error?: string } {
  try {
    const raw = storage.getItem(PROFILE_KEY), store = raw ? parseStore(raw) : defaultStore();
    const last = storage.getItem(SELECTED_KEY);
    return { store, selected: store.profiles.some(p => p.id === last) ? last! : 'default' };
  } catch {
    return { store: defaultStore(), selected: 'default', error: '未能读取已保存配置，当前临时使用出厂格式。可导入 JSON 恢复。' };
  }
}
export function savePreferences(storage: StorageLike, store: ProfileStore, selected: string): { saved: boolean } {
  try {
    const text = serializeStore(store);
    storage.setItem(PROFILE_KEY, text);
    storage.setItem(SELECTED_KEY, selected);
    return { saved: storage.getItem(PROFILE_KEY) === text && storage.getItem(SELECTED_KEY) === selected };
  } catch { return { saved: false }; }
}
