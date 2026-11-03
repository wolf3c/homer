// Synthetic transport writer, killed by the parent after its durable receipt.
import {IngressJournal} from '../../scripts/dev-ingress.mjs';
const journal=new IngressJournal(process.argv[2],'synthetic-binding');
journal.store({requestId:'crash-first',text:'Synthetic one'});
journal.store({requestId:'crash-second',text:'Synthetic two'});
process.send({stored:true});
process.on('message',()=>{});
