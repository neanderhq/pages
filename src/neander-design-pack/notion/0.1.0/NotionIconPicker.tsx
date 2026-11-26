import {useNotionSaveGuard} from './NotionNavigationGuard';
import { Input } from './ui/input';
import * as React from 'react';
import * as PopoverPrimitive from './ui/popover';
import * as TabsPrimitive from './ui/tabs';
import { Clock3, Smile, Leaf, Carrot, Trophy, Plane, Lightbulb, Heart, Flag, Grid2X2, Search, Shuffle, Upload } from "./ui/icons";
import { NotionButton, NotionIconGlyph, notionLineIcons } from './NotionPrimitives';

type EmojiChoice = { glyph: string; label: string };
type EmojiCategory = { id: string; label: string; Icon: typeof Smile; choices: EmojiChoice[] };
const choices = (entries: string): EmojiChoice[] => entries.trim().split('|').map((entry) => {
  const [glyph, label] = entry.split('~');
  return { glyph, label };
});
const emojiCategories: EmojiCategory[] = [
  { id: 'people', label: 'People', Icon: Smile, choices: choices('😀~Grinning face|😃~Smiling face|😄~Happy face|😁~Beaming face|😆~Laughing face|😅~Sweat smile|🤣~Rolling laughter|😂~Tears of joy|🙂~Slight smile|🙃~Upside down face|🫠~Melting face|😉~Winking face|😊~Smiling eyes|😇~Halo face|🥰~Smiling hearts|😍~Heart eyes|🤩~Star eyes|😘~Blowing kiss|😗~Kissing face|☺️~Smiling face|😚~Kissing closed eyes|😙~Kissing smiling eyes|🥲~Smiling tear|😋~Yummy face|😛~Tongue face|😜~Winking tongue|🤪~Zany face|😝~Squinting tongue|🤑~Money face|🤗~Hugging face|🤭~Hand over mouth|🫢~Open eyes hand over mouth|🫣~Peeking face|🤫~Shushing face|🤔~Thinking face|🫡~Saluting face|🤐~Zipper mouth|🤨~Raised eyebrow|😐~Neutral face|😑~Expressionless face|😶~Face without mouth|🫥~Dotted line face|😏~Smirking face|😒~Unamused face|🙄~Rolling eyes|😬~Grimacing face|😮‍💨~Exhaling face|🤥~Lying face|😌~Relieved face|😔~Pensive face|😪~Sleepy face|🤤~Drooling face|😴~Sleeping face|😷~Mask face|🤒~Sick face|🤕~Bandaged face|🤢~Nauseated face|🤮~Vomiting face|🥵~Hot face|🥶~Cold face|🥳~Party face|🥸~Disguised face|😎~Sunglasses face|🤓~Nerd face|🧐~Monocle face|👋~Waving hand|👏~Clapping hands|👍~Thumbs up|🙌~Raised hands') },
  { id: 'nature', label: 'Nature', Icon: Leaf, choices: choices('🐶~Dog|🐱~Cat|🐭~Mouse|🐹~Hamster|🐰~Rabbit|🦊~Fox|🐻~Bear|🐼~Panda|🐨~Koala|🐯~Tiger|🦁~Lion|🐮~Cow|🐷~Pig|🐸~Frog|🐵~Monkey|🐔~Chicken|🐧~Penguin|🐦~Bird|🦋~Butterfly|🐝~Bee|🌸~Cherry blossom|🌻~Sunflower|🌴~Palm tree|🌵~Cactus|🍀~Clover|🌿~Herb|🌈~Rainbow|☀️~Sun|🌙~Moon|⭐~Star|🔥~Fire|🌊~Wave') },
  { id: 'food', label: 'Food & drink', Icon: Carrot, choices: choices('🍎~Apple|🍐~Pear|🍊~Orange|🍋~Lemon|🍌~Banana|🍉~Watermelon|🍇~Grapes|🍓~Strawberry|🫐~Blueberries|🍒~Cherries|🥑~Avocado|🥕~Carrot|🌽~Corn|🍞~Bread|🥐~Croissant|🧀~Cheese|🍕~Pizza|🍔~Burger|🍟~Fries|🌮~Taco|🍣~Sushi|🍰~Cake|🍪~Cookie|☕~Coffee|🍵~Tea|🍷~Wine') },
  { id: 'activity', label: 'Activity', Icon: Trophy, choices: choices('⚽~Soccer|🏀~Basketball|🏈~Football|⚾~Baseball|🎾~Tennis|🏐~Volleyball|🎱~Pool|🏓~Ping pong|🎮~Game controller|🎲~Dice|🎨~Art|🎭~Theater|🎬~Film|🎵~Music|🎸~Guitar|🎯~Target|🏆~Trophy|🥇~Gold medal|🎉~Celebration') },
  { id: 'travel', label: 'Travel & places', Icon: Plane, choices: choices('🚗~Car|🚕~Taxi|🚌~Bus|🚲~Bicycle|🚆~Train|✈️~Airplane|🚀~Rocket|⛵~Sailboat|🗺️~Map|🧭~Compass|🏔️~Mountain|🏖️~Beach|🏙️~City|🏠~House|🏢~Office|🏰~Castle|🗼~Tower|🌍~Earth|🌐~Globe|☁️~Cloud') },
  { id: 'objects', label: 'Objects', Icon: Lightbulb, choices: choices('💡~Light bulb|📄~Document|📋~Clipboard|📊~Chart|📝~Memo|📚~Books|🔎~Magnifying glass|🗂️~Folders|📅~Calendar|🧰~Toolbox|🔑~Key|🔒~Lock|📎~Paperclip|✏️~Pencil|🖊️~Pen|💻~Laptop|📱~Phone|📷~Camera|🔔~Bell|🎁~Gift|💬~Speech balloon|🧪~Test tube') },
  { id: 'symbols', label: 'Symbols', Icon: Heart, choices: choices('❤️~Red heart|🧡~Orange heart|💛~Yellow heart|💚~Green heart|💙~Blue heart|💜~Purple heart|🖤~Black heart|🤍~White heart|✅~Check mark|❌~Cross mark|⭐~Star|✨~Sparkles|⚡~Lightning|💯~Hundred points|➕~Plus|➖~Minus|❓~Question mark|❗~Exclamation|🔴~Red circle|🟢~Green circle|🔵~Blue circle') },
  { id: 'flags', label: 'Flags', Icon: Flag, choices: choices('🏳️~White flag|🏴~Black flag|🏁~Checkered flag|🚩~Triangular flag|🇺🇸~United States|🇬🇧~United Kingdom|🇮🇳~India|🇨🇦~Canada|🇫🇷~France|🇩🇪~Germany|🇯🇵~Japan|🇰🇷~South Korea|🇦🇺~Australia|🇧🇷~Brazil') },
];

