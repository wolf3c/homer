import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localNetworkAccess} from './local-network.mjs';

test('Android 17 asks for local network access; existing grants need no prompt',async()=>{
 const calls=[];
 const permissions={PERMISSIONS:{ACCESS_LOCAL_NETWORK:'android.permission.ACCESS_LOCAL_NETWORK'},RESULTS:{GRANTED:'granted'},check:async()=>false,request:async permission=>{calls.push(permission);return 'granted';}};
 assert.equal(await localNetworkAccess({OS:'android',Version:37},permissions),true);
 assert.deepEqual(calls,['android.permission.ACCESS_LOCAL_NETWORK']);
 permissions.check=async()=>true;calls.length=0;
 assert.equal(await localNetworkAccess({OS:'android',Version:37},permissions),true);assert.deepEqual(calls,[]);
 permissions.check=async()=>false;permissions.request=async()=> 'denied';
 assert.equal(await localNetworkAccess({OS:'android',Version:37},permissions),false);
});
test('iOS and earlier Android do not request Android 17 permission',async()=>{
 for(const platform of [{OS:'ios',Version:'27'},{OS:'android',Version:36}])assert.equal(await localNetworkAccess(platform,{}),true);
});
