#!/usr/bin/env node
import { createInterface } from "node:readline";
import { loadConfig } from "./config.js";
import { effectiveEffort, effectiveFast } from "./model-config.js";
import { Homer, type Message } from "./service.js";
import { codexVersion, engineError } from "./engine.js";
import {dingtalkChannel} from './dingtalk-channel.js';
import {telegramChannel} from './telegram-channel.js';
import {authorizeWechat,bindWechat,unbindWechat,wechatChannel,wechatStatus} from './wechat-channel.js';
import {acquireLock} from './processes.js';
process.stdout.on("error", () => {});
const args = process.argv.slice(2);
function value(flag: string) {
  const at = args.indexOf(flag);
  if (at < 0) return undefined;
  const v = args[at + 1];
  if (!v || v.startsWith("--")) throw new Error("missing_" + flag.slice(2));
  return v;
}
async function write(message: string) {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(message + "\n", (e) => (e ? reject(e) : resolve()));
  });
}
async function manageWechat(runtime:string){
  if(args[1]==='status')return write(JSON.stringify(wechatStatus(runtime)));
  if(args[1]!=='bind'&&args[1]!=='unbind')throw Error('wechat_command_invalid');
  const unlock=acquireLock(runtime);
  try{
    if(args[1]==='unbind'){
      if(!args[2]||args[2].startsWith('--'))throw Error('wechat_account_required');
      unbindWechat(runtime,args[2]);
      return await write('已解绑。下次启动 Homer 时生效。');
    }
    if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('wechat_terminal_required');
    const {default:QRCode}=await import('qrcode');
    const {createInterface}=await import('node:readline/promises');
    const terminal=createInterface({input:process.stdin,output:process.stdout});
    const abort=new AbortController();
    const stop=()=>abort.abort();
    terminal.on('SIGINT',stop);
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    try{
      const credential=await authorizeWechat({
        showQr:async url=>{await write('请使用要绑定的微信扫码确认。');await write(await QRCode.toString(url,{type:'terminal',small:true}));},
        verifyCode:signal=>terminal.question('请输入手机上显示的验证码：',{signal})
      },fetch,abort.signal);
      abort.signal.throwIfAborted();
      await write('已绑定 '+bindWechat(runtime,credential)+'。启动 Homer 后，在该微信的 ClawBot 私聊发一条消息。');
    }finally{
      terminal.close();process.off('SIGINT',stop);process.off('SIGTERM',stop);
    }
  }finally{unlock();}
}
async function main() {
  if (args.includes("--help")) {
    await write(
      'Homer M0\n用法：npm start -- [--config 路径] [--json] [--message "自然语言"] [--request-id ID]\n微信：homer wechat bind|status|unbind <标识> [--config 路径]\n不传 --message 时逐行输入；/status 查看事实，/quit 停止任务并退出。\nJSON 模式每行输出一个完整事件。标准输入 EOF 会等当前工作交付后退出，Ctrl-C 请求安全停止。',
    );
    return;
  }
  const config = loadConfig(value("--config"));
  if(args[0]==='wechat')return manageWechat(config.runtime);
  const json = args.includes("--json");
  const sink = async (message: Message) => (message.type === "main_start" || message.type === "main_terminal" || message.type === 'tool_progress' || (message.type === "delta" && !json)) ? undefined :
    write(
      json
        ? JSON.stringify(message)
        : `${message.type === "reply" ? "荷马" : "状态"}：${message.text}`,
    );
  const telegram=telegramChannel(config.runtime);
  const wechat=wechatChannel(config.runtime);
  const dingtalk=dingtalkChannel(config.runtime);
  const adapters=[...(telegram?[telegram]:[]),...(wechat?[wechat]:[]),...(dingtalk?[dingtalk]:[])];
  const app = new Homer(config, sink, undefined, adapters);
  let stopping = false;
  const stop = () => {
    if (!stopping) {
      stopping = true;
      void app
        .close()
        .then(() => {
          process.exitCode = 0;
          process.stdin.destroy();
        })
        .catch(() => {
          process.exitCode = 1;
          process.stdin.destroy();
        });
    }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    for(const adapter of adapters)adapter.applyBindings(app.channels!);
    const restoring = !!app.store.meta("mainThread");
    await app.start();
    await sink({
      type: "progress",
      text: `Homer 已启动（${codexVersion(config.codexBin)}，${config.model}，${effectiveEffort(config.effort)}，Fast 请求${effectiveFast(config.fast) ? "开启" : "关闭"}）。${restoring ? "已恢复原主对话" : "已建立首次主对话"}；支持多个独立 Worker；退出时停止执行，重启不会自动重放。`,
    });
    const message = value("--message");
    if (message) {
      await app.message(message, value("--request-id"));
      if (await app.idle({ returnOnUserWait: true }) === "waiting_user") await sink({ type: "progress", text: "单消息输入已结束，未答问题和原 Worker 将停止；如需当场补答，请使用持续逐行输入的交互模式。" });
    } else {
      const rl = createInterface({ input: process.stdin, terminal: false });
      const work: Promise<unknown>[] = [];
      for await (const line of rl) {
        if (stopping) break;
        const text = line.trim();
        if (!text) continue;
        if (text === "/quit") {
          rl.close();
          stop();
          break;
        }
        if (text === "/status") {
          await sink({
            type: "progress",
            text: JSON.stringify(app.snapshot()),
          });
          continue;
        }
        // Enqueue input without waiting for a Worker; the main thread serializes only its own turns.
        work.push(
          app
            .message(text)
            .catch(async (e) => sink({ type: "error", text: engineError(e) })),
        );
      }
      await Promise.all(work);
      if (!stopping && await app.idle({ returnOnUserWait: true }) === "waiting_user") await sink({ type: "progress", text: "输入已结束，未答问题和原 Worker 将停止；待答不能跨进程恢复，请在交互模式中当场补答。" });
    }
  } finally {
    if (!stopping) await app.close();
  }
}
main().catch(async (e) => {
  process.exitCode = 1;
  try {
    const code = engineError(e);
    const text = code.startsWith("prompt_file_")
      ? "默认提示词加载失败，请检查安装目录的 prompts 文件；修复后重新启动：" + code
      : code === "main_tools_migration_required"
      ? "主对话已保留；工具定义发生变化，需完成会话兼容迁移后再启动。未创建新对话：" + code
      : code === "main_resume_thread_mismatch"
        ? "主对话恢复结果不匹配，已停止启动并保留原会话记录：" + code
        : code === "engine_thread_history_unavailable"
          ? "原主对话的引擎历史不可恢复，已保留线程指针，未创建新对话：" + code
        : code;
    await write(JSON.stringify({ type: "error", text }));
  } catch {}
});
