// One explicit synthetic demonstration. No model, account, real thread or IM.
import {runDev} from './dev.mjs';
import {seamlessFixture} from './seamless-synthetic-fixture.mjs';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const fixture=seamlessFixture(true),webPort=Number(process.env.HOMER_SYNTHETIC_PORT??4791);
if(!Number.isInteger(webPort)||webPort<1024||webPort>65535||webPort===4780)throw Error('synthetic_port_invalid');
const receipt={synthetic:true,codexBin:'/usr/bin/false',pid:process.pid,url:`http://127.0.0.1:${webPort}`,base:fixture.base,realModel:false,channels:false};
writeFileSync(join(fixture.base,'demo-receipt.json'),JSON.stringify(receipt,null,2));
process.stdout.write(JSON.stringify(receipt)+'\n');
await runDev({...fixture,webPort,json:true});
