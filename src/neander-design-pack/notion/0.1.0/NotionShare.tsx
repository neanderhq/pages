import {useNotionSaveGuard} from './NotionNavigationGuard';
import { Input } from './ui/input';
import * as React from 'react';
import * as AvatarPrimitive from './ui/avatar';
import * as MenuPrimitive from './ui/dropdown-menu';
import * as PopoverPrimitive from './ui/popover';
import * as TabsPrimitive from './ui/tabs';
import { ChevronDown, CircleHelp, Globe2, Link2, LockKeyhole, Settings2, X } from "./ui/icons";
import { NotionButton } from './NotionPrimitives';
import type { NotionFrameworkActions, NotionFrameworkModel, NotionPage } from './NotionFramework';

type Share = NonNullable<NotionFrameworkModel['shareDialog']>;
type Theme = 'light' | 'dark';

export function NotionSharePopover({ share, page, theme, actions }: {
  share: Share | null; page: NotionPage; theme: Theme; actions: NotionFrameworkActions;
}) {
  const [tab, setTab] = React.useState<'share' | 'publish'>('share');
  const [advanced, setAdvanced] = React.useState(false);
  const [inviteError,setInviteError]=React.useState(false);
  const [email, setEmail] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [noticeVisible, setNoticeVisible] = React.useState(true);
  const emailRef = React.useRef<HTMLInputElement>(null);
  const request=React.useRef(false);
  useNotionSaveGuard(`page-share-${React.useId()}`,async()=>!request.current,pending,pending);
  const isOpen = share?.pageId === page.id;
  async function invite(event: React.FormEvent) {
    event.preventDefault();
    if (!share || !actions.onInvitePeople || !email.trim() || request.current) return;
    request.current=true;setPending(true); setMessage('');setInviteError(false);
    try { if (!await actions.onInvitePeople(share.pageId, email.trim())) throw new Error('Invite rejected'); setEmail(''); setMessage('Invitation sent'); }
    catch { setInviteError(true);setMessage('Could not send invitation. Try again.'); }
    finally { request.current=false;setPending(false); }
  }
  async function copy() {
    if (!share || !actions.onCopyPageLink) return;
    setMessage('');
    try { if (!await actions.onCopyPageLink(share.pageId)) throw new Error('Copy rejected'); setMessage('Link copied'); }
    catch { setMessage('Could not copy the link.'); }
  }
  async function changeAccess(label: string) {
    if (!share || !actions.onSetShareAccess || request.current) return;
    request.current=true;setPending(true); setMessage('');
    try { if (!await actions.onSetShareAccess(share.pageId, label)) throw new Error('Access rejected'); }
    catch { setMessage('Could not change general access.'); }
    finally { request.current=false;setPending(false); }
  }
  async function publish() {
    if (!share || !actions.onSetPagePublished || request.current) return;
    request.current=true;setPending(true); setMessage('');
    try { if (!await actions.onSetPagePublished(share.pageId, !share.published)) throw new Error('Publish rejected'); setMessage(share.published ? 'Page unpublished' : 'Page published'); }
    catch { setMessage('Could not update publishing.'); }
    finally { request.current=false;setPending(false); }
  }
  return <PopoverPrimitive.Popover open={isOpen} onOpenChange={(open) => {if(pending)return; if (open) { setTab('share'); setAdvanced(false); setMessage(''); actions.onSharePage?.(page.id); } else actions.onCloseShare?.(); }}>
    <PopoverPrimitive.PopoverTrigger asChild><NotionButton className="notion-share-action" aria-label="Share" aria-expanded={isOpen}><LockKeyhole size={13} />Share<ChevronDown size={12} /></NotionButton></PopoverPrimitive.PopoverTrigger>
    <PopoverPrimitive.PopoverContent padding="none" data-ui-pack="notion" className={`notion-share-popover notion-${theme}`} role="dialog" aria-label={`Share ${page.title || 'Untitled'}`} sideOffset={6} align="end" collisionPadding={8} onOpenAutoFocus={(event) => { if (tab === 'share' && !advanced && actions.onInvitePeople) { event.preventDefault(); emailRef.current?.focus(); } }}>
      {advanced ? <>
        <div className="notion-share-tabs"><NotionButton className="notion-share-back" onClick={() => setAdvanced(false)}>‹ <span>Advanced</span></NotionButton></div>
        <div className="notion-share-advanced"><strong>Page access</strong><p>General access: {share?.accessLabel}</p>{share?.agentAccessNotice && <p>{share.agentAccessNotice}</p>}</div>
      </> : <TabsPrimitive.Tabs value={tab} onValueChange={(value) => { setTab(value as 'share' | 'publish'); setMessage(''); }}>
        <div className="notion-share-tabs"><TabsPrimitive.TabsList variant="embedded" aria-label="Sharing views" className="notion-share-tab-list"><TabsPrimitive.TabsTrigger disabled={pending} value="share" className="notion-share-tab">Share</TabsPrimitive.TabsTrigger><TabsPrimitive.TabsTrigger disabled={pending} value="publish" className="notion-share-tab">Publish</TabsPrimitive.TabsTrigger></TabsPrimitive.TabsList>{share?.helpUrl && <a className="notion-share-help" href={share.helpUrl} target="_blank" rel="noopener noreferrer"><CircleHelp size={15} />Learn about sharing</a>}</div>
        <TabsPrimitive.TabsContent value="share" className="notion-share-tab-content">
          {actions.onInvitePeople && <form className="notion-share-invite" onSubmit={(event) => void invite(event)}><Input ref={emailRef} disabled={pending} type="text" aria-label="Email or group" aria-invalid={inviteError||undefined} placeholder="Email or group, separated by commas" value={email} onChange={(event) => {setEmail(event.target.value);setInviteError(false);setMessage('');}} required /><NotionButton variant="default" size="input" type="submit" disabled={pending}>{pending ? 'Inviting…' : 'Invite'}</NotionButton></form>}
          {share?.members && share.members.length > 0 && <div className="notion-share-members">{share.members.map((member) => <div className="notion-share-member" key={member.email || member.name}><AvatarPrimitive.Avatar className="notion-share-avatar">{member.avatarUrl && <AvatarPrimitive.AvatarImage src={member.avatarUrl} alt="" />}<AvatarPrimitive.AvatarFallback>{member.name.split(/\s+/).map((word) => word[0]).slice(0, 2).join('').toUpperCase()}</AvatarPrimitive.AvatarFallback></AvatarPrimitive.Avatar><div className="notion-share-member-details"><span>{member.name}{member.isYou && <em> (You)</em>}</span>{member.email && <small>{member.email}</small>}</div>{actions.onSetShareMemberRole&&member.email&&member.roleOptions?.length?<MenuPrimitive.DropdownMenu><MenuPrimitive.DropdownMenuTrigger asChild><NotionButton className="notion-share-member-role" disabled={pending}>{member.role}<ChevronDown size={14}/></NotionButton></MenuPrimitive.DropdownMenuTrigger><MenuPrimitive.DropdownMenuContent align="end">{member.roleOptions.map(role=><MenuPrimitive.DropdownMenuItem key={role} onSelect={()=>void (async()=>{if(request.current)return;request.current=true;setPending(true);setMessage('');try{if(!await actions.onSetShareMemberRole!(page.id,member.email!,role))throw new Error('Rejected');}catch{setMessage('Could not update access.');}finally{request.current=false;setPending(false);}})()}>{role}</MenuPrimitive.DropdownMenuItem>)}</MenuPrimitive.DropdownMenuContent></MenuPrimitive.DropdownMenu>:<span className="notion-share-member-role">{member.role}</span>}</div>)}</div>}
          <div className="notion-share-general"><strong>General access</strong><div className="notion-share-access-row"><span className="notion-share-access-icon">{share?.accessLabel === 'Only people invited' ? <LockKeyhole size={17} /> : <Globe2 size={17} />}</span>{share && actions.onSetShareAccess && (share.accessOptions?.length ?? 0) > 1 ? <MenuPrimitive.DropdownMenu><MenuPrimitive.DropdownMenuTrigger asChild><NotionButton className="notion-share-access-button" disabled={pending}>{share.accessLabel}<ChevronDown size={15} /></NotionButton></MenuPrimitive.DropdownMenuTrigger><MenuPrimitive.DropdownMenuContent data-ui-pack="notion" className={`notion-menu notion-${theme}`} sideOffset={4} align="start">{share.accessOptions?.map((option) => <MenuPrimitive.DropdownMenuItem key={option} className="notion-menu-item" onSelect={() => void changeAccess(option)}>{option === 'Only people invited' ? <LockKeyhole size={15} /> : <Globe2 size={15} />}{option}</MenuPrimitive.DropdownMenuItem>)}</MenuPrimitive.DropdownMenuContent></MenuPrimitive.DropdownMenu> : <span className="notion-share-access-label">{share?.accessLabel}</span>}</div></div>
          <div className="notion-share-footer"><NotionButton className="notion-share-advanced-link" disabled={pending} onClick={() => setAdvanced(true)}><Settings2 size={18} />Advanced</NotionButton>{actions.onCopyPageLink && <NotionButton variant="outline" className="notion-share-copy" onClick={() => void copy()}><Link2 size={17} />Copy link</NotionButton>}</div>
          {share?.agentAccessNotice && noticeVisible && <div className="notion-share-notice"><NotionButton variant="link" disabled={pending} onClick={() => setAdvanced(true)}>{share.agentAccessNotice}</NotionButton><NotionButton variant="link" aria-label="Dismiss agent access notice" disabled={pending} onClick={() => setNoticeVisible(false)}><X size={15} /></NotionButton></div>}
        </TabsPrimitive.TabsContent>
        <TabsPrimitive.TabsContent value="publish" className="notion-share-publish"><Globe2 size={25} /><strong>Publish this page</strong><p>Make this page available on the web.</p><NotionButton variant="default" disabled={!actions.onSetPagePublished || pending} onClick={() => void publish()}>{pending ? 'Updating…' : share?.published ? 'Unpublish' : 'Publish'}</NotionButton></TabsPrimitive.TabsContent>
      </TabsPrimitive.Tabs>}
      {message && <div className="notion-share-message" role={message.startsWith('Could not') ? 'alert' : 'status'}>{message}</div>}
    </PopoverPrimitive.PopoverContent>
  </PopoverPrimitive.Popover>;
}
