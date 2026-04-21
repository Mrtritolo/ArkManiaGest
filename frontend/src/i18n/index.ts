/**
 * i18n bootstrap — react-i18next configuration.
 *
 * Two locales are bundled inline: English and Italian.  The active
 * language is persisted in `localStorage` under the `arkmania.lang`
 * key (so refreshing the page keeps the user's choice) and falls back
 * to the browser language at first load.  English is the ultimate
 * fallback when the requested key is missing.
 *
 * Usage in a component:
 *
 *     import { useTranslation } from 'react-i18next'
 *     const { t } = useTranslation()
 *     return <h1>{t('nav.dashboard')}</h1>
 *
 * Adding a new key: edit BOTH `locales/en.json` AND `locales/it.json`
 * — never one without the other.  CONTRIBUTING.md repeats the rule.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en from './locales/en.json'
import it from './locales/it.json'

export const SUPPORTED_LANGUAGES = ['en', 'it'] as const
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number]

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  it: 'Italiano',
}

const STORAGE_KEY = 'arkmania.lang'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      it: { translation: it },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES as readonly string[] as string[],
    nonExplicitSupportedLngs: true,
    interpolation: {
      // React already escapes by default — disable i18next's escaping
      // to avoid double-encoding.
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: STORAGE_KEY,
    },
  })

/** Switch the active language and persist the choice. */
export function setLanguage(lang: SupportedLanguage): void {
  i18n.changeLanguage(lang)
  try {
    window.localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    /* localStorage may be blocked (private mode) — silently ignore. */
  }
}

/** Returns the active two-letter language code. */
export function getCurrentLanguage(): SupportedLanguage {
  const code = (i18n.resolvedLanguage ?? i18n.language ?? 'en')
    .split('-')[0]
    .toLowerCase()
  return (SUPPORTED_LANGUAGES.includes(code as SupportedLanguage)
    ? code
    : 'en') as SupportedLanguage
}

export default i18n
