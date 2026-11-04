import type {ComponentType,ReactNode} from 'react';
import type {ProcessNode} from '../../src/main-process.js';

export const ProcessNodeView:ComponentType<{node:ProcessNode;renderText:(text:string)=>ReactNode}>;
