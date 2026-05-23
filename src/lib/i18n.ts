import { I18n } from "@iobroker/adapter-core";
import type translations from "../../admin/i18n/en.json";

export type I18nKey = keyof typeof translations;

/** @param key I18n key */
export function tName(key: I18nKey): ioBroker.StringOrTranslated {
  return I18n.getTranslatedObject(key);
}
