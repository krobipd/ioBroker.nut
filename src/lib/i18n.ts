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
