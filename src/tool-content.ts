// Legacy wire types only; new tool bodies are not retained.
type JsonValue=null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};
export type ToolValue={state:'recorded'|'truncated';value:JsonValue;redacted?:true}|{state:'not-recorded'|'pending'|'hidden';reason?:'non-json'|'binary';redacted?:never};
export type ToolContent={input:ToolValue;output:ToolValue};
