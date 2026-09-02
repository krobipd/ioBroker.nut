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

  // Keyset-equality alone does NOT catch a key that is referenced but absent (user sees the
  // raw key) or a key present in every language but used nowhere (dead weight). This gate
  // closes both — it would have caught the orphaned upsName/upsDescription keys.
  it("every en.json key is used, and every referenced key exists", () => {
    const root = join(__dirname, "..", "..");
    const readRoot = (p: string): string => readFileSync(join(root, p), "utf8");

    // Keys referenced at RUNTIME — TypeScript source (tName, flag/channel/command maps,
    // TRANSLATED_VARIABLES) + admin/jsonConfig labels/help/text.
    const referenced = new Set<string>();
    const add = (re: RegExp, text: string): void => {
      for (const m of text.matchAll(re)) {
        referenced.add(m[1]);
      }
    };
    const srcDir = join(__dirname, "..");
    for (const rel of readdirSync(srcDir, { recursive: true })) {
      if (typeof rel !== "string" || !rel.endsWith(".ts") || rel.endsWith(".test.ts")) {
        continue;
      }
      const text = readFileSync(join(srcDir, rel), "utf8");
      add(/tName\("([^"]+)"\)/g, text);
      add(/i18nKey:\s*"([^"]+)"/g, text);
      add(/"(channel[A-Za-z]+|cmd[A-Za-z]+)"/g, text);
      const block = text.match(/TRANSLATED_VARIABLES = new Set[\s\S]*?\] as I18nKey\[\]/);
      if (block) {
        add(/"([^"]+)"/g, block[0]);
      }
    }
    // `placeholder` counts too: the repository checker resolves it through the translation
    // files like every other user-visible attribute (W5612), so a placeholder is a key.
    add(/"(?:label|help|tooltip|text|okText|errorText|placeholder)":\s*"([^"]+)"/g, readRoot("admin/jsonConfig.json"));

    const en = JSON.parse(readRoot("admin/i18n/en.json")) as Record<string, string>;

    // Build-time keys: io-package.json instanceObjects names are generated from i18n keys by
    // sync-iopackage-from-i18n.py, so a key whose English text equals an instanceObjects name
    // is used at build time (e.g. connectionStatus → info.connection) — not dead.
    const ioPkg = JSON.parse(readRoot("io-package.json")) as {
      instanceObjects: { common: { name?: string | Record<string, string> } }[];
    };
    const buildTimeNames = new Set(
      ioPkg.instanceObjects
        .map(o => o.common?.name)
        .map(n => (typeof n === "object" && n ? n.en : n))
        .filter((n): n is string => typeof n === "string"),
    );

    const missing = [...referenced].filter(k => !(k in en)).sort();
    expect(missing, `referenced in code/jsonConfig but missing from en.json: ${missing.join(", ")}`).toEqual([]);

    const dead = Object.keys(en)
      .filter(k => !referenced.has(k) && !buildTimeNames.has(en[k]))
      .sort();
    expect(dead, `present in en.json but never used (dead i18n keys): ${dead.join(", ")}`).toEqual([]);
  });
});
