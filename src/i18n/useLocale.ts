// src/i18n/useLocale.ts
// Hook for accessing locale strings throughout the app

import { locales, Locale, Strings } from './locales'
import { useAppStore } from '../stores/appStore'

export function useLocale(): { t: Strings; locale: Locale } {
  const locale = useAppStore((s) => s.locale)
  return { t: locales[locale] as Strings, locale }
}
