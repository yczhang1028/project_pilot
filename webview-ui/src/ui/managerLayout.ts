export type StoredViewMode = 'grid' | 'list' | 'mini';
export type ManagerLayout = 'command' | 'explorer' | 'gallery';

export const layoutOptions: ReadonlyArray<{
  id: ManagerLayout;
  label: string;
  stored: StoredViewMode;
}> = [
  { id: 'command', label: 'Command', stored: 'mini' },
  { id: 'explorer', label: 'Explorer', stored: 'list' },
  { id: 'gallery', label: 'Gallery', stored: 'grid' }
];

const storedToLayout: Record<StoredViewMode, ManagerLayout> = {
  mini: 'command',
  list: 'explorer',
  grid: 'gallery'
};

const layoutToStored: Record<ManagerLayout, StoredViewMode> = {
  command: 'mini',
  explorer: 'list',
  gallery: 'grid'
};

export function fromStoredViewMode(value: StoredViewMode | null | undefined): ManagerLayout {
  return value ? storedToLayout[value] ?? 'command' : 'command';
}

export function toStoredViewMode(value: ManagerLayout): StoredViewMode {
  return layoutToStored[value];
}

export function normalizeManagerLayout(value: unknown): ManagerLayout {
  return value === 'command' || value === 'explorer' || value === 'gallery'
    ? value
    : 'command';
}
