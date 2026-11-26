import {useNotionPreferences,notionShouldSubmit} from './NotionPreferences';
import * as React from 'react';
import { ArrowUp, Plus, Mic, SlidersHorizontal, X, Bot, MessageCircle, FileSearch, CalendarDays, ChevronsRight, MessageCirclePlus, Copy, ThumbsUp, ThumbsDown } from './ui/icons';
import { Textarea } from './ui/textarea';
import { NotionButton, NotionIconGlyph } from './NotionPrimitives';
import {useNotionSaveGuard,useNotionNavigationGuard} from './NotionNavigationGuard';

export type NotionChatMessage = { id: string; role: 'user' | 'assistant'; text: string };
export type NotionChatModel = { id?: string; recentChats?:{id:string;title:string}[]; draft?: string; title?: string; placeholder?: string; showModelLabel?: boolean; settingsIconUrl?: string; connectedAppsArtworkUrl?: string; greeting: string; description?: string; avatarUrl?: string; initialDraft?: string; attachments?: {id: string; previewUrl: string; name: string}[]; author?: {name: string; avatarUrl?: string}; context?: { title: string; icon?: string }; messages?: NotionChatMessage[]; suggestions?: { id: string; label: string; prompt: string }[]; thoughtLabel?: string; quickReplies?: string[]; pending?: boolean; error?: string };
export type NotionChatActions = { onDraftChange?: (draft:string)=>void; onSaveDraft?:(draft:string)=>Promise<boolean>; onOpenChat?:(id:string)=>void; onSend?: (text: string) => Promise<boolean>; onAttach?: () => void; onSettings?: () => void; onVoice?: () => void; onNewChat?: () => void; onClose?: () => void; onRemoveAttachment?: (id: string) => void; onMessageAction?: (id: string, action: 'copy' | 'like' | 'dislike') => void };

