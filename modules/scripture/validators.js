// modules/scripture/validators.js
//
// Validation and compatibility helpers for the Frontier Scripture module.
// These are intentionally pure-ish utilities so the module can reject malformed
// state without the renderer throwing during a Frontier dispatch tick.

(function () {
  if (window.ScriptureValidators) return;

  const WIDGET_TYPES = new Set([
    // --- existing display ---
    'stat',
    'bar',
    'text',
    'panel',
    'custom',
    'badge',
    'list',
    'icon',
    'counter',
    // --- existing interactive ---
    'button',
    'toggle',
    'select',
    'slider',
    'input',
    'textarea',
    // --- new display ---
    'progress',
    'taggroup',
    'divider',
    // --- new interactive ---
    'radio',
    'stepper',
    'confirm',
    'chipselect',
    // --- new container / action ---
    'accordion',
    'tabs',
    'dropdown',
    'sortable',
  ]);

  const VALID_ALIGNMENTS = new Set(['left', 'center', 'right']);
  const INTERACTIVE_WIDGET_TYPES = new Set([
    'button', 'toggle', 'select', 'slider', 'input', 'textarea',
    'radio', 'stepper', 'confirm', 'chipselect',
    'accordion', 'tabs', 'dropdown', 'sortable',
  ]);
  const INPUT_TYPES = new Set(['text', 'search', 'number']);
  const MAX_WIDGETS = 40;
  const MAX_WIDGET_ID_LENGTH = 64;
  const MAX_LABEL_LENGTH = 120;
  const MAX_TEXT_LENGTH = 512;
  const MAX_HTML_LENGTH = 20000;
  const MAX_PANEL_ITEMS = 30;
  const MAX_LIST_ITEMS = 40;
  const MAX_SELECT_OPTIONS = 40;
  const MAX_INPUT_LENGTH = 240;
  const MAX_TEXTAREA_LENGTH = 1200;

  const PRESET_COLORS = new Set([
    'red',
    'green',
    'blue',
    'yellow',
    'purple',
    'cyan',
    'orange',
  ]);

  const PRIMITIVE_STATE_FIELD_BY_TYPE = {
    text: 'text',
    badge: 'text',
    icon: 'icon',
  };

  const WIDGET_STATE_FIELDS = {
    stat: new Set(['value', 'color', 'style']),
    bar: new Set(['value', 'max', 'progress', 'color', 'style']),
    text: new Set(['text', 'color', 'style']),
    panel: new Set(['items', 'content', 'style']),
    custom: new Set(['html', 'color', 'style']),
    badge: new Set(['text', 'color', 'variant', 'style']),
    list: new Set(['items', 'style']),
    icon: new Set(['icon', 'text', 'color', 'size', 'style']),
    counter: new Set(['value', 'delta', 'color', 'icon', 'style']),
    button: new Set(['text', 'disabled', 'value', 'variant', 'style']),
    toggle: new Set(['value', 'disabled', 'style']),
    select: new Set(['value', 'disabled', 'style']),
    slider: new Set(['value', 'disabled', 'style']),
    input: new Set(['value', 'disabled', 'style']),
    textarea: new Set(['value', 'disabled', 'style']),
    // new display
    progress: new Set(['value', 'max', 'color', 'style']),
    taggroup: new Set(['items', 'style']),
    divider: new Set(['label', 'style']),
    // new interactive
    radio: new Set(['value', 'options', 'disabled', 'style']),
    stepper: new Set(['value', 'min', 'max', 'step', 'disabled', 'style']),
    confirm: new Set(['text', 'value', 'disabled', 'style']),
    chipselect: new Set(['value', 'options', 'disabled', 'style']),
    // new container / action
    accordion: new Set(['items', 'value', 'style']),
    tabs: new Set(['items', 'value', 'style']),
    dropdown: new Set(['items', 'value', 'disabled', 'style']),
    sortable: new Set(['items', 'value', 'disabled', 'style']),
  };

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
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

  function validateWidgetConfig(widgetId, config) {
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

    if (config.type === 'progress') {
      if (config.max !== undefined && (typeof config.max !== 'number' || config.max <= 0)) {
        errors.push('Progress widget "max" must be a positive number');
      }
      if (config.value !== undefined && typeof config.value !== 'number') {
        errors.push('Progress widget "value" must be a number');
      }
    }

    if (config.type === 'taggroup') {
      if (config.items !== undefined && !Array.isArray(config.items)) {
        errors.push('Taggroup widget "items" must be an array');
      } else if (Array.isArray(config.items) && config.items.length > MAX_LIST_ITEMS) {
        errors.push(`Taggroup widget "items" may contain at most ${MAX_LIST_ITEMS} entries`);
      }
    }

    if (config.type === 'radio' || config.type === 'chipselect') {
      if (!Array.isArray(config.options)) {
        errors.push(`${config.type} widget "options" must be an array`);
      } else if (config.options.length > MAX_SELECT_OPTIONS) {
        errors.push(`${config.type} widget "options" may contain at most ${MAX_SELECT_OPTIONS} entries`);
      } else {
        config.options.forEach((option, index) => validateOption(option, index, errors));
      }
    }

    if (config.type === 'stepper') {
      if (config.value !== undefined && typeof config.value !== 'number') {
        errors.push('Stepper widget "value" must be a number');
      }
      if (config.min !== undefined && typeof config.min !== 'number') {
        errors.push('Stepper widget "min" must be a number');
      }
      if (config.max !== undefined && typeof config.max !== 'number') {
        errors.push('Stepper widget "max" must be a number');
      }
      if (config.step !== undefined && (typeof config.step !== 'number' || config.step <= 0)) {
        errors.push('Stepper widget "step" must be a positive number');
      }
    }

    if (config.type === 'accordion' || config.type === 'tabs') {
      if (!Array.isArray(config.items)) {
        errors.push(`${config.type} widget "items" must be an array`);
      } else if (config.items.length > MAX_PANEL_ITEMS) {
        errors.push(`${config.type} widget "items" may contain at most ${MAX_PANEL_ITEMS} entries`);
      }
    }

    if (config.type === 'dropdown' || config.type === 'sortable') {
      if (!Array.isArray(config.items)) {
        errors.push(`${config.type} widget "items" must be an array`);
      } else if (config.items.length > MAX_SELECT_OPTIONS) {
        errors.push(`${config.type} widget "items" may contain at most ${MAX_SELECT_OPTIONS} entries`);
      }
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
    // Strip <script> tags and their contents
    html = html.replace(/<script[\s\S]*?>?[\s\S]*?<\/script>/gi, '');
    // Strip on* event handlers (e.g., onclick, onload)
    html = html.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');
    return html;
  }

  function sanitizeStyleString(styleString) {
    return typeof styleString === 'string' ? styleString : '';
  }

  function sanitizeStyleObject(styleObj) {
    return isPlainObject(styleObj) ? { ...styleObj } : {};
  }

  window.ScriptureValidators = {
    WIDGET_TYPES,
    VALID_ALIGNMENTS,
    INTERACTIVE_WIDGET_TYPES,
    MAX_INPUT_LENGTH,
    MAX_TEXTAREA_LENGTH,
    PRESET_COLORS,
    WIDGET_STATE_FIELDS,
    isPlainObject,
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
