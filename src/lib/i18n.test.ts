import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@iobroker/adapter-core", () => ({
  I18n: {
    getTranslatedObject: vi.fn((key: string) => ({ en: key, de: `${key}_de` })),
  },
}));

import { tName } from "./i18n";

describe("tName", () => {
  it("delegates to I18n.getTranslatedObject", () => {
    const result = tName("channelInfo");
    expect(result).toEqual({ en: "channelInfo", de: "channelInfo_de" });
  });
});

describe("i18n completeness", () => {
  const i18nDir = join(__dirname, "../../admin/i18n");
  const files = readdirSync(i18nDir).filter(f => f.endsWith(".json"));
  const keysets = files.map(f => ({
    lang: f.replace(".json", ""),
    keys: Object.keys(JSON.parse(readFileSync(join(i18nDir, f), "utf8"))),
  }));
  const enKeys = keysets.find(k => k.lang === "en")!.keys;
  const enKeysSorted = [...enKeys].sort();

  it("all 11 languages present", () => {
    expect(files).toHaveLength(11);
  });

  it("all languages have identical keysets", () => {
    for (const { lang, keys } of keysets) {
      expect([...keys].sort(), `${lang} keyset mismatch`).toEqual(enKeysSorted);
    }
  });

  it("no empty values", () => {
    for (const { lang } of keysets) {
      const data = JSON.parse(readFileSync(join(i18nDir, `${lang}.json`), "utf8"));
      for (const [key, val] of Object.entries(data)) {
        expect(val, `${lang}.${key} is empty`).not.toBe("");
      }
    }
  });
});
