// Serialized into a CDP isolated world. Page scripts cannot overwrite ref state.
export function domOperation(operation, args) {
  const error = (code, message) => { throw new Error(`BB:${code}:${message}`); };
  const state = globalThis.__browserBridgeIsolatedV2 ||= { references: new Map() };
  const roots = [];
  const visit = root => { roots.push(root); for (const el of root.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot); };
  visit(document);
  const query = selector => { try { return roots.flatMap(root => [...root.querySelectorAll(selector)]); } catch { error('INVALID_SELECTOR', `Invalid CSS selector: ${selector}`); } };
  const visible = element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return element.isConnected && rect.width > 0 && rect.height > 0 && style.display !== 'none' && !['hidden', 'collapse'].includes(style.visibility) && style.opacity !== '0';
  };
  const target = (allowMissing = false) => {
    let element;
    if (args.ref) {
      element = state.references.get(args.ref);
      if (!element || !element.isConnected) error('STALE_REFERENCE', 'The reference expired. Take a new snapshot.');
    } else if (args.selector) {
      const elements = query(args.selector);
      if (elements.length > 1) error('AMBIGUOUS_TARGET', `Selector matched ${elements.length} elements. Use a ref or more specific selector.`);
      element = elements[0];
    } else error('INVALID_ARGUMENT', 'Use an element ref or CSS selector.');
    if (!element && !allowMissing) error('ELEMENT_NOT_FOUND', 'No element matches the target.');
    return element;
  };
  const label = element => {
    const root = element.getRootNode();
    const labelled = element.getAttribute('aria-labelledby')?.split(/\s+/).map(id => root.getElementById?.(id)?.textContent || '').join(' ').trim();
    return (element.getAttribute('aria-label') || labelled || [...(element.labels || [])].map(el => el.textContent).join(' ') || element.innerText || element.getAttribute('alt') || element.getAttribute('placeholder') || element.getAttribute('title') || element.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  };
  if (operation === 'snapshot') {
    state.references.clear();
    const candidates = query('a[href],button,input:not([type="hidden"]),textarea,select,summary,[role],[contenteditable="true"],[tabindex]').filter(visible);
    const elements = candidates.slice(0, args.limit).map((element, index) => {
      const ref = `${args.snapshotId}:${index + 1}`;
      state.references.set(ref, element);
      const r = element.getBoundingClientRect();
      const item = { ref, tag: element.tagName.toLowerCase(), role: element.getAttribute('role') || undefined, name: label(element), type: element.getAttribute('type') || undefined, disabled: !!element.disabled || element.getAttribute('aria-disabled') === 'true', bounds: { x: r.x, y: r.y, width: r.width, height: r.height }, inViewport: r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth };
      if ('checked' in element) item.checked = element.checked;
      if (!['password', 'file'].includes(element.type) && 'value' in element) item.value = String(element.value).slice(0, 500);
      if (element.tagName === 'SELECT') item.options = [...element.options].slice(0, 100).map(o => ({ value: o.value, label: o.label, selected: o.selected, disabled: o.disabled }));
      return item;
    });
    return { url: location.href, title: document.title, elements, total: candidates.length, truncated: candidates.length > elements.length, snapshotId: args.snapshotId, coverage: 'document and open shadow roots; closed shadow roots are not exposed' };
  }
  if (operation === 'content') {
    const text = roots.map(root => root === document ? document.body?.innerText || '' : root.textContent || '').join('\n');
    return { url: location.href, title: document.title, text: text.slice(0, args.maxChars), truncated: text.length > args.maxChars };
  }
  if (operation === 'wait') {
    const element = args.ref || args.selector ? target(true) : null;
    const textMatches = args.text === undefined || (element?.innerText || document.body?.innerText || '').includes(args.text);
    const matched = args.state === 'hidden' ? (!element || !visible(element)) : args.state === 'attached' ? !!element : (args.ref || args.selector ? !!element && visible(element) : true);
    return { matched: matched && textMatches };
  }
  const element = target();
  if (operation === 'resolve') return element;
  if (operation === 'prepare') {
    if (element.disabled || element.getAttribute('aria-disabled') === 'true') error('ELEMENT_DISABLED', 'The element is disabled.');
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    if (!visible(element)) error('ELEMENT_HIDDEN', 'The element is not visible.');
    if (args.hitTest) {
      const rect = element.getBoundingClientRect();
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      let hit = document.elementFromPoint(x, y);
      while (hit?.shadowRoot) {
        const inner = hit.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === hit) break;
        hit = inner;
      }
      if (!hit || (hit !== element && !element.contains(hit))) error('ELEMENT_OBSCURED', 'Another element covers the target, or its center is outside the viewport. Inspect a new screenshot before retrying.');
    }
    if (args.editable && !(element.isContentEditable || element.tagName === 'TEXTAREA' || (element.tagName === 'INPUT' && ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(element.type)))) error('NOT_EDITABLE', 'The target is not a text field.');
    if (args.editable && element.readOnly) error('NOT_EDITABLE', 'The field is read-only.');
    if (args.focus) {
      element.focus({ preventScroll: true });
      if (document.activeElement !== element && element.getRootNode().activeElement !== element) error('FOCUS_FAILED', 'The page did not focus the target.');
    }
    return { tag: element.tagName.toLowerCase() };
  }
  if (operation === 'select') {
    if (element.tagName !== 'SELECT') error('NOT_SELECT', 'Use a native select element. For custom menus use click/press.');
    if (element.disabled) error('ELEMENT_DISABLED', 'The select is disabled.');
    if (!element.multiple && args.values.length !== 1) error('INVALID_ARGUMENT', 'A single select requires one value.');
    for (const value of args.values) {
      const option = [...element.options].find(item => item.value === value);
      if (!option) error('OPTION_NOT_FOUND', `No option has value ${value}.`);
      if (option.disabled || option.parentElement?.disabled) error('ELEMENT_DISABLED', `Option ${value} is disabled.`);
    }
    for (const option of element.options) option.selected = args.values.includes(option.value);
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { values: [...element.selectedOptions].map(option => option.value) };
  }
  if (operation === 'file') {
    if (element.tagName !== 'INPUT' || element.type !== 'file') error('NOT_FILE_INPUT', 'Use an input[type=file] element.');
    if (!element.multiple && args.fileCount > 1) error('INVALID_ARGUMENT', 'This input accepts only one file.');
    return element;
  }
  error('UNKNOWN_ACTION', `Unknown DOM operation: ${operation}`);
}