export function NotionIconPicker({ icon, onChoose, onUpload, theme = 'light', disabled = false, compact = false }: {
  icon?: string; onChoose: (icon: string | null) => void; onUpload?: (file: File) => Promise<string | null>;
  theme?: 'light' | 'dark'; disabled?: boolean;compact?:boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState('emoji');
  const [filter, setFilter] = React.useState('');
  const [recent, setRecent] = React.useState<string[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState('');
  const uploadBusy=React.useRef(false);
  useNotionSaveGuard(`page-icon-upload-${React.useId()}`,async()=>!uploadBusy.current,uploading,uploading);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const query = filter.trim().toLowerCase();
  const recentEmoji = recent.filter((item) => !item.startsWith('notion-icon:') && !item.startsWith('data:') && !item.startsWith('https://'));
  const visibleCategories = emojiCategories.map((category) => ({ ...category, choices: query ? category.choices.filter((choice) => choice.label.toLowerCase().includes(query) || choice.glyph.includes(query)) : category.choices })).filter((category) => category.choices.length);
  const visibleIcons = notionLineIcons.filter((entry) => !query || entry.label.toLowerCase().includes(query));
  function select(next: string) {
    onChoose(next);
    setRecent((current) => [next, ...current.filter((item) => item !== next)].slice(0, 12));
    setOpen(false);
  }
  function jumpTo(id: string) {
    setFilter('');
    setTab('emoji');
    window.requestAnimationFrame(() => {
      const container = scrollRef.current;
      const section = container?.querySelector<HTMLElement>(`[data-icon-category="${id}"]`);
      if (container && section) container.scrollTo({ top: section.offsetTop - container.offsetTop, behavior: 'smooth' });
    });
  }
  async function upload(file?: File) {
    if (!file || !onUpload || uploadBusy.current) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5_000_000) { setUploadError('Choose a PNG, JPEG, WebP, or GIF under 5 MB.'); return; }
    uploadBusy.current=true;setUploading(true); setUploadError('');
    try { const result = await onUpload(file); if (!result) throw new Error('Upload failed'); select(result); }
    catch { setUploadError('Could not upload this icon. Try again.'); }
    finally { uploadBusy.current=false;setUploading(false); }
  }
  return <PopoverPrimitive.Popover open={open} onOpenChange={(next) => { if(uploadBusy.current)return;setOpen(next); if (next) setTab('emoji'); else { setFilter(''); setUploadError(''); } }}>
    <PopoverPrimitive.PopoverTrigger asChild><NotionButton className={`notion-editor-icon ${compact?'notion-editor-icon-compact':''} ${icon ? '' : 'notion-editor-icon-empty'}`} aria-label={icon ? 'Change page icon' : 'Add page icon'} disabled={disabled}>{icon ? <NotionIconGlyph icon={icon} size={compact?48:78} /> : 'Add icon'}</NotionButton></PopoverPrimitive.PopoverTrigger>
    <PopoverPrimitive.PopoverContent padding="none" data-ui-pack="notion" className={`notion-icon-popover notion-${theme}`} sideOffset={6} align="start" collisionPadding={8} onOpenAutoFocus={(event) => { event.preventDefault(); searchRef.current?.focus(); }}>
      <TabsPrimitive.Tabs value={tab} onValueChange={(value) => { setTab(value); setFilter(''); }}>
        <div className="notion-icon-tabs"><TabsPrimitive.TabsList variant="embedded" aria-label="Icon source" className="notion-icon-tab-list"><TabsPrimitive.TabsTrigger value="emoji" className="notion-icon-tab">Emoji</TabsPrimitive.TabsTrigger><TabsPrimitive.TabsTrigger value="icons" className="notion-icon-tab">Icons</TabsPrimitive.TabsTrigger><TabsPrimitive.TabsTrigger value="upload" className="notion-icon-tab">Upload</TabsPrimitive.TabsTrigger></TabsPrimitive.TabsList><NotionButton className="notion-icon-remove" disabled={!icon} onClick={() => { onChoose(null); setOpen(false); }}>Remove</NotionButton></div>
        {tab !== 'upload' && <div className="notion-icon-search-row"><label className="notion-icon-search"><Search size={17} aria-hidden="true" /><Input variant="embedded" ref={searchRef} aria-label="Filter icons" placeholder="Filter..." value={filter} onChange={(event) => setFilter(event.target.value)} /></label>{tab === 'emoji' && <NotionButton className="notion-icon-shuffle" aria-label="Random emoji" title="Random emoji" onClick={() => { const all = emojiCategories.flatMap((category) => category.choices); select(all[Math.floor(Math.random() * all.length)].glyph); }}><Shuffle size={16} /></NotionButton>}</div>}
        <TabsPrimitive.TabsContent value="emoji" className="notion-icon-content"><div className="notion-icon-scroll" ref={scrollRef}>
          {!query && recentEmoji.length > 0 && <section data-icon-category="recent"><h3>Recently used</h3><div className="notion-icon-grid">{recentEmoji.map((choice) => <NotionButton key={choice} aria-label={`Use ${choice} icon`} aria-pressed={icon === choice} onClick={() => select(choice)}>{choice}</NotionButton>)}</div></section>}
          {visibleCategories.map((category) => <section key={category.id} data-icon-category={category.id}><h3>{category.label}</h3><div className="notion-icon-grid">{category.choices.map((choice) => <NotionButton key={choice.glyph} aria-label={`Use ${choice.glyph} icon`} aria-pressed={icon === choice.glyph} title={choice.label} onClick={() => select(choice.glyph)}>{choice.glyph}</NotionButton>)}</div></section>)}
          {visibleCategories.length === 0 && <p className="notion-icon-empty">No emoji found</p>}
        </div><div className="notion-icon-categories"><NotionButton aria-label="Recently used emoji" title="Recently used" disabled={!recentEmoji.length} onClick={() => jumpTo('recent')}><Clock3 size={18} /></NotionButton>{emojiCategories.map((category) => <NotionButton key={category.id} aria-label={`${category.label} emoji`} title={category.label} onClick={() => jumpTo(category.id)}><category.Icon size={18} /></NotionButton>)}<NotionButton aria-label="All emoji" title="All emoji" onClick={() => jumpTo('people')}><Grid2X2 size={18} /></NotionButton></div></TabsPrimitive.TabsContent>
        <TabsPrimitive.TabsContent value="icons" className="notion-icon-content"><div className="notion-icon-scroll"><section><h3>Icons</h3><div className="notion-icon-grid notion-line-icon-grid">{visibleIcons.map((entry) => <NotionButton key={entry.id} aria-label={`Use ${entry.label} icon`} aria-pressed={icon === `notion-icon:${entry.id}`} title={entry.label} onClick={() => select(`notion-icon:${entry.id}`)}><entry.Icon size={22} strokeWidth={1.8} /></NotionButton>)}</div>{visibleIcons.length === 0 && <p className="notion-icon-empty">No icons found</p>}</section></div></TabsPrimitive.TabsContent>
        <TabsPrimitive.TabsContent value="upload" className="notion-icon-upload"><Upload size={28} aria-hidden="true" /><strong>Upload an icon</strong><p>PNG, JPEG, WebP, or GIF up to 5 MB</p><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Choose icon file" hidden onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ''; }} /><NotionButton disabled={!onUpload || uploading} className="notion-icon-upload-button" onClick={() => fileRef.current?.click()}>{uploading ? 'Uploading…' : 'Choose image'}</NotionButton>{!onUpload && <p>Image upload is unavailable in this workspace.</p>}{uploadError && <p role="alert" className="notion-icon-upload-error">{uploadError}</p>}</TabsPrimitive.TabsContent>
      </TabsPrimitive.Tabs>
    </PopoverPrimitive.PopoverContent>
  </PopoverPrimitive.Popover>;
}
