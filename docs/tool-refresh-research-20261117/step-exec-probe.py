import pathlib
source=(pathlib.Path(__file__).parent/'probe.py').read_text().split('clients=[];results={}')[0]
source=source.replace("R=pathlib.Path(__file__).parent","R=pathlib.Path(__file__).parent/'step-exec'\nR.mkdir(exist_ok=True)")
source=source.replace("assert method!='turn/start'","assert method!='forbidden'")
source=source.replace("m=json.loads(line)\n   if", "m=json.loads(line)\n   if m.get('method')=='item/tool/call':\n    self.p.stdin.write(json.dumps({'id':m['id'],'result':{'contentItems':[{'type':'inputText','text':'synthetic gate complete'}],'success':True}})+'\\n');self.p.stdin.flush()\n   if")
exec(source)
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
requests=[]; errors=[];finished=threading.Event()
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_POST(self):
  data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  requests.append(data);seq=len(requests)
  if seq==1:
   try:
    (R/'catalog').write_text('2');config({'probe':'B'})
    c.req('config/mcpServer/reload')
   except Exception as e:errors.append(str(e))
   item={'id':'fc1','type':'custom_tool_call','namespace':'functions','name':'exec','call_id':'gate1','input':"text(ALL_TOOLS.filter(x=>x.name.includes('mcp__probe')));"}
  elif seq==2:item={'id':'fc2','type':'custom_tool_call','namespace':'functions','name':'exec','call_id':'gate2','input':"text(ALL_TOOLS.filter(x=>x.name.includes('mcp__probe')));text(await tools.mcp__probe__echo({value:'synthetic'}));"}
  else:item={'id':'msg'+str(seq),'type':'message','role':'assistant','content':[{'type':'output_text','text':'Synthetic completed.','annotations':[]}]}
  response={'id':'response'+str(seq),'object':'response','model':'gpt-6.1-sol','status':'completed','output':[item],'usage':{'input_tokens':1,'output_tokens':1,'total_tokens':2}}
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
  events=[{'type':'response.created','response':dict(response,status='in_progress',output=[])},{'type':'response.output_item.added','output_index':0,'item':dict(item,content=[])},{'type':'response.output_item.done','output_index':0,'item':item},{'type':'response.completed','response':response}]
  for e in events:self.wfile.write(('event: '+e['type']+'\ndata: '+json.dumps(e)+'\n\n').encode())
  self.wfile.flush()
  if seq>=3:finished.set()
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
settings['model_providers.synthetic']['base_url']='http://127.0.0.1:'+str(server.server_port)+'/v1'
settings['features.code_mode']=False
c=None
try:
 c=Client()
 t=c.req('thread/start',{'model':'gpt-6.1-sol','modelProvider':'synthetic','approvalPolicy':'never','sandbox':'read-only','environments':[],'dynamicTools':[{'name':'gate','description':'synthetic gate','inputSchema':{'type':'object'}}]})['thread']['id']
 c.req('thread/memoryMode/set',{'threadId':t,'mode':'disabled'})
 # Initialize only the actual thread connection before first model request.
 c.req('mcpServerStatus/list',{'threadId':t,'serverName':'probe','detail':'full','limit':100})
 start=c.req('turn/start',{'threadId':t,'input':[{'type':'text','text':'Synthetic protocol probe only.'}]})
 if not finished.wait(20):errors.append('second request timeout')
 time.sleep(.2)
finally:
 if c:c.close()
 server.shutdown();server.server_close()
 (R/'requests.json').write_text(json.dumps(requests,indent=2))
 evidence={'requests':len(requests),'errors':errors,'same_thread':True,'real_model':False,'turn_start_count':1,'request_tools':[r.get('tools') for r in requests],'input_tool_catalogs':[[x for x in r.get('input',[]) if x.get('type')=='additional_tools'] for r in requests]}
 (R/'evidence.json').write_text(json.dumps(evidence,indent=2));print(json.dumps(evidence))
