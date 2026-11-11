import type {Homer} from '../../src/service.js';

export function readTestConversation(app: Homer) {
  const reader = app.webHistoryPages();
  const page = reader.read(app.store.meta('mainThread')!, {}, true);
  return {...page, queue: reader.queuePage().items};
}
