import {setTimeout as delay} from 'node:timers/promises';

// Compilation has its own production deadlines. Readiness belongs to the
// existing test lifecycle, rather than a shorter competing polling deadline.
// A rejected candidate or dead owner must fail now, not wait out that lifecycle.
export async function waitForDevCondition(check,{signal,events,exited,from=0}){
 for(;;){
  signal.throwIfAborted();
  if(exited())throw Error('dev_fixture_owner_exited');
  const rejection=events.slice(from).find(row=>row.type==='progress'&&/^(?:界面)?候选未生效：/.test(row.text));
  if(rejection)throw Error('dev_fixture_build_rejected:'+(rejection.text.match(/\bdev_[a-z_]+\b/)?.[0]??'unknown'));
  if(await check())return;
  await delay(20,undefined,{signal});
 }
}
