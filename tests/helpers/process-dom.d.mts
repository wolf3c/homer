import type {ReactNode} from 'react';

export interface TestNode {
  attrs: Record<string, string>;
  tagName?: string;
  childNodes: TestNode[];
  textContent: string;
  hidden: boolean;
  contains(node: TestNode): boolean;
}
export interface TestDom {
  container: TestNode;
  doc: TestNode & {createElement(name:string):TestNode;defaultView:{getSelection?:()=>null}};
  all(): TestNode[];
  find(predicate:(node:TestNode)=>boolean):TestNode|undefined;
  render(value:ReactNode):Promise<void>;
  remount():Promise<void>;
  click(button:TestNode|undefined):Promise<void>;
}
export function withDom(run:(dom:TestDom)=>Promise<void>):Promise<void>;
export function descendants(node:TestNode):TestNode[];
export function visibleText(node:TestNode):string;
export {default as React} from 'react';
