import { runWorkerInteractionMcp } from "./worker-interaction-mcp.js";

const socketPath = process.argv[2];
if (!socketPath) process.exitCode = 1;
else {
  const plugins=process.argv.slice(4).find(arg=>arg.startsWith('plugin-tools='));
  runWorkerInteractionMcp(socketPath,process.argv[3]??'main',process.argv[4]==='membership-web',process.argv[5]==='native-web-search',
    plugins?JSON.parse(plugins.slice('plugin-tools='.length)):[]);
}
