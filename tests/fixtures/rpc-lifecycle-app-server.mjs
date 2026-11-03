#!/usr/bin/env node
// No account, network or persistent data. Deliberately omit the initialize reply.
import { createInterface } from 'node:readline';
const eof=process.argv.includes('model="eof"'), exit=process.argv.includes('model="exit"');
createInterface({input:process.stdin}).on('line',line=>{
 const request=JSON.parse(line);
 if(request.method==='initialize') {
  if(exit)process.exit(0);
  if(eof)process.stdout.end();
 }
});
