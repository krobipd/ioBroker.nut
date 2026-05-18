"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var i18n_states_exports = {};
__export(i18n_states_exports, {
  CHANNEL_I18N: () => CHANNEL_I18N,
  STATE_NAMES: () => STATE_NAMES,
  tName: () => tName
});
module.exports = __toCommonJS(i18n_states_exports);
const STATE_NAMES = {
  // ──────── instanceObjects ────────
  channelInfo: {
    en: "Adapter information",
    de: "Adapter-Informationen",
    ru: "\u0418\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F \u043E\u0431 \u0430\u0434\u0430\u043F\u0442\u0435\u0440\u0435",
    pt: "Informa\xE7\xF5es do adaptador",
    nl: "Adapterinformatie",
    fr: "Informations sur l'adaptateur",
    it: "Informazioni sull'adattatore",
    es: "Informaci\xF3n del adaptador",
    pl: "Informacje o adapterze",
    uk: "\u0406\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0456\u044F \u043F\u0440\u043E \u0430\u0434\u0430\u043F\u0442\u0435\u0440",
    "zh-cn": "\u9002\u914D\u5668\u4FE1\u606F"
  },
  connectionStatus: {
    en: "Connection status",
    de: "Verbindungsstatus",
    ru: "\u0421\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u044F",
    pt: "Estado da conex\xE3o",
    nl: "Verbindingsstatus",
    fr: "\xC9tat de la connexion",
    it: "Stato della connessione",
    es: "Estado de conexi\xF3n",
    pl: "Stan po\u0142\u0105czenia",
    uk: "\u0421\u0442\u0430\u043D \u0437'\u0454\u0434\u043D\u0430\u043D\u043D\u044F",
    "zh-cn": "\u8FDE\u63A5\u72B6\u6001"
  },
  // ──────── NUT domain channels ────────
  channelBattery: {
    en: "Battery",
    de: "Batterie",
    ru: "\u0411\u0430\u0442\u0430\u0440\u0435\u044F",
    pt: "Bateria",
    nl: "Batterij",
    fr: "Batterie",
    it: "Batteria",
    es: "Bater\xEDa",
    pl: "Bateria",
    uk: "\u0411\u0430\u0442\u0430\u0440\u0435\u044F",
    "zh-cn": "\u7535\u6C60"
  },
  channelDevice: {
    en: "Device",
    de: "Ger\xE4t",
    ru: "\u0423\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u043E",
    pt: "Dispositivo",
    nl: "Apparaat",
    fr: "Appareil",
    it: "Dispositivo",
    es: "Dispositivo",
    pl: "Urz\u0105dzenie",
    uk: "\u041F\u0440\u0438\u0441\u0442\u0440\u0456\u0439",
    "zh-cn": "\u8BBE\u5907"
  },
  channelDriver: {
    en: "Driver",
    de: "Treiber",
    ru: "\u0414\u0440\u0430\u0439\u0432\u0435\u0440",
    pt: "Driver",
    nl: "Driver",
    fr: "Pilote",
    it: "Driver",
    es: "Controlador",
    pl: "Sterownik",
    uk: "\u0414\u0440\u0430\u0439\u0432\u0435\u0440",
    "zh-cn": "\u9A71\u52A8\u7A0B\u5E8F"
  },
  channelInput: {
    en: "Input power",
    de: "Eingangsleistung",
    ru: "\u0412\u0445\u043E\u0434\u043D\u0430\u044F \u043C\u043E\u0449\u043D\u043E\u0441\u0442\u044C",
    pt: "Pot\xEAncia de entrada",
    nl: "Ingangsvermogen",
    fr: "Puissance d'entr\xE9e",
    it: "Potenza in ingresso",
    es: "Potencia de entrada",
    pl: "Moc wej\u015Bciowa",
    uk: "\u0412\u0445\u0456\u0434\u043D\u0430 \u043F\u043E\u0442\u0443\u0436\u043D\u0456\u0441\u0442\u044C",
    "zh-cn": "\u8F93\u5165\u529F\u7387"
  },
  channelOutput: {
    en: "Output power",
    de: "Ausgangsleistung",
    ru: "\u0412\u044B\u0445\u043E\u0434\u043D\u0430\u044F \u043C\u043E\u0449\u043D\u043E\u0441\u0442\u044C",
    pt: "Pot\xEAncia de sa\xEDda",
    nl: "Uitgangsvermogen",
    fr: "Puissance de sortie",
    it: "Potenza in uscita",
    es: "Potencia de salida",
    pl: "Moc wyj\u015Bciowa",
    uk: "\u0412\u0438\u0445\u0456\u0434\u043D\u0430 \u043F\u043E\u0442\u0443\u0436\u043D\u0456\u0441\u0442\u044C",
    "zh-cn": "\u8F93\u51FA\u529F\u7387"
  },
  channelUps: {
    en: "UPS",
    de: "USV",
    ru: "\u0418\u0411\u041F",
    pt: "UPS",
    nl: "UPS",
    fr: "Onduleur",
    it: "UPS",
    es: "SAI",
    pl: "UPS",
    uk: "\u0414\u0411\u0416",
    "zh-cn": "UPS"
  },
  channelOutlet: {
    en: "Outlets",
    de: "Ausg\xE4nge",
    ru: "\u0420\u043E\u0437\u0435\u0442\u043A\u0438",
    pt: "Tomadas",
    nl: "Uitgangen",
    fr: "Prises",
    it: "Prese",
    es: "Tomas",
    pl: "Gniazdka",
    uk: "\u0420\u043E\u0437\u0435\u0442\u043A\u0438",
    "zh-cn": "\u63D2\u5EA7"
  },
  channelAmbient: {
    en: "Ambient sensors",
    de: "Umgebungssensoren",
    ru: "\u0414\u0430\u0442\u0447\u0438\u043A\u0438 \u043E\u043A\u0440\u0443\u0436\u0430\u044E\u0449\u0435\u0439 \u0441\u0440\u0435\u0434\u044B",
    pt: "Sensores ambientais",
    nl: "Omgevingssensoren",
    fr: "Capteurs ambiants",
    it: "Sensori ambientali",
    es: "Sensores ambientales",
    pl: "Czujniki otoczenia",
    uk: "\u0414\u0430\u0442\u0447\u0438\u043A\u0438 \u043D\u0430\u0432\u043A\u043E\u043B\u0438\u0448\u043D\u044C\u043E\u0433\u043E \u0441\u0435\u0440\u0435\u0434\u043E\u0432\u0438\u0449\u0430",
    "zh-cn": "\u73AF\u5883\u4F20\u611F\u5668"
  },
  channelStatus: {
    en: "Status flags",
    de: "Status-Flags",
    ru: "\u0424\u043B\u0430\u0433\u0438 \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u044F",
    pt: "Flags de estado",
    nl: "Statusvlaggen",
    fr: "Indicateurs d'\xE9tat",
    it: "Flag di stato",
    es: "Indicadores de estado",
    pl: "Flagi stanu",
    uk: "\u041F\u0440\u0430\u043F\u043E\u0440\u0446\u0456 \u0441\u0442\u0430\u043D\u0443",
    "zh-cn": "\u72B6\u6001\u6807\u5FD7"
  },
  channelCommands: {
    en: "Commands",
    de: "Befehle",
    ru: "\u041A\u043E\u043C\u0430\u043D\u0434\u044B",
    pt: "Comandos",
    nl: "Commando's",
    fr: "Commandes",
    it: "Comandi",
    es: "Comandos",
    pl: "Polecenia",
    uk: "\u041A\u043E\u043C\u0430\u043D\u0434\u0438",
    "zh-cn": "\u547D\u4EE4"
  },
  // ──────── Status states ────────
  statusRaw: {
    en: "Raw status",
    de: "Rohstatus",
    ru: "\u041D\u0435\u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043D\u044B\u0439 \u0441\u0442\u0430\u0442\u0443\u0441",
    pt: "Estado bruto",
    nl: "Ruwe status",
    fr: "\xC9tat brut",
    it: "Stato grezzo",
    es: "Estado sin procesar",
    pl: "Stan surowy",
    uk: "\u041D\u0435\u043E\u0431\u0440\u043E\u0431\u043B\u0435\u043D\u0438\u0439 \u0441\u0442\u0430\u043D",
    "zh-cn": "\u539F\u59CB\u72B6\u6001"
  },
  statusSeverity: {
    en: "Severity level",
    de: "Schweregrad",
    ru: "\u0423\u0440\u043E\u0432\u0435\u043D\u044C \u0441\u0435\u0440\u044C\u0451\u0437\u043D\u043E\u0441\u0442\u0438",
    pt: "N\xEDvel de gravidade",
    nl: "Ernst",
    fr: "Niveau de gravit\xE9",
    it: "Livello di gravit\xE0",
    es: "Nivel de gravedad",
    pl: "Poziom wa\u017Cno\u015Bci",
    uk: "\u0420\u0456\u0432\u0435\u043D\u044C \u0441\u0435\u0440\u0439\u043E\u0437\u043D\u043E\u0441\u0442\u0456",
    "zh-cn": "\u4E25\u91CD\u7A0B\u5EA6"
  },
  upsName: {
    en: "UPS name",
    de: "USV-Name",
    ru: "\u0418\u043C\u044F \u0418\u0411\u041F",
    pt: "Nome do UPS",
    nl: "UPS-naam",
    fr: "Nom de l'onduleur",
    it: "Nome UPS",
    es: "Nombre del SAI",
    pl: "Nazwa UPS",
    uk: "\u0406\u043C'\u044F \u0414\u0411\u0416",
    "zh-cn": "UPS\u540D\u79F0"
  },
  upsDescription: {
    en: "UPS description",
    de: "USV-Beschreibung",
    ru: "\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u0418\u0411\u041F",
    pt: "Descri\xE7\xE3o do UPS",
    nl: "UPS-beschrijving",
    fr: "Description de l'onduleur",
    it: "Descrizione UPS",
    es: "Descripci\xF3n del SAI",
    pl: "Opis UPS",
    uk: "\u041E\u043F\u0438\u0441 \u0414\u0411\u0416",
    "zh-cn": "UPS\u63CF\u8FF0"
  }
};
const CHANNEL_I18N = {
  battery: "channelBattery",
  device: "channelDevice",
  driver: "channelDriver",
  input: "channelInput",
  output: "channelOutput",
  ups: "channelUps",
  outlet: "channelOutlet",
  ambient: "channelAmbient",
  status: "channelStatus",
  commands: "channelCommands"
};
function tName(key) {
  var _a;
  return (_a = STATE_NAMES[key]) != null ? _a : key;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CHANNEL_I18N,
  STATE_NAMES,
  tName
});
//# sourceMappingURL=i18n-states.js.map
