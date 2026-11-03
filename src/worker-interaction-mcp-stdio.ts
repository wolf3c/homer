import { runWorkerInteractionMcp } from "./worker-interaction-mcp.js";

const socketPath = process.argv[2];
if (!socketPath) process.exitCode = 1;
else runWorkerInteractionMcp(socketPath,process.argv[3]??'main');
