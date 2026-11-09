import type { Tool } from './engine.js';
export const MEDIA_TOOLS:Tool[]=[{type:'function',name:'runtime_capabilities',description:'读取当前运行版本与模型的实际媒体能力和限制。回答能否看图、听语音或发成果前应查询；不得把协议类型当成真实收发验收。',inputSchema:{type:'object',properties:{},additionalProperties:false}},{type:'function',name:'inspect_attachment',description:'读取获准消息中的指定附件状态及可追溯提取内容。只能用消息中提供的 assetId/revision，不能提交路径或URL。',inputSchema:{type:'object',properties:{assetId:{type:'string'},revision:{type:'integer',minimum:1}},required:['assetId','revision'],additionalProperties:false}}];
export const WORKER_MEDIA_TOOLS:Tool[]=[MEDIA_TOOLS[1]!];
export const WORKER_FILE_TOOLS:Tool[]=[
 {type:'function',name:'stage_file_result',description:'把获准的消息附件导出到当前执行目录，返回文件路径。',inputSchema:{type:'object',properties:{filename:{type:'string',minLength:1,maxLength:120},assetId:{type:'string',minLength:1,maxLength:100},revision:{type:'integer',minimum:1}},required:['filename','assetId','revision'],additionalProperties:false}},
];
