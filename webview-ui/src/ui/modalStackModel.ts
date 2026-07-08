export interface ModalEntry {
  id: string;
  dismissible: boolean;
}

export type ModalStack = readonly ModalEntry[];

export function emptyModalStack(): ModalStack {
  return [];
}

export function pushModal(stack: ModalStack, entry: ModalEntry): ModalStack {
  return [...stack.filter(item => item.id !== entry.id), entry];
}

export function removeModal(stack: ModalStack, id: string): ModalStack {
  return stack.filter(item => item.id !== id);
}

export function getTopModal(stack: ModalStack): ModalEntry | undefined {
  return stack[stack.length - 1];
}

export function getModalLayer(stack: ModalStack, id: string): number {
  return stack.findIndex(item => item.id === id);
}
