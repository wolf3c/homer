import { runWorkerInteractionMcp } from "./worker-interaction-mcp.js";

const socketPath = process.argv[2];
if (!socketPath) process.exitCode = 1;
else {
  const flags=process.argv.slice(4),plugins=flags.find(arg=>arg.startsWith('plugin-tools='));
  runWorkerInteractionMcp(socketPath,process.argv[3]??'main',flags.includes('membership-web'),flags.includes('native-web-search'),
    plugins?JSON.parse(plugins.slice('plugin-tools='.length)):[],flags.includes('desktop-cua'));
}
