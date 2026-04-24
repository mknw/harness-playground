/**
 * Client-side settings store with localStorage persistence.
 *
 * Reactive SolidJS store — import only from client-side code.
 */
import { createSignal } from 'solid-js'
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, type HarnessSettings } from './settings'

function loadSettings(): HarnessSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!stored) return { ...DEFAULT_SETTINGS }
    // Merge with defaults so new keys added in future don't break existing users
    return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

const [settings, setSettingsInternal] = createSignal<HarnessSettings>(loadSettings())

function persist(s: HarnessSettings) {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(s))
}

export function getSettings(): HarnessSettings {
  return settings()
}

export function updateSetting<K extends keyof HarnessSettings>(key: K, value: HarnessSettings[K]) {
  const updated = { ...settings(), [key]: value }
  setSettingsInternal(updated)
  persist(updated)
}

export function resetSettings() {
  setSettingsInternal({ ...DEFAULT_SETTINGS })
  persist({ ...DEFAULT_SETTINGS })
}
