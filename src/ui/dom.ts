// Every UI module imports this file, so the overlay stylesheet is always loaded with it.
import './ui.css';

export type Child = Node | string | number | false | null | undefined | readonly Child[];

type EventHandlers = {
  [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void;
};

/** The props `h` understands. Anything unusual goes through `attrs`. */
export interface HProps {
  class?: string;
  id?: string;
  /** Sets textContent. Use children for anything richer. */
  text?: string;
  type?: string;
  value?: string;
  name?: string;
  title?: string;
  role?: string;
  htmlFor?: string;
  disabled?: boolean;
  checked?: boolean;
  hidden?: boolean;
  tabIndex?: number;
  /** Inline style as a CSS string. Prefer classes. */
  style?: string;
  /** Plain attributes, for example `{ 'aria-label': 'Close' }`. `false` and `undefined` are skipped. */
  attrs?: Record<string, string | number | boolean | undefined>;
  dataset?: Record<string, string>;
  /** Event listeners, for example `{ click: () => next() }`. */
  on?: EventHandlers;
}

/** Appends children, skipping null, undefined and false. Strings and numbers become text nodes. */
export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) {
      append(parent, child as readonly Child[]);
    } else if (child instanceof Node) {
      parent.appendChild(child);
    } else {
      parent.appendChild(document.createTextNode(String(child)));
    }
  }
}

/** Tiny typed element builder: `h('button', { class: 'tq-btn', on: { click } }, 'Next')`. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: HProps | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    if (props.class !== undefined) el.className = props.class;
    if (props.id !== undefined) el.id = props.id;
    if (props.type !== undefined) el.setAttribute('type', props.type);
    if (props.name !== undefined) el.setAttribute('name', props.name);
    if (props.title !== undefined) el.title = props.title;
    if (props.role !== undefined) el.setAttribute('role', props.role);
    if (props.htmlFor !== undefined) el.setAttribute('for', props.htmlFor);
    if (props.style !== undefined) el.setAttribute('style', props.style);
    if (props.tabIndex !== undefined) el.tabIndex = props.tabIndex;
    if (props.hidden) el.hidden = true;
    if (props.value !== undefined) (el as unknown as HTMLInputElement).value = props.value;
    if (props.checked !== undefined) (el as unknown as HTMLInputElement).checked = props.checked;
    if (props.disabled !== undefined) el.toggleAttribute('disabled', props.disabled);
    if (props.text !== undefined) el.textContent = props.text;
    if (props.attrs) {
      for (const [key, value] of Object.entries(props.attrs)) {
        if (value === undefined || value === false) continue;
        el.setAttribute(key, value === true ? '' : String(value));
      }
    }
    if (props.dataset) {
      for (const [key, value] of Object.entries(props.dataset)) el.dataset[key] = value;
    }
    if (props.on) {
      for (const [event, handler] of Object.entries(props.on)) {
        if (handler) el.addEventListener(event, handler as EventListener);
      }
    }
  }
  append(el, children);
  return el;
}

/** Removes every child of an element. */
export function clear(el: Element): void {
  el.replaceChildren();
}
