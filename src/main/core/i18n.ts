import { tr } from '../../shared/i18n'
import { getSettings } from '../settings/settingsService'

/** A Russian UI text in the current interface language (for OS dialogs and notifications). */
export const L = (text: string): string => tr(getSettings().language, text)
