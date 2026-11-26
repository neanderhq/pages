import * as React from 'react';

export type NotionTheme = 'light' | 'dark';
const ThemeContext = React.createContext<NotionTheme>('light');
const LayerContext = React.createContext(0);

export function NotionDialogLayer({children}:{children:React.ReactNode}){
  const level=React.useContext(LayerContext);
  return <LayerContext.Provider value={level+1}>{children}</LayerContext.Provider>;
}
export function useNotionLayerZIndex(kind:'popup'|'dialog'|'overlay'){
  const level=React.useContext(LayerContext);
  return (kind==='dialog'?1301:kind==='popup'?1150:1100)+level*200;
}

export function NotionThemeProvider({ theme, children }: { theme: NotionTheme; children: React.ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/** Portals read the active pack theme instead of inheriting the host document theme. */
export function useNotionThemeClass() {
  return `notion-${React.useContext(ThemeContext)}`;
}
