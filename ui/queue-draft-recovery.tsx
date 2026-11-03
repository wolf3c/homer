import type {DispatchQueuePage} from '../src/web-contract';
import type {AnnotatedQuote,ConversationInput} from '../src/web-history';
import type {ResourceReference} from '../src/preview-reference';

// Persisted pre-removal contract. Never rewrite/delete these records or replay
// their mutations; QueueOperations alone reconciles the original operation ID.
export type LegacyQueueEditSession={item:DispatchQueuePage['items'][number];text:string;quotes:AnnotatedQuote[];resourceReference?:ResourceReference;resourceReferences?:ResourceReference[];attachments:NonNullable<ConversationInput['attachments']>;original:{text:string;quotes:AnnotatedQuote[];resourceReference?:ResourceReference;resourceReferences?:ResourceReference[]};operationId?:string};