export function NotionChat({ model, actions = {}, sidePanel = false }: { model: NotionChatModel; actions?: NotionChatActions; sidePanel?: boolean }) {
  const preferences=useNotionPreferences();
  const guard=useNotionNavigationGuard();
  const [localDraft,setLocalDraft]=React.useState(model.initialDraft??'');
  const draft=model.draft??localDraft;
  const [acceptedDraft,setAcceptedDraft]=React.useState(draft);
  const latestDraft=React.useRef(draft),latestActions=React.useRef(actions);latestDraft.current=draft;latestActions.current=actions;
  function setDraft(value:string){latestDraft.current=value;setLocalDraft(value);actions.onDraftChange?.(value);}
  React.useEffect(()=>{setLocalDraft(model.initialDraft??'');setAcceptedDraft(model.draft??model.initialDraft??'');},[model.id]);
  const [sending, setSending] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [draftSaveFailed,setDraftSaveFailed]=React.useState(false);
  const [appsVisible, setAppsVisible] = React.useState(true);
  const submitting=React.useRef(false);
  React.useEffect(()=>{setFailed(false);setDraftSaveFailed(false);setSending(false);},[model.id]);
  const input = React.useRef<HTMLTextAreaElement>(null);
  const identity=React.useRef(model.id);identity.current=model.id;
  const pendingSend=React.useRef<Promise<boolean>|null>(null);
  useNotionSaveGuard(`chat:${model.id??'current'}`,async()=>{if(pendingSend.current)await pendingSend.current;const id=identity.current,snapshot=latestDraft.current,save=latestActions.current.onSaveDraft;try{const accepted=save?await save(snapshot):true;if(identity.current===id){setDraftSaveFailed(!accepted);if(accepted&&save)setAcceptedDraft(snapshot);}return accepted;}catch{if(identity.current===id)setDraftSaveFailed(true);return false;}},JSON.stringify({draft,sending}),draft!==acceptedDraft||sending||draftSaveFailed||Boolean(failed&&draft.trim()));
  async function send(event?: React.FormEvent) {
    event?.preventDefault();
    if (!draft.trim() || submitting.current || model.pending || !actions.onSend) return;
    submitting.current=true;setSending(true); setFailed(false);setDraftSaveFailed(false);
    const id=model.id;const operation=(async()=>{try{if(!await actions.onSend!(draft.trim()))throw new Error('Rejected');if(identity.current===id){setDraft('');setAcceptedDraft('');}return true;}catch{if(identity.current===id)setFailed(true);return false;}finally{if(identity.current===id)setSending(false);submitting.current=false;}})();pendingSend.current=operation;await operation;if(pendingSend.current===operation)pendingSend.current=null;
  }
  const hasMessages = Boolean(model.messages?.length);
  const composer = <form className="notion-chat-composer" onSubmit={(event) => void send(event)}>
    {Boolean(model.attachments?.length) && <div className="notion-chat-attachments">{model.attachments?.map((attachment) => <div key={attachment.id}><img src={attachment.previewUrl} alt={attachment.name} />{actions.onRemoveAttachment && <NotionButton type="button" aria-label={`Remove ${attachment.name}`} onClick={() => actions.onRemoveAttachment?.(attachment.id)}><X size={12} /></NotionButton>}</div>)}</div>}
    {model.author && <span className="notion-chat-author">{model.author.avatarUrl && <img src={model.author.avatarUrl} alt="" />}{model.author.name}</span>}
    {model.context && <span className="notion-chat-context"><NotionIconGlyph icon={model.context.icon} size={14} />{model.context.title}</span>}
    <Textarea ref={input} aria-label="Message Notion agent" placeholder={model.placeholder ?? (sidePanel ? 'Ask AI anything…' : 'Ask, search, or make anything…')} value={draft} disabled={sending || model.pending} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (notionShouldSubmit(event,preferences)) { event.preventDefault(); void send(); } }} />
    <div className="notion-chat-composer-tools"><NotionButton type="button" aria-label="Add attachment" disabled={!actions.onAttach} onClick={actions.onAttach}><Plus size={19} /></NotionButton><NotionButton type="button" aria-label="Chat settings" disabled={!actions.onSettings} onClick={actions.onSettings}>{model.settingsIconUrl ? <img src={model.settingsIconUrl} alt="" width={17} height={17}/> : <SlidersHorizontal size={17} />}</NotionButton><span className="notion-chat-auto">{model.showModelLabel === false ? '' : 'Auto'}</span><NotionButton type="button" aria-label="Voice input" disabled={!actions.onVoice} onClick={actions.onVoice}><Mic size={17} /></NotionButton><NotionButton type="submit" variant="default" className="notion-chat-send" aria-label="Send message" disabled={!draft.trim() || sending || model.pending || !actions.onSend}><ArrowUp size={19} /></NotionButton></div>
    {(failed || draftSaveFailed || model.error) && <p className="notion-surface-error" role="alert">{model.error || (draftSaveFailed?'Could not save. Your draft is preserved. Try again.':'Could not send. Your draft is preserved. Try again.')}</p>}
  </form>;
  return <section className={`notion-chat ${sidePanel ? 'notion-chat-panel' : 'notion-chat-full'} ${hasMessages ? 'has-messages' : ''}`} aria-label={sidePanel ? 'AI chat sidebar' : 'Notion AI chat'}>
    {sidePanel && <header className="notion-chat-panel-header"><span>{model.title || 'New AI chat'}</span><div><NotionButton aria-label="New AI chat" disabled={!actions.onNewChat} onClick={()=>void guard(()=>{setDraft('');setAcceptedDraft('');setFailed(false);actions.onNewChat?.();})}><MessageCirclePlus size={17} /></NotionButton><NotionButton aria-label="Close AI chat" disabled={!actions.onClose} onClick={()=>void guard(()=>actions.onClose?.())}><ChevronsRight size={19} /></NotionButton></div></header>}
    <div className="notion-chat-body">{!hasMessages ? <div className="notion-chat-welcome">{model.avatarUrl && <img className="notion-chat-avatar" src={model.avatarUrl} alt="Notion agent" />}<h1>{model.greeting}</h1>{model.description && <p>{model.description}</p>}</div> : <div className="notion-chat-messages" role="log" aria-label="Conversation messages" aria-live="polite">{model.messages?.map((message) => <React.Fragment key={message.id}>{message.role === 'assistant' && model.thoughtLabel && <div className="notion-chat-thought">{model.thoughtLabel}</div>}<div className={`notion-chat-message notion-chat-message-${message.role}`}>{message.role === 'assistant' ? message.text.split('\n\n').map((paragraph,index)=><p key={index}>{paragraph}</p>) : message.text}</div></React.Fragment>)}{model.quickReplies?.map((text) => <NotionButton key={text} className="notion-chat-quick-reply" onClick={() => { setDraft(text); input.current?.focus(); }}>{text}</NotionButton>)}{actions.onMessageAction && model.messages?.some((message)=>message.role==='assistant') && <div className="notion-chat-message-actions">{([{action:'copy',Icon:Copy},{action:'like',Icon:ThumbsUp},{action:'dislike',Icon:ThumbsDown}] as const).map(({action,Icon})=><NotionButton key={action} aria-label={`${action} response`} onClick={()=>actions.onMessageAction?.([...model.messages!].reverse().find((message)=>message.role==='assistant')!.id,action)}><Icon size={14}/></NotionButton>)}</div>}{model.pending && <p role="status">Thinking…</p>}</div>}
    {composer}
    {!hasMessages && !sidePanel && appsVisible && <div className="notion-chat-apps"><span>Get better answers from your apps</span><NotionButton disabled={!actions.onSettings} onClick={actions.onSettings} aria-label="Connect apps">{model.connectedAppsArtworkUrl ? <img className="notion-connected-apps-artwork" src={model.connectedAppsArtworkUrl} alt="Connected apps"/> : 'Connect apps'}</NotionButton><NotionButton aria-label="Dismiss app connections" onClick={() => setAppsVisible(false)}><X size={14} /></NotionButton></div>}
    {!hasMessages && !sidePanel && <div className="notion-chat-discovery"><div><small>Recent chats</small>{model.recentChats?.length?model.recentChats.map(chat=><NotionButton key={chat.id} disabled={!actions.onOpenChat} onClick={()=>void guard(()=>actions.onOpenChat?.(chat.id))}><MessageCircle size={17}/><span className="notion-truncate">{chat.title}</span></NotionButton>):<p>No chats yet</p>}</div><div><small>Suggested</small>{model.suggestions?.map((suggestion, index) => { const Icon = [Bot, CalendarDays, FileSearch][index % 3]; return <NotionButton key={suggestion.id} onClick={() => { setDraft(suggestion.prompt); input.current?.focus(); }}><Icon size={18} />{suggestion.label}</NotionButton>; })}</div></div>}
    </div>
  </section>;
}
