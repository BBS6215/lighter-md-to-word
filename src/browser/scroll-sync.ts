import type { DocumentModel } from '../core/model';

type Side = 'source' | 'preview';
interface Point { source: number; preview: number; offset: number }
interface Group { start: number; end: number; top: number; bottom: number }
const MIRROR_STYLE = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontStretch', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'textTransform', 'textAlign', 'whiteSpace', 'wordBreak', 'overflowWrap', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'direction'] as const;

function interpolate(points: Point[], value: number, from: keyof Point, to: keyof Point): number {
  if (!points.length) return 0;
  if (value <= points[0][from]) return points[0][to];
  let low = 0, high = points.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (points[mid][from] <= value) low = mid; else high = mid - 1;
  }
  const a = points[low], b = points[Math.min(low + 1, points.length - 1)];
  const span = b[from] - a[from];
  return span > 0 ? a[to] + (b[to] - a[to]) * Math.min(1, (value - a[from]) / span) : a[to];
}

/** Optional reading aid. Failure suspends sync, never conversion. All text is RAM-only. */
export class ScrollSync {
  private points: Point[] = [];
  private text = '';
  private model: DocumentModel | null = null;
  private mirror: HTMLDivElement | null = null;
  private buildFrame = 0;
  private scrollFrame = 0;
  private generation = 0;
  private driver: Side = 'source';
  private expected: Partial<Record<Side, number>> = {};
  private enabled = true;
  private readonly desktop = matchMedia('(min-width: 901px)');
  private readonly resizeObserver: ResizeObserver;

