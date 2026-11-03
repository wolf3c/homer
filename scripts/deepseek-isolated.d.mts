import type {Config} from '../src/config.js';
import type {Readable,Writable} from 'node:stream';
export type IsolatedSession={directory:string;home:string;config:Omit<Config,'stopGraceMs'>;configPath:string};
export type LaunchSpec={bin:string;args:string[];cwd:string;env:NodeJS.ProcessEnv};
export function createSession():IsolatedSession;
export function launchSpec(session:IsolatedSession,token:string):LaunchSpec;
export function readToken(input?:Readable & {isTTY?:boolean},output?:Writable & {isTTY?:boolean}):Promise<string>;
export function runChild(spec:LaunchSpec):Promise<number>;
export function checkStartup(engine:{start():Promise<unknown>;close():Promise<boolean|void>}):Promise<boolean>;
