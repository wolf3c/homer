// Synthetic HTTP tests use their own loopback server, without pairing.
export {createWebServer} from '../src/web-server.js';
export const fetch:typeof globalThis.fetch=(...args)=>globalThis.fetch(...args);
