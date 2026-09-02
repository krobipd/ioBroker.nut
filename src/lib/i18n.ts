import { I18n } from "@iobroker/adapter-core";
import type translations from "../../admin/i18n/en.json";

export type I18nKey = keyof typeof translations;

/**
 * Resolve an admin/i18n key to a translation object for `common.name` / state labels.
 *
 * @param key Admin i18n key
 */
export function tName(key: I18nKey): ioBroker.StringOrTranslated {
  return I18n.getTranslatedObject(key);
}

/**
 * Resolve an admin/i18n key to a translation object for `common.desc` — the short explanation
 * a user reads next to the name. Same mechanism as {@link tName}; separate function so the
 * intent is visible at the call site (and the state-role gate can tell them apart).
 *
 * @param key Admin i18n key
 */
export function tDesc(key: I18nKey): ioBroker.StringOrTranslated {
  return I18n.getTranslatedObject(key);
}

/**
 * Resolve an admin/i18n key to a plain string in the SYSTEM language.
 *
 * `common.states` maps and any text the adapter writes as a state VALUE (the readable status
 * line) can only be a plain string — ioBroker has no translation object there. So those follow
 * `system.config.language` at write time, which is exactly what the fleet rule asks for.
 *
 * @param key Admin i18n key
 */
export function tText(key: I18nKey): string {
  return I18n.translate(key);
}

/**
 * Like {@link tText}, for a text with `%s` placeholders (the connection-test answers).
 *
 * @param key Admin i18n key
 * @param args Values that replace the placeholders, in order
 */
export function tTextArgs(key: I18nKey, ...args: (string | number)[]): string {
  return I18n.translate(key, ...args);
}

/**
 * The eleven languages every ioBroker manifest and admin translation carries.
 * Kept next to `tRaw` because that is the only place the list is needed.
 */
const LANGUAGES = ["en", "de", "ru", "pt", "nl", "fr", "it", "es", "pl", "uk", "zh-cn"] as const;

/**
 * Wrap a text that comes from the NUT server (an unknown channel segment, an instant command the
 * adapter has no label for) as a translation object.
 *
 * There is nothing to translate — the server speaks one language — but `common.name` must be a
 * translation object for every object type (core-team line, issue #15), never a bare string. So
 * the same text is offered under every language key; the object browser then shows it in any
 * system language instead of falling back on an untranslated name.
 *
 * @param text The server-provided text
 */
export function tRaw(text: string): ioBroker.StringOrTranslated {
  return Object.fromEntries(LANGUAGES.map(lang => [lang, text])) as ioBroker.StringOrTranslated;
}
