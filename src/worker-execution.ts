// Read-only, bounded presentation contracts. Never scheduling or a persistent log.
import type {NativeProcessEvent} from './main-process.js';
import type {ToolContent} from './tool-content.js';
export type CallScope={taskId:string;version:number;runId:string;epoch:number;threadId:string;turnId:string};
export type ExecutionSelector={taskId:string;runId:string};
export type WorkerCallSummary={callKey:string;seq:number;revision:number;scope:CallScope;source:'native'|'host';category:string;toolName?:string;status:NativeProcessEvent['status'];terminalObserved:boolean;firstObservedAtMs:number;lastObservedAtMs:number;startedAtMs?:number;endedAtMs?:number;durationMs?:number;timingSource:'native'|'hostObserved'|'unknown';inputSummary?:string;outputSummary?:string;errorSummary?:string;exitCode?:number;contentState:'available'|'evicted'|'not-recorded';conflict?:true};
export type WorkerExecutionPage={selector:ExecutionSelector;version:number;revision:number;observedAtMs:number;storeGeneration:string;availability:'available'|'unavailable';coverage:'partial';retention:'memory';active:WorkerCallSummary[];items:WorkerCallSummary[];before?:string;hasMore:boolean;omitted:boolean};
export type WorkerCallDetail={selector:ExecutionSelector;callKey:string;revision:number;summary:WorkerCallSummary;content?:ToolContent;contentState:WorkerCallSummary['contentState']};
