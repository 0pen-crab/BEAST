import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en.json';
import uk from '@/locales/uk.json';

const LANG_KEY = 'beast_language';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    uk: { translation: uk },
  },
  lng: localStorage.getItem(LANG_KEY) || 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: string) {
  i18n.changeLanguage(lang);
  localStorage.setItem(LANG_KEY, lang);
}

export function getLanguage(): string {
  return i18n.language || 'en';
}

export default i18n;
