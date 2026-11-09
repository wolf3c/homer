import type {Tool} from './engine.js';
const nullable={type:['string','null']};
export const EXECUTION_TOOLS:Tool[]=[
 {type:'function',name:'work_directory',description:'Select an existing project directory for the NEXT native turn, or select a task contract directory. Each runner keeps its own directory; children default to the current parent directory. Remaining shell calls in this turn must pass cwd explicitly. Local AGENTS/Skills are discovered by Codex when the next turn starts. Null path reads current selection.',inputSchema:{type:'object',properties:{path:nullable,taskId:nullable},required:['path','taskId'],additionalProperties:false}},
];
