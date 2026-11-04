import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const expected={
 'question-flow':'57b4b8af15e4a444586e684910b89db819cc5021c60a39ea93918dc721a94489',
 'option-list':'5f1c156aac4ad56aedac93665bef44f84a1253f357127dd92c55bf6926d230dc',
 'elicitation-form':'9d98ed74254ada76f5325f6d8cb333cf56bd3521763c3f6217c64e3ad8c2e621',
};
for(const [name,hash]of Object.entries(expected))test('fixed official '+name+' differs only by documented host adaptations',()=>{
 let source=readFileSync(new URL('../ui/vendor/assistant-ui/'+name+'.tsx',import.meta.url),'utf8')
  .replace('\n\nimport "./question-flow.css";','')
  .replace('import { cn } from "../task-status/utils";','import { cn } from "@/lib/utils";')
  .replace('import { useLayoutEffect as useIsomorphicLayoutEffect } from "react";','import { useIsomorphicLayoutEffect } from "../utils/useIsomorphicLayoutEffect";')
  .replace('import { clamp } from "./range";','import { clamp } from "../utils/range";');
 if(name==='question-flow')source=source.replace('completeLabel = "提交答复"','completeLabel = "Submit"').replace('>\n            上一题\n','>\n            Back\n').replace('第 {currentIndex + 1} / {steps.length} 题','{currentIndex + 1} of {steps.length}').replace('`第 ${currentIndex + 1} / ${steps.length} 题`','`Question ${currentIndex + 1} of ${steps.length}`').replace('finalStep ? completeLabel : "下一题"','finalStep ? completeLabel : "Next"');
 if(name==='option-list')source=source.replace('confirmLabel = "提交答复"','confirmLabel = "Confirm"').replace('未选择','Nothing selected').replace('已选择：','Selected:').replace('已选 {count} / {max}','{count} of {max}');
 if(name==='elicitation-form')source=source.replace('  submitDisabled = false,\n','').replace('  submitDisabled?: boolean;\n','').replace('disabled={submitDisabled || missingRequired}','disabled={missingRequired}').replace('<textarea\n','<input\n').replace('{enabled ? "开启" : "关闭"}','{enabled ? "On" : "Off"}').replace('需要补充','needs input').replace('{onDecline && <button','<button').replace('              拒绝\n            </button>}','              Decline\n            </button>').replace('              提交答复\n','              Send\n').replace('已接收本轮输入','Sent to {server}').replace('                已拒绝','                Declined');
 assert.equal(createHash('sha256').update(source).digest('hex'),hash);
});
