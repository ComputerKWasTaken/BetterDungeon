// modules/scripture/validators.js
//
// Validation and sanitization helpers for the Frontier Scripture module.
// These are intentionally pure-ish utilities so the module can reject malformed
// state without the renderer throwing during a Frontier dispatch tick.

(function () {
  if (window.ScriptureValidators) return;

  const WIDGET_TYPES = new Set([
    'stat',
    'bar',
    'text',
    'panel',
    'custom',
    'badge',
    'list',
    'icon',
    'counter',
  ]);

  const VALID_ALIGNMENTS = new Set(['left', 'center', 'right']);

  const PRESET_COLORS = new Set([
    'red',
    'green',
    'blue',
    'yellow',
    'purple',
    'cyan',
    'orange',
  ]);

  const ALLOWED_TAGS = new Set([
    'div', 'span', 'p', 'br', 'hr',
    'strong', 'b', 'em', 'i', 'u', 's', 'mark',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'img', 'a',
    'pre', 'code', 'blockquote',
  ]);

  const BLOCKED_TAGS = new Set([
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'svg',
    'math',
    'link',
    'meta',
    'base',
  ]);

  const ALLOWED_ATTRS = {
    '*': ['class', 'id', 'style', 'title'],
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
  };

  const ALLOWED_STYLES = new Set([
    'color', 'background-color', 'background',
    'font-size', 'font-weight', 'font-style', 'font-family',
    'text-align', 'text-decoration', 'text-transform',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'border', 'border-radius', 'border-color', 'border-width', 'border-style',
    'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height',
    'display', 'flex', 'flex-direction', 'justify-content', 'align-items', 'gap',
    'opacity', 'visibility', 'overflow',
    'position', 'top', 'right', 'bottom', 'left', 'z-index',
  ]);

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function validateWidgetConfig(widgetId, config) {
    const errors = [];

    if (!widgetId || typeof widgetId !== 'string') {
      errors.push('Widget ID must be a non-empty string');
    } else if (!/^[a-zA-Z0-9_-]+$/.test(widgetId)) {
      errors.push('Widget ID must contain only alphanumeric characters, underscores, and hyphens');
    }

    if (!isPlainObject(config)) {
      errors.push('Widget config must be an object');
      return { valid: false, errors };
    }

    if (!config.type) {
      errors.push('Widget config missing required "type" field');
    } else if (!WIDGET_TYPES.has(config.type)) {
      errors.push(`Unknown widget type: "${config.type}". Valid types: ${[...WIDGET_TYPES].join(', ')}`);
    }

    if (config.align !== undefined && !VALID_ALIGNMENTS.has(config.align)) {
      errors.push(`Widget align must be one of: ${[...VALID_ALIGNMENTS].join(', ')}`);
    }

    if (config.type === 'bar') {
      if (config.max !== undefined && (typeof config.max !== 'number' || config.max <= 0)) {
        errors.push('Bar widget "max" must be a positive number');
      }
      if (config.value !== undefined && typeof config.value !== 'number') {
        errors.push('Bar widget "value" must be a number');
      }
    }

    if (config.type === 'panel' && config.items !== undefined && !Array.isArray(config.items)) {
      errors.push('Panel widget "items" must be an array');
    }

    if (config.type === 'list' && config.items !== undefined && !Array.isArray(config.items)) {
      errors.push('List widget "items" must be an array');
    }

    if (config.type === 'custom' && config.html !== undefined && typeof config.html !== 'string') {
      errors.push('Custom widget "html" must be a string');
    }

    return { valid: errors.length === 0, errors };
  }

  function validateManifest(manifest) {
    const errors = [];
    const widgets = [];

    if (!isPlainObject(manifest)) {
      return { valid: false, widgets, errors: ['Manifest must be an object'] };
    }

    if (manifest.widgets === undefined) {
      return { valid: true, widgets, errors };
    }

    if (!Array.isArray(manifest.widgets)) {
      return { valid: false, widgets, errors: ['Manifest widgets must be an array'] };
    }

    for (let i = 0; i < manifest.widgets.length; i++) {
      const widget = manifest.widgets[i];
      if (!isPlainObject(widget)) {
        errors.push(`Widget at index ${i} must be an object`);
        continue;
      }

      const validation = validateWidgetConfig(widget.id, widget);
      if (!validation.valid) {
        errors.push(`Widget "${widget.id || i}" invalid: ${validation.errors.join('; ')}`);
        continue;
      }

      widgets.push(widget);
    }

    return { valid: errors.length === 0, widgets, errors };
  }

  function sanitizeHTML(html) {
    if (typeof html !== 'string') return '';

    const temp = document.createElement('div');
    temp.innerHTML = html;
    sanitizeNode(temp);
    return temp.innerHTML;
  }

  function sanitizeNode(node) {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      sanitizeElement(child);
    }
  }

  function sanitizeElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
    const tagName = el.tagName.toLowerCase();

    if (BLOCKED_TAGS.has(tagName)) {
      el.remove();
      return;
    }

    if (!ALLOWED_TAGS.has(tagName)) {
      const parent = el.parentNode;
      if (!parent) {
        el.remove();
        return;
      }
      const toHoist = Array.from(el.childNodes);
      for (const child of toHoist) {
        parent.insertBefore(child, el);
        sanitizeElement(child);
      }
      el.remove();
      return;
    }

    sanitizeAttributes(el, tagName);
    sanitizeNode(el);
  }

  function sanitizeAttributes(element, tagName) {
    const allowedGlobal = ALLOWED_ATTRS['*'] || [];
    const allowedForTag = ALLOWED_ATTRS[tagName] || [];
    const allAllowed = new Set([...allowedGlobal, ...allowedForTag]);
    const attrsSnapshot = Array.from(element.attributes);
    const attrsToRemove = [];

    for (const attr of attrsSnapshot) {
      const attrName = attr.name.toLowerCase();

      if (attrName.startsWith('on')) {
        attrsToRemove.push(attr.name);
        continue;
      }

      if (!allAllowed.has(attrName)) {
        attrsToRemove.push(attr.name);
        continue;
      }

      if (attrName === 'href') {
        const href = attr.value.trim().toLowerCase();
        if (href.startsWith('javascript:') || href.startsWith('data:') || href.startsWith('vbscript:')) {
          attrsToRemove.push(attr.name);
          continue;
        }
      }

      if (attrName === 'src') {
        const src = attr.value.trim().toLowerCase();
        if (src.startsWith('javascript:') || src.startsWith('data:') || src.startsWith('vbscript:')) {
          attrsToRemove.push(attr.name);
          continue;
        }
      }

      if (attrName === 'style') {
        element.setAttribute('style', sanitizeStyleString(attr.value));
      }
    }

    for (const attrName of attrsToRemove) {
      element.removeAttribute(attrName);
    }

    if (tagName === 'a' && element.hasAttribute('target')) {
      const rel = element.getAttribute('rel') || '';
      const relValues = rel.toLowerCase().split(/\s+/).filter(Boolean);
      if (!relValues.includes('noopener')) relValues.push('noopener');
      if (!relValues.includes('noreferrer')) relValues.push('noreferrer');
      element.setAttribute('rel', relValues.join(' '));
    }
  }

  function sanitizeStyleString(styleString) {
    if (!styleString || typeof styleString !== 'string') return '';

    const sanitizedParts = [];
    const declarations = styleString.split(';');

    for (const declaration of declarations) {
      const colonIndex = declaration.indexOf(':');
      if (colonIndex === -1) continue;

      const property = declaration.substring(0, colonIndex).trim().toLowerCase();
      const value = declaration.substring(colonIndex + 1).trim();

      if (!ALLOWED_STYLES.has(property)) continue;

      const lowerValue = value.toLowerCase();
      if (
        lowerValue.includes('url(') ||
        lowerValue.includes('expression(') ||
        lowerValue.includes('javascript:') ||
        lowerValue.includes('behavior:')
      ) {
        continue;
      }

      sanitizedParts.push(`${property}: ${value}`);
    }

    return sanitizedParts.join('; ');
  }

  function sanitizeStyleObject(styleObj) {
    if (!isPlainObject(styleObj)) return {};

    const sanitized = {};
    for (const [property, value] of Object.entries(styleObj)) {
      const kebabProperty = property.replace(/([A-Z])/g, '-$1').toLowerCase();
      if (!ALLOWED_STYLES.has(kebabProperty)) continue;

      if (typeof value === 'string') {
        const lowerValue = value.toLowerCase();
        if (
          lowerValue.includes('url(') ||
          lowerValue.includes('expression(') ||
          lowerValue.includes('javascript:') ||
          lowerValue.includes('behavior:')
        ) {
          continue;
        }
      }

      sanitized[property] = value;
    }

    return sanitized;
  }

  window.ScriptureValidators = {
    WIDGET_TYPES,
    VALID_ALIGNMENTS,
    PRESET_COLORS,
    isPlainObject,
    validateWidgetConfig,
    validateManifest,
    sanitizeHTML,
    sanitizeStyleObject,
    sanitizeStyleString,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.ScriptureValidators;
  }
})();
