import pathlib, json, subprocess, threading, queue, time, os, sys
R=pathlib.Path(__file__).parent/'strict'
R.mkdir(exist_ok=True)
HOME=R/'host'; CH=R/'codex'; TMP=R/'tmp'
for p in [HOME,CH,TMP]: p.mkdir(exist_ok=True)
helper=R/'server.py'
helper.write_text('''import sys,json,pathlib,threading,time,os
r=pathlib.Path(sys.argv[1]); tag=sys.argv[2]; last=None
def log(v):
 with (r/'mcp.jsonl').open('a') as f:f.write(json.dumps(dict(pid=os.getpid(),tag=tag,**v))+'\\n')
def send(v):print(json.dumps(v),flush=True)
def watch():
 global last
 while True:
  v=(r/'catalog').read_text()
  if last is not None and last!=v:
   send({'jsonrpc':'2.0','method':'notifications/tools/list_changed'});log({'event':'notify','version':v})
  last=v;time.sleep(.05)
threading.Thread(target=watch,daemon=True).start()
for line in sys.stdin:
 m=json.loads(line);method=m.get('method');log({'event':method})
 if 'id' not in m:continue
 v=(r/'catalog').read_text()
 schema={'type':'object','properties':{('text' if v=='1' else 'value'):{'type':'string'}},'required':[('text' if v=='1' else 'value')]}
 tools=[{'name':'echo','description':'synthetic version '+v,'inputSchema':schema}]
 if v=='1':tools.append({'name':'removed','inputSchema':{'type':'object'}})
 else:tools.append({'name':'added','inputSchema':{'type':'object'}})
 if method=='initialize':res={'protocolVersion':m['params']['protocolVersion'],'serverInfo':{'name':'synthetic','version':v},'capabilities':{'tools':{'listChanged':True}}}
 elif method=='tools/list':res={'tools':tools}
 elif method=='tools/call':res={'content':[{'type':'text','text':'synthetic-'+v}]}
 elif method=='resources/list':res={'resources':[]}
 elif method=='resources/templates/list':res={'resourceTemplates':[]}
 else:res={}
 send({'jsonrpc':'2.0','id':m['id'],'result':res})
''')
(R/'catalog').write_text('1')
BIN='/Applications/Homer.app/Contents/Resources/runtime/codex/vendor/aarch64-apple-darwin/bin/codex'
settings={'approval_policy':'never','web_search':'disabled','features.shell_tool':False,'features.plugins':False,'features.apps':False,'features.memories':False,'memories.generate_memories':False,'memories.use_memories':False,'features.skill_search':False,'features.skip_host_skill_discovery':True,'analytics.enabled':False,'feedback.enabled':False,'model_provider':'synthetic','model_providers.synthetic':{'name':'synthetic','base_url':'http://127.0.0.1:9/v1','wire_api':'responses','supports_websockets':False,'requires_openai_auth':False}}
def toml(x):
 if isinstance(x,dict):return '{'+','.join(json.dumps(k)+'='+toml(v) for k,v in x.items())+'}'
 return json.dumps(x)
def config(tags):
 (CH/'config.toml').write_text('\n'.join('[mcp_servers.'+name+']\ncommand="/usr/bin/python3"\nargs='+json.dumps([str(helper),str(R),tag])+'\nstartup_timeout_sec=8' for name,tag in tags.items()))
config({'probe':'A'})
class Client:
 def __init__(self):
  self.pending={};self.seq=0
  args=[BIN,'app-server','--stdio']
  for k,v in settings.items():args+=['-c',k+'='+toml(v)]
  self.err=(R/('stderr-'+str(time.time())+'.log')).open('w')
  self.p=subprocess.Popen(args,cwd=R,env={'HOME':str(HOME),'CODEX_HOME':str(CH),'TMPDIR':str(TMP),'PATH':'/usr/bin:/bin'},stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=self.err,text=True,bufsize=1)
  threading.Thread(target=self.read,daemon=True).start()
  self.req('initialize',{'clientInfo':{'name':'native-mcp-eval','version':'1'},'capabilities':{'experimentalApi':True}})
  self.p.stdin.write(json.dumps({'method':'initialized'})+'\n');self.p.stdin.flush()
 def read(self):
  for line in self.p.stdout:
   m=json.loads(line)
   if m.get('id') in self.pending and 'method' not in m:self.pending[m['id']].put(m)
 def req(self,method,params=None):
  assert method!='turn/start'
  self.seq+=1;i=self.seq;q=queue.Queue();self.pending[i]=q
  self.p.stdin.write(json.dumps({'id':i,'method':method,'params':params})+'\n');self.p.stdin.flush()
  m=q.get(timeout=20);del self.pending[i]
  if 'error' in m:raise RuntimeError(m)
  return m['result']
 def close(self):
  self.p.stdin.close()
  try:self.p.wait(timeout=8)
  except subprocess.TimeoutExpired:self.p.terminate();self.p.wait(timeout=5)
  self.err.close()
clients=[];results={}
def inv(c,t):return c.req('mcpServerStatus/list',{'threadId':t,'serverName':'probe','detail':'full','limit':100})
def snap(c,t,label):
 v=inv(c,t);results[label]={e['name']:{n:tool.get('inputSchema') for n,tool in e.get('tools',{}).items()} for e in v['data']};print(label,json.dumps(results[label]),flush=True)
try:
 c=Client();clients.append(c)
 t=c.req('thread/start',{'model':'gpt-6.1-sol','modelProvider':'synthetic','approvalPolicy':'never','sandbox':'read-only','environments':[]})['thread']['id']
 c.req('thread/memoryMode/set',{'threadId':t,'mode':'disabled'})
 c.req('thread/inject_items',{'threadId':t,'items':[{'type':'message','role':'user','content':[{'type':'input_text','text':'Synthetic marker. No model execution.'}]}]})
 snap(c,t,'initial')
 (R/'catalog').write_text('2');time.sleep(.5);snap(c,t,'after_notification')
 results['reload_ack']=c.req('config/mcpServer/reload');snap(c,t,'after_unchanged_reload')
 config({'probe':'B','extra':'C'});c.req('config/mcpServer/reload');snap(c,t,'after_changed_config')
 config({'probe':'B'});c.req('config/mcpServer/reload');snap(c,t,'after_remove_server')
 results['direct_call']=c.req('mcpServer/tool/call',{'threadId':t,'server':'probe','tool':'echo','arguments':{'value':'synthetic'}})
 c.close();clients.remove(c)
 c=Client();clients.append(c)
 resumed=c.req('thread/resume',{'threadId':t,'excludeTurns':True,'approvalPolicy':'never'})
 assert resumed['thread']['id']==t
 snap(c,t,'same_thread_cold_resume')
 results['same_thread']=True;results['model_calls']=0
 results['mcp_events']=[json.loads(s) for s in (R/'mcp.jsonl').read_text().splitlines()]
finally:
 for c in clients:c.close()
 (R/'evidence.json').write_text(json.dumps(results,indent=2)+'\n')
