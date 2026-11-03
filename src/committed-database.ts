import { DatabaseSync, type StatementSync } from 'node:sqlite';

// The connection owner observes successful writes from all existing repositories.
// This is only an invalidation signal, never a copy of business/queue state.
// Transactions/savepoints publish after the outer commit, and discard rollback.
export class CommittedDatabase extends DatabaseSync {
  private observers = new Set<(tables:ReadonlySet<string>) => void>();
  private frames: {name:string;tables:Set<string>}[] = [];
  private scheduled = false;
  private pendingTables=new Set<string>();
  onChange(observer:(tables:ReadonlySet<string>)=>void) { this.observers.add(observer);return ()=>{this.observers.delete(observer);}; }
  private changed(tables:ReadonlySet<string>) {
    const target=this.frames.at(-1)?.tables??this.pendingTables;
    for(const table of tables)target.add(table);
    if(this.frames.length||this.scheduled||!this.observers.size)return;
    this.scheduled=true;
    queueMicrotask(()=>{
      this.scheduled=false;const committed=this.pendingTables;this.pendingTables=new Set();
      for(const observer of this.observers)try{observer(committed);}catch{/* Observers cannot break committed work. */}
    });
  }
  private table(sql:string){return sql.match(/^\s*(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+(\w+)/i)?.[1]?.toLowerCase()??'unknown';}
  override prepare(sql:string):StatementSync {
    const statement=super.prepare(sql);
    if (!/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)) return statement;
    // Events are private diagnostics, absent from WebState. They must not make
    // idle pages rebuild merely because a diagnostic was recorded.
    if(/^\s*INSERT\s+INTO\s+events\b/i.test(sql))return statement;
    const run=statement.run.bind(statement);
    statement.run=((...args:Parameters<StatementSync['run']>)=>{const result=run(...args);if(result.changes)this.changed(new Set([this.table(sql)]));return result;}) as StatementSync['run'];
    return statement;
  }
  override exec(sql:string):void {
    super.exec(sql);
    // Callers use explicit transaction controls; schema batches run at startup.
    // Savepoints also appear inside history acceptance (Telegram intake).
    for(const command of sql.split(';').map(part=>part.trim()).filter(Boolean)){
      if(/^BEGIN\b/i.test(command))this.frames.push({name:'',tables:new Set()});
      else if(/^SAVEPOINT\s+/i.test(command))this.frames.push({name:command.replace(/^SAVEPOINT\s+/i,'').toLowerCase(),tables:new Set()});
      else if(/^ROLLBACK\s+TO\s+/i.test(command)){
        const name=command.replace(/^ROLLBACK\s+TO\s+(SAVEPOINT\s+)?/i,'').toLowerCase();
        const index=this.frames.findLastIndex(frame=>frame.name===name);
        if(index>=0){this.frames.splice(index+1);this.frames[index]!.tables.clear();}
      }else if(/^ROLLBACK\b/i.test(command))this.frames=[];
      else if(/^RELEASE\s+/i.test(command)){
        const name=command.replace(/^RELEASE\s+(SAVEPOINT\s+)?/i,'').toLowerCase();
        const index=this.frames.findLastIndex(frame=>frame.name===name);
        if(index>=0){const tables=new Set(this.frames.splice(index).flatMap(frame=>[...frame.tables]));if(tables.size)this.changed(tables);}
      }else if(/^(COMMIT|END)\b/i.test(command)){
        const tables=new Set(this.frames.flatMap(frame=>[...frame.tables]));this.frames=[];if(tables.size)this.changed(tables);
      }else if(/^(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(command))this.changed(new Set([this.table(command)]));
    }
  }
}
