import type {historyFixture} from './web-history-loading-fixture.js';
import type {homerWebBridge} from '../src/web-homer.js';
import type {createWebServer} from '../src/web-server.js';
import type {WebHistoryPages} from '../src/web-history-pages.js';
import type {Files} from '../src/files.js';

type HistoryBridge=ReturnType<typeof homerWebBridge> & {history:NonNullable<ReturnType<typeof homerWebBridge>['history']>};
export function fixture(total:number,mode:'before'|'after',media?:boolean,stableRecent?:boolean):Promise<
  Omit<ReturnType<typeof historyFixture>,'close'> & {
    files:Files;reader:WebHistoryPages|undefined;bridge:HistoryBridge;
    server:Awaited<ReturnType<typeof createWebServer>>;
    fakeEngine:{invocations:number;turn():never};
    submitted:string[];stopped:string[];mediaRequests:string[];close():Promise<void>;
  }
>;
