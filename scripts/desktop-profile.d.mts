export function saveDesktopModelSource(root:string,source:'codex'|'website',chatgpt?:import('../src/model-config.js').ChatGPTModelOverrides):void;
export function readDesktopPowerConfig(root:string):unknown;
export function saveDesktopPowerConfig(root:string,value:{instanceId:string;preferences:import('../src/desktop-power.js').PowerPreferences;authorizationAsked?:boolean}):void;