  constructor(private readonly editor: HTMLTextAreaElement, private readonly viewport: HTMLElement, private readonly paper: HTMLElement) {
    for (const side of ['source', 'preview'] as const) {
      const pane = this.pane(side);
      for (const type of ['wheel', 'pointerdown', 'touchstart']) pane.addEventListener(type, () => {
        this.driver = side; delete this.expected[side];
      }, { passive: true });
      pane.addEventListener('keydown', event => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
          this.driver = side; delete this.expected[side];
        }
      });
      pane.addEventListener('scroll', () => {
        const expected = this.expected[side];
        if (expected !== undefined && Math.abs(pane.scrollTop - expected) < 1) return;
        this.driver = side;
        if (!this.active || !this.points.length || this.scrollFrame) return;
        this.scrollFrame = requestAnimationFrame(() => { this.scrollFrame = 0; this.sync(this.driver); });
      }, { passive: true });
    }
    this.resizeObserver = new ResizeObserver(() => this.update(this.model, this.text));
    this.resizeObserver.observe(editor); this.resizeObserver.observe(viewport);
    this.desktop.addEventListener('change', () => this.update(this.model, this.text));
    void document.fonts.ready.then(() => this.update(this.model, this.text));
  }

  private pane(side: Side): HTMLElement { return side === 'source' ? this.editor : this.viewport; }
  private get active(): boolean { return this.enabled && this.desktop.matches; }

  setEnabled(enabled: boolean): void { this.enabled = enabled; this.update(this.model, this.text, false); }

  reset(): void {
    this.driver = 'source'; this.expected = {};
    this.move('source', 0); this.move('preview', 0);
  }

  private move(side: Side, top: number): void {
    const pane = this.pane(side), max = Math.max(0, pane.scrollHeight - pane.clientHeight);
    this.expected[side] = Math.max(0, Math.min(max, top));
    pane.scrollTop = this.expected[side]!;
    this.expected[side] = pane.scrollTop;
  }

  private sync(side: Side): void {
    if (!this.active || !this.points.length) return;
    const target: Side = side === 'source' ? 'preview' : 'source', pane = this.pane(side), other = this.pane(target);
    const max = pane.scrollHeight - pane.clientHeight, otherMax = other.scrollHeight - other.clientHeight;
    if (max <= 1 || otherMax <= 1) return;
    const top = pane.scrollTop;
    const mapped = top <= 1 ? 0 : top >= max - 1 ? otherMax : interpolate(this.points, top, side, target);
    this.move(target, mapped);
  }

  update(model: DocumentModel | null, text: string, preserve = true): void {
    const sameText = this.text === text;
    const oldPoints = this.points;
    const anchor = preserve && sameText && oldPoints.length ? interpolate(oldPoints, this.pane(this.driver).scrollTop, this.driver, 'offset') : undefined;
    const wasTop = this.pane(this.driver).scrollTop <= 1;
    this.model = model; this.text = text;
    const generation = ++this.generation;
    cancelAnimationFrame(this.buildFrame); cancelAnimationFrame(this.scrollFrame);
    this.buildFrame = 0; this.scrollFrame = 0; this.points = []; this.expected = {};
    this.mirror?.remove(); this.mirror = null;
    this.viewport.dataset.syncState = !this.active ? 'off' : 'idle';
    if (!this.active || !model || !text.trim() || this.paper.hidden) return;
    if (!sameText) this.driver = 'source';
    this.viewport.dataset.syncState = 'measuring';
    this.buildFrame = requestAnimationFrame(() => {
      this.buildFrame = 0;
      try { this.measure(generation, text, anchor, wasTop); }
      catch { this.suspend(generation); }
    });
  }

  private suspend(generation: number): void {
    if (generation !== this.generation) return;
    this.points = []; this.mirror?.remove(); this.mirror = null;
    this.viewport.dataset.syncState = 'unavailable';
  }

  private measure(generation: number, text: string, anchor: number | undefined, wasTop: boolean): void {
    if (generation !== this.generation) return;
    const computed = getComputedStyle(this.editor), mirror = document.createElement('div');
    for (const property of MIRROR_STYLE) mirror.style[property] = computed[property];
    Object.assign(mirror.style, { position: 'absolute', left: '-100000px', top: '0', visibility: 'hidden', boxSizing: 'border-box', width: `${this.editor.clientWidth}px`, height: 'auto', minHeight: '0', margin: '0', border: '0', pointerEvents: 'none' });
    mirror.className = 'source-mirror'; mirror.setAttribute('aria-hidden', 'true');
    // A sentinel gives trailing newlines and end-of-text ranges a real line box.
    const node = document.createTextNode(text + '\u200b'); mirror.append(node); document.body.append(mirror); this.mirror = mirror;
    const mirrorTop = mirror.getBoundingClientRect().top;
    const viewportTop = this.viewport.getBoundingClientRect().top + this.viewport.clientTop;
    const groups: Group[] = [];
    for (const element of this.paper.querySelectorAll<HTMLElement>('[data-source-start]')) {
      const start = Number(element.dataset.sourceStart), end = Number(element.dataset.sourceEnd), rect = element.getBoundingClientRect();
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) continue;
      const top = rect.top - viewportTop + this.viewport.scrollTop, bottom = rect.bottom - viewportTop + this.viewport.scrollTop;
      const last = groups.at(-1);
      if (last && start === last.start && end === last.end) last.bottom = Math.max(last.bottom, bottom);
      else if (!last || start >= last.end) groups.push({ start, end, top, bottom });
    }
    const range = document.createRange(), points: Point[] = [{ source: 0, preview: 0, offset: 0 }];
    const add = (source: number, preview: number, offset: number) => {
      const last = points.at(-1)!;
      if (source > last.source && preview >= last.preview && offset >= last.offset) points.push({ source, preview, offset });
    };
    let index = 0;
    const step = () => {
      if (generation !== this.generation) return;
      try {
        const deadline = performance.now() + 7;
        do {
          const group = groups[index++];
          if (!group) break;
          range.setStart(node, group.start); range.setEnd(node, group.start + 1);
          add(range.getBoundingClientRect().top - mirrorTop, group.top, group.start);
          range.setStart(node, group.end - 1); range.setEnd(node, group.end);
          add(range.getBoundingClientRect().bottom - mirrorTop, group.bottom, group.end);
        } while (index < groups.length && performance.now() < deadline);
        if (index < groups.length) { this.buildFrame = requestAnimationFrame(step); return; }
        this.buildFrame = 0;
        // Retain only numeric geometry, never a second historical body copy.
        mirror.remove(); if (this.mirror === mirror) this.mirror = null;
        this.points = points.length > 1 ? points : [];
        this.viewport.dataset.syncState = this.points.length ? 'ready' : 'idle';
        if (!this.points.length) return;
        if (anchor !== undefined && wasTop) this.reset();
        else if (anchor !== undefined) {
          this.move(this.driver, interpolate(this.points, anchor, 'offset', this.driver)); this.sync(this.driver);
        } else this.sync(this.driver);
      } catch { this.suspend(generation); }
    };
    step();
  }
}
