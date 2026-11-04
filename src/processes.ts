import { execFileSync } from "node:child_process";
import {
  openSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import {windowsCommand} from '../scripts/windows-security.mjs';
export function processIdentity(pid: number): string | undefined {
  if(!Number.isSafeInteger(pid)||pid<1)return undefined;
  try {
    if(process.platform==='win32'){
      const value=JSON.parse(windowsCommand("$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:HOMER_PROCESS_ID); if($p -and $p.ExecutablePath){@($p.ProcessId,$p.CreationDate.ToUniversalTime().Ticks.ToString(),$p.ExecutablePath)|ConvertTo-Json -Compress}else{'null'}",{HOMER_PROCESS_ID:String(pid)}));
      return Array.isArray(value)&&value.length===3&&value[0]===pid&&/^\d+$/.test(value[1])&&typeof value[2]==='string'&&value[2]?JSON.stringify(value):undefined;
    }
    const s = execFileSync(
      "/bin/ps",
      ["-p", String(pid), "-o", "lstart=,pgid=,comm="],
      { encoding: "utf8", timeout: 3000, env: { ...process.env, LC_ALL: "C", LANG: "C" } },
    ).trim();
    return s || undefined;
  } catch {
    return undefined;
  }
}
export function acquireLock(runtime: string) {
  const path = join(runtime, "cli.lock");
  const identity = processIdentity(process.pid);
  if (!identity) throw new Error("process_identity_unavailable");
  try {
    const old = JSON.parse(readFileSync(path, "utf8"));
    if (processIdentity(old.pid) === old.identity)
      throw new Error("runtime_already_open");
    // Locale changes (and PID reuse) must never make a live lock look stale.
    // Only the absence of the owner permits removing its old lock.
    if (processAlive(old.pid)) throw new Error("runtime_lock_identity_unverified");
    unlinkSync(path);
  } catch (e) {
    if (e instanceof Error && ["runtime_already_open", "runtime_lock_identity_unverified"].includes(e.message)) throw e;
    if (
      (e as NodeJS.ErrnoException).code !== "ENOENT" &&
      (e as SyntaxError).name === "SyntaxError"
    )
      throw new Error("runtime_lock_invalid");
  }
  const fd = openSync(path, "wx", 0o600);
  writeFileSync(fd, JSON.stringify({ pid: process.pid, identity }));
  closeSync(fd);
  return () => {
    try {
      const old = JSON.parse(readFileSync(path, "utf8"));
      if (old.pid === process.pid && old.identity === identity)
        unlinkSync(path);
    } catch {}
  };
}
function processAlive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
export async function terminateLease(lease: { pid: number; identity: string }, drain?:()=>Promise<void>) {
  if(process.platform==='win32'){
    // Keep the existing owner; EOF alone cannot prove its descendants stopped.
    const snapshot=()=>{
      const rows=JSON.parse(windowsCommand("@(Get-CimInstance Win32_Process|Select-Object ProcessId,ParentProcessId,@{Name='Started';Expression={if($_.CreationDate){$_.CreationDate.ToUniversalTime().Ticks.ToString()}}})|ConvertTo-Json -Compress")) as {ProcessId:number;ParentProcessId:number;Started?:string}[];
      if(!Array.isArray(rows)||rows.some(row=>!Number.isSafeInteger(row.ProcessId)||row.ProcessId<0||!Number.isSafeInteger(row.ParentProcessId)||row.ParentProcessId<0||row.ProcessId!==0&&!/^\d+$/.test(row.Started??'')))throw Error('process_tree_unconfirmed');
      const result=new Map(rows.map(row=>[row.ProcessId,row]));if(result.size!==rows.length)throw Error('process_tree_unconfirmed');return result;
    };
    let ids:Set<number>|undefined,before:ReturnType<typeof snapshot>|undefined;
    try{
      if(processIdentity(lease.pid)===lease.identity){
        before=snapshot();if(!before.has(lease.pid))return false;
        ids=new Set([lease.pid]);let changed=true;
        while(changed){changed=false;for(const row of before.values())if(ids.has(row.ParentProcessId)&&!ids.has(row.ProcessId)){ids.add(row.ProcessId);changed=true;}}
        if(processIdentity(lease.pid)!==lease.identity)ids=undefined;
      }
      await drain?.();
      if(!ids||!before)return false;
      if(processAlive(lease.pid)){
        if(processIdentity(lease.pid)!==lease.identity)return false;
        execFileSync(join(process.env.SystemRoot!,'System32/taskkill.exe'),['/PID',String(lease.pid),'/T','/F'],{stdio:'ignore',windowsHide:true,timeout:3000});
      }
      const after=snapshot(),outside=new Set<number>();
      // An unchanged orphan can still belong to the owner; anchors must predate it.
      for(const [pid,row]of after)if(pid!==0&&!ids.has(pid)&&before.get(pid)?.Started===row.Started&&BigInt(row.Started!)<BigInt(before.get(lease.pid)!.Started!))outside.add(pid);
      let changed=true;
      while(changed){changed=false;for(const [pid,row]of after)if(!ids.has(pid)&&!outside.has(pid)&&outside.has(row.ParentProcessId)&&BigInt(row.Started!)>=BigInt(after.get(row.ParentProcessId)!.Started!)){outside.add(pid);changed=true;}}
      return [...ids].every(pid=>!processAlive(pid))&&[...after.keys()].every(pid=>pid===0||outside.has(pid));
    }catch{return false;}
  }
  if (processIdentity(lease.pid) !== lease.identity) return !processAlive(lease.pid);
  try {
    process.kill(-lease.pid, "SIGTERM");
  } catch {}
  const until = Date.now() + 1500;
  while (processIdentity(lease.pid) === lease.identity && Date.now() < until)
    await new Promise((r) => setTimeout(r, 30));
  if (processIdentity(lease.pid) === lease.identity) {
    try {
      process.kill(-lease.pid, "SIGKILL");
    } catch {}
  }
  return processIdentity(lease.pid) !== lease.identity;
}
export type Resources = {
  at: number;
  processCount: number;
  rssMiB: number;
  cpuPercent: number;
};
export function sampleProcessTree(rootPid = process.pid): Resources {
  const rows = process.platform==='win32'?(JSON.parse(windowsCommand("@(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process|Select-Object IDProcess,CreatingProcessID,WorkingSet,PercentProcessorTime)|ConvertTo-Json -Compress")) as {IDProcess:number;CreatingProcessID:number;WorkingSet:number;PercentProcessorTime:number}[]).map(p=>[p.IDProcess,p.CreatingProcessID,Number(p.WorkingSet)/1024,Number(p.PercentProcessorTime)]):execFileSync("/bin/ps", ["-axo", "pid=,ppid=,rss=,%cpu="], {
    encoding: "utf8",
    timeout: 3000,
  })
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number));
  const ids = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, ppid] of rows)
      if (
        pid !== undefined &&
        ppid !== undefined &&
        ids.has(ppid) &&
        !ids.has(pid)
      ) {
        ids.add(pid);
        changed = true;
      }
  }
  const own = rows.filter((r) => r[0] !== undefined && ids.has(r[0]));
  return {
    at: Date.now(),
    processCount: own.length,
    rssMiB:
      Math.round((own.reduce((a, r) => a + (r[2] ?? 0), 0) / 1024) * 10) / 10,
    cpuPercent: Math.round(own.reduce((a, r) => a + (r[3] ?? 0), 0) * 10) / 10,
  };
}
