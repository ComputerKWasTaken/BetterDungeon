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
    'button',
    'toggle',
    'select',
    'slider',
    'input',
    'textarea',
  ]);

  const VALID_ALIGNMENTS = new Set(['left', 'center', 'right']);
  const INTERACTIVE_WIDGET_TYPES = new Set(['button', 'toggle', 'select', 'slider', 'input', 'textarea']);
  const RISK_LEVELS = ['safe', 'enhanced', 'unsafe'];
  const RISK_LEVEL_ORDER = {
    safe: 0,
    enhanced: 1,
    unsafe: 2,
  };
  const DEFAULT_RISK_LEVEL = 'enhanced';
  const INPUT_TYPES = new Set(['text', 'search', 'number']);
  const MAX_WIDGETS = 40;
  const MAX_WIDGET_ID_LENGTH = 64;
  const MAX_LABEL_LENGTH = 120;
  const MAX_TEXT_LENGTH = 512;
  const MAX_HTML_LENGTH = 4000;
  const MAX_PANEL_ITEMS = 30;
  const MAX_LIST_ITEMS = 40;
  const MAX_SELECT_OPTIONS = 40;
  const MAX_INPUT_LENGTH = 240;
  const MAX_TEXTAREA_LENGTH = 1200;
  const MAX_STYLE_PROPERTIES = 16;

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
  ]);

  const PRIMITIVE_STATE_FIELD_BY_TYPE = {
    text: 'text',
    badge: 'text',
    icon: 'icon',
  };

  const WIDGET_STATE_FIELDS = {
    stat: new Set(['value', 'color']),
    bar: new Set(['value', 'max', 'progress', 'color']),
    text: new Set(['text', 'color']),
    panel: new Set(['items', 'content']),
    custom: new Set(['html', 'color']),
    badge: new Set(['text', 'color', 'variant']),
    list: new Set(['items']),
    icon: new Set(['icon', 'text', 'color', 'size']),
    counter: new Set(['value', 'delta', 'color', 'icon']),
    button: new Set(['text', 'disabled', 'value', 'variant']),
    toggle: new Set(['value', 'disabled']),
    select: new Set(['value', 'disabled']),
    slider: new Set(['value', 'disabled']),
    input: new Set(['value', 'disabled']),
    textarea: new Set(['value', 'disabled']),
  };

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizeRiskLevel(level, fallback = DEFAULT_RISK_LEVEL) {
    const normalized = String(level || '').toLowerCase();
    return RISK_LEVEL_ORDER[normalized] !== undefined ? normalized : fallback;
  }

  function compareRiskLevels(a, b) {
    return RISK_LEVEL_ORDER[normalizeRiskLevel(a)] - RISK_LEVEL_ORDER[normalizeRiskLevel(b)];
  }

  function highestRiskLevel(...levels) {
    let highest = 'safe';
    for (const level of levels) {
      const normalized = normalizeRiskLevel(level, 'safe');
      if (compareRiskLevels(normalized, highest) > 0) highest = normalized;
    }
    return highest;
  }

  function getWidgetRiskLevel(config) {
    const declaredRisk = config?.risk !== undefined
      ? normalizeRiskLevel(config.risk)
      : (INTERACTIVE_WIDGET_TYPES.has(config?.type) ? 'enhanced' : 'safe');
    const htmlRisk = config?.type === 'custom' || config?.html !== undefined ? 'unsafe' : 'safe';
    const styleRisk = config?.style !== undefined ? 'unsafe' : 'safe';
    return highestRiskLevel(declaredRisk, htmlRisk, styleRisk);
  }

  function stringOrNumberOrBoolean(value) {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  }

  function validateStringField(config, field, maxLength, errors, label = field) {
    if (config[field] === undefined) return;
    if (typeof config[field] !== 'string') {
      errors.push(`Widget "${label}" must be a string`);
    } else if (config[field].length > maxLength) {
      errors.push(`Widget "${label}" must be ${maxLength} characters or fewer`);
    }
  }

  function validateSelectPrimitive(value, label, errors, maxStringLength = MAX_TEXT_LENGTH) {
    if (!stringOrNumberOrBoolean(value)) {
      errors.push(`${label} must be a string, number, or boolean`);
    } else if (typeof value === 'string' && value.length > maxStringLength) {
      errors.push(`${label} must be ${maxStringLength} characters or fewer`);
    }
  }

  function validateStyleObject(style, errors) {
    if (style === undefined) return;
    if (!isPlainObject(style)) {
      errors.push('Widget "style" must be an object');
      return;
    }
    if (Object.keys(style).length > MAX_STYLE_PROPERTIES) {
      errors.push(`Widget "style" may contain at most ${MAX_STYLE_PROPERTIES} properties`);
    }
  }

  function filterWidgetStatePatch(config, patch) {
    const allowed = WIDGET_STATE_FIELDS[config?.type] || new Set(['value']);
    const filtered = {};
    if (!isPlainObject(patch)) return filtered;
    for (const [key, value] of Object.entries(patch)) {
      if (allowed.has(key)) filtered[key] = value;
    }
    return filtered;
  }

  function getPrimitiveStateField(config) {
    return PRIMITIVE_STATE_FIELD_BY_TYPE[config?.type] || 'value';
  }

  function validateOption(option, index, errors) {
    if (typeof option === 'string' || typeof option === 'number' || typeof option === 'boolean') {
      validateSelectPrimitive(option, `Select option at index ${index}`, errors, MAX_LABEL_LENGTH);
      return;
    }
    if (!isPlainObject(option)) {
      errors.push(`Select option at index ${index} must be a primitive or object`);
      return;
    }
    validateSelectPrimitive(option.value, `Select option at index ${index} value`, errors);
    if (option.label !== undefined && typeof option.label !== 'string') {
      errors.push(`Select option at index ${index} label must be a string`);
    } else if (typeof option.label === 'string' && option.label.length > MAX_LABEL_LENGTH) {
      errors.push(`Select option at index ${index} label must be ${MAX_LABEL_LENGTH} characters or fewer`);
    }
  }

  function validateWidgetConfig(widgetId, config, opts = {}) {
    const errors = [];

    if (!widgetId || typeof widgetId !== 'string') {
      errors.push('Widget ID must be a non-empty string');
    } else if (widgetId.length > MAX_WIDGET_ID_LENGTH) {
      errors.push(`Widget ID must be ${MAX_WIDGET_ID_LENGTH} characters or fewer`);
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

    validateStringField(config, 'label', MAX_LABEL_LENGTH, errors, 'label');
    validateStringField(config, 'text', MAX_TEXT_LENGTH, errors, 'text');
    validateStringField(config, 'title', MAX_LABEL_LENGTH, errors, 'title');
    validateStringField(config, 'tooltip', MAX_TEXT_LENGTH, errors, 'tooltip');
    validateStringField(config, 'placeholder', MAX_LABEL_LENGTH, errors, 'placeholder');
    validateStyleObject(config.style, errors);

    const riskLevel = getWidgetRiskLevel(config);
    const allowedRiskLevel = normalizeRiskLevel(opts.allowedRiskLevel);
    if (config.risk !== undefined && RISK_LEVEL_ORDER[String(config.risk).toLowerCase()] === undefined) {
      errors.push(`Widget risk must be one of: ${RISK_LEVELS.join(', ')}`);
    }
    if (compareRiskLevels(riskLevel, allowedRiskLevel) > 0) {
      errors.push(`Widget requires "${riskLevel}" risk but current Scripture risk is "${allowedRiskLevel}"`);
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
    } else if (config.type === 'panel' && Array.isArray(config.items) && config.items.length > MAX_PANEL_ITEMS) {
      errors.push(`Panel widget "items" may contain at most ${MAX_PANEL_ITEMS} entries`);
    }

    if (config.type === 'list' && config.items !== undefined && !Array.isArray(config.items)) {
      errors.push('List widget "items" must be an array');
    } else if (config.type === 'list' && Array.isArray(config.items) && config.items.length > MAX_LIST_ITEMS) {
      errors.push(`List widget "items" may contain at most ${MAX_LIST_ITEMS} entries`);
    }

    if (config.type === 'custom' && config.html !== undefined && typeof config.html !== 'string') {
      errors.push('Custom widget "html" must be a string');
    } else if (config.type === 'custom' && typeof config.html === 'string' && config.html.length > MAX_HTML_LENGTH) {
      errors.push(`Custom widget "html" must be ${MAX_HTML_LENGTH} characters or fewer`);
    }

    if (config.type === 'button') {
      if (config.label !== undefined && typeof config.label !== 'string') {
        errors.push('Button widget "label" must be a string');
      }
      if (config.text !== undefined && typeof config.text !== 'string') {
        errors.push('Button widget "text" must be a string');
      } else if (typeof config.text === 'string' && config.text.length > MAX_LABEL_LENGTH) {
        errors.push(`Button widget "text" must be ${MAX_LABEL_LENGTH} characters or fewer`);
      }
    }

    if (config.type === 'toggle' && config.value !== undefined && typeof config.value !== 'boolean') {
      errors.push('Toggle widget "value" must be a boolean');
    }

    if (config.type === 'select') {
      if (!Array.isArray(config.options)) {
        errors.push('Select widget "options" must be an array');
      } else if (config.options.length > MAX_SELECT_OPTIONS) {
        errors.push(`Select widget "options" may contain at most ${MAX_SELECT_OPTIONS} entries`);
      } else {
        config.options.forEach((option, index) => validateOption(option, index, errors));
      }
      if (config.value !== undefined) {
        validateSelectPrimitive(config.value, 'Select widget "value"', errors);
      }
    }

    if (config.type === 'slider') {
      if (config.value !== undefined && typeof config.value !== 'number') {
        errors.push('Slider widget "value" must be a number');
      }
      if (config.min !== undefined && typeof config.min !== 'number') {
        errors.push('Slider widget "min" must be a number');
      }
      if (config.max !== undefined && typeof config.max !== 'number') {
        errors.push('Slider widget "max" must be a number');
      }
      if (config.step !== undefined && (typeof config.step !== 'number' || config.step <= 0)) {
        errors.push('Slider widget "step" must be a positive number');
      }
      if (
        typeof config.min === 'number' &&
        typeof config.max === 'number' &&
        config.max <= config.min
      ) {
        errors.push('Slider widget "max" must be greater than "min"');
      }
    }

    if (config.type === 'input') {
      if (config.value !== undefined && typeof config.value !== 'string' && typeof config.value !== 'number') {
        errors.push('Input widget "value" must be a string or number');
      }
      if (config.inputType !== undefined && !INPUT_TYPES.has(config.inputType)) {
        errors.push(`Input widget "inputType" must be one of: ${[...INPUT_TYPES].join(', ')}`);
      }
      if (config.maxLength !== undefined && (!Number.isInteger(config.maxLength) || config.maxLength <= 0)) {
        errors.push('Input widget "maxLength" must be a positive integer');
      } else if (config.maxLength !== undefined && config.maxLength > MAX_INPUT_LENGTH) {
        errors.push(`Input widget "maxLength" must be ${MAX_INPUT_LENGTH} or less`);
      }
    }

    if (config.type === 'textarea') {
      if (config.value !== undefined && typeof config.value !== 'string') {
        errors.push('Textarea widget "value" must be a string');
      }
      if (config.maxLength !== undefined && (!Number.isInteger(config.maxLength) || config.maxLength <= 0)) {
        errors.push('Textarea widget "maxLength" must be a positive integer');
      } else if (config.maxLength !== undefined && config.maxLength > MAX_TEXTAREA_LENGTH) {
        errors.push(`Textarea widget "maxLength" must be ${MAX_TEXTAREA_LENGTH} or less`);
      }
      if (config.rows !== undefined && (!Number.isInteger(config.rows) || config.rows <= 0 || config.rows > 8)) {
        errors.push('Textarea widget "rows" must be an integer from 1 to 8');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  function validateManifest(manifest, opts = {}) {
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

    if (manifest.widgets.length > MAX_WIDGETS) {
      errors.push(`Manifest widgets may contain at most ${MAX_WIDGETS} widgets`);
    }

    const widgetsToValidate = manifest.widgets.slice(0, MAX_WIDGETS);
    for (let i = 0; i < widgetsToValidate.length; i++) {
      const widget = widgetsToValidate[i];
      if (!isPlainObject(widget)) {
        errors.push(`Widget at index ${i} must be an object`);
        continue;
      }

      const validation = validateWidgetConfig(widget.id, widget, opts);
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
    INTERACTIVE_WIDGET_TYPES,
    RISK_LEVELS,
    DEFAULT_RISK_LEVEL,
    MAX_INPUT_LENGTH,
    MAX_TEXTAREA_LENGTH,
    PRESET_COLORS,
    WIDGET_STATE_FIELDS,
    isPlainObject,
    normalizeRiskLevel,
    compareRiskLevels,
    getWidgetRiskLevel,
    filterWidgetStatePatch,
    getPrimitiveStateField,
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
