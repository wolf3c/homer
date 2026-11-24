import {useState} from 'react';
import {ChevronRight,ExternalLink} from 'lucide-react';

const aboutLinks=[
 {id:'website',label:'官网',url:'https://super-tree.com/homer'},
 {id:'github',label:'GitHub',url:'https://github.com/wolf3c/homer'},
 {id:'issue',label:'在 GitHub 提交 Issue',url:'https://github.com/wolf3c/homer/issues/new?template=bug_report.yml'},
] as const;

export type AboutLink=(typeof aboutLinks)[number]['id'];
export type StartFeedback=(closeSettings:()=>void)=>string|void;

export function SettingsAbout({openLink,startFeedback,closeSettings}:{
 openLink?:(link:AboutLink)=>Promise<void>;
 startFeedback?:StartFeedback;
 closeSettings:()=>void;
}){
 const [notice,setNotice]=useState('');
 function link({id,label,url}:(typeof aboutLinks)[number]){
  const content=<>{label}<span className="settings-about-external">{id==='issue'&&<small>公开反馈</small>}<ExternalLink size={16} aria-hidden/></span></>;
  return openLink
   ? <button type="button" key={id} onClick={()=>{
      setNotice('');
      void openLink(id).catch(()=>setNotice('未能打开链接，请重试。'));
     }}>{content}</button>
   : <a key={id} href={url} target="_blank" rel="noopener noreferrer">{content}</a>;
 }
 return <div className="settings-about">
  <div className="settings-about-links">{aboutLinks.slice(0,2).map(link)}</div>
  <section className="settings-feedback" aria-label="问题反馈">
   <h3>问题反馈</h3>
   <ul role="list">
    <li><button type="button" disabled={!startFeedback} onClick={()=>{
     const error=startFeedback?.(closeSettings);
     if(error)setNotice(error);
    }}>通过 Homer 反馈<ChevronRight size={16} aria-hidden/></button></li>
    <li>{link(aboutLinks[2])}</li>
   </ul>
   {notice&&<p role="status">{notice}</p>}
  </section>
 </div>;
}
