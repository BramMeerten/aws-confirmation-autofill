(() => {
  // Prevent duplicate execution if injected multiple times
  if (window.__awsConfirmationAutofillLoaded) return;
  window.__awsConfirmationAutofillLoaded = true;

  // Track processed inputs to avoid redundant operations and respect user manual edits
  const processedInputs = new WeakSet();

  // Keywords that identify a confirmation context
  const CONFIRM_KEYWORD_REGEX = /(?:to confirm|confirm (?:deletion|action|this action)|type .* to confirm|enter .* to confirm)/i;
  const DESTRUCTIVE_KEYWORD_REGEX = /\b(?:delete|deletion|permanently delete|terminate|empty bucket|destroy|remove)\b/i;

  // Generic placeholder texts that should not be used as raw values
  const GENERIC_PLACEHOLDER_REGEX = /^(?:enter|type|search|filter|select|optional|e\.?g\.|find)\b/i;

  // Common AWS resource nouns that should not be mistaken for literal names in unquoted headings
  const GENERIC_RESOURCE_TYPES = new Set([
    'bucket', 'role', 'stack', 'table', 'database', 'cluster', 'instance',
    'function', 'distribution', 'policy', 'group', 'user', 'queue', 'topic',
    'repository', 'volume', 'snapshot', 'secret', 'certificate', 'key',
    'resource', 'items', 'objects', 'identity', 'profile'
  ]);

  /**
   * Locates the dialog, modal, container card, or form wrapping the confirmation input.
   */
  function findConfirmationContainer(input) {
    return input.closest(
      '[role="dialog"], [role="alertdialog"], [data-awsui-analytics*="Modal" i], [data-awsui-analytics*="Container" i], [data-awsui-analytics*="Form" i], [data-analytics-funnel-step], [class*="modal" i], [class*="dialog" i], [class*="awsui_container_"], [class*="container_"], [class*="container" i], form'
    );
  }

  /**
   * Locates the label or prompt associated with an input element using ARIA, for/id,
   * Cloudscape FormField wrapper, or preceding sibling layout containers.
   */
  function findAssociatedLabel(input, container) {
    const root = input.ownerDocument || document;

    // 1. Explicit aria-labelledby
    const ariaLabelledBy = input.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const ids = ariaLabelledBy.trim().split(/\s+/);
      for (const id of ids) {
        const el = root.getElementById(id);
        if (el) return el;
      }
    }

    // 2. Standard label[for="input.id"]
    if (input.id) {
      try {
        const labelFor = root.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (labelFor) return labelFor;
      } catch (e) {
        const labelFor = root.querySelector(`label[for="${input.id}"]`);
        if (labelFor) return labelFor;
      }
    }

    // 3. Explicit aria-describedby
    const ariaDescribedBy = input.getAttribute('aria-describedby');
    if (ariaDescribedBy) {
      const ids = ariaDescribedBy.trim().split(/\s+/);
      for (const id of ids) {
        const el = root.getElementById(id);
        if (el) return el;
      }
    }

    // 4. AWS Cloudscape / AWSUI FormField container wrapper
    const formField = input.closest(
      '[data-awsui-analytics*="FormField"], [class*="form-field"], [class*="FormField"], .awsui_root_14mhv_2g2j7_96'
    );
    if (formField) {
      const labelInField = formField.querySelector('label, [class*="label"]');
      if (labelInField) return labelInField;
    }

    // 5. Input wrapped in label
    const wrappedLabel = input.closest('label');
    if (wrappedLabel) return wrappedLabel;

    // 6. Preceding sibling or layout sibling prompt (e.g. Cloudscape SpaceBetween without FormField)
    // First pass: look for a preceding sibling that contains confirmation keywords
    let curr = input;
    let depth = 0;
    while (curr && curr !== container && depth < 5) {
      if (curr.previousElementSibling) {
        const prev = curr.previousElementSibling;
        if (!prev.querySelector('input, select, textarea')) {
          const text = (prev.textContent || '').trim();
          if (text && CONFIRM_KEYWORD_REGEX.test(text)) {
            return prev;
          }
        }
      }
      curr = curr.parentElement;
      depth++;
    }

    // Second pass: look for immediate preceding sibling with short label-like text
    curr = input;
    depth = 0;
    while (curr && curr !== container && depth < 3) {
      if (curr.previousElementSibling) {
        const prev = curr.previousElementSibling;
        if (!prev.querySelector('input, select, textarea')) {
          const text = (prev.textContent || '').trim();
          if (text && text.length < 200) {
            return prev;
          }
        }
      }
      curr = curr.parentElement;
      depth++;
    }

    // 7. Prompt text inside confirmation container
    if (container) {
      const promptCandidates = container.querySelectorAll('[class*="box"], [class*="child"], p, span, div');
      for (const cand of promptCandidates) {
        if (cand.children.length <= 2 && !cand.querySelector('input, select, textarea')) {
          const text = (cand.textContent || '').trim();
          if (CONFIRM_KEYWORD_REGEX.test(text)) {
            return cand;
          }
        }
      }
    }

    return null;
  }

  /**
   * Retrieves the heading of the parent dialog, modal, container, or form.
   */
  function findContainerHeading(input, container) {
    const searchRoot = container || findConfirmationContainer(input);
    if (!searchRoot) return '';

    const headingEl = searchRoot.querySelector(
      'h1, h2, h3, h4, [class*="heading"], [class*="title"], [data-analytics-funnel-key="substep-name"], [class*="awsui_header--text_"], [class*="header--text"]'
    );
    return headingEl ? (headingEl.textContent || '').trim() : '';
  }

  /**
   * Extracts a potential resource name target from a container or modal heading.
   */
  function extractFromHeading(headingText) {
    if (!headingText) return null;

    // 1. Quoted string in heading (e.g. Delete bucket "my-bucket"?)
    const quoted = headingText.match(/["'“‘`]([^"'”’`]+)["'”’`]/);
    if (quoted && quoted[1].trim()) {
      return quoted[1].trim();
    }

    // 2. Unquoted resource name in heading (e.g. Delete AwsLakehouseOutputPort-test?)
    const match = headingText.trim().match(
      /^(?:delete|permanently delete|terminate|empty|destroy|remove)\s+(?:.+?\s+)?([a-zA-Z0-9_\-\.\/]+)\??$/i
    );
    if (match && match[1]) {
      const candidate = match[1].trim();
      if (!GENERIC_RESOURCE_TYPES.has(candidate.toLowerCase())) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Determine if input is a confirmation field and extracts the required confirmation string.
   */
  function extractConfirmationTarget(input) {
    if (input?.tagName !== 'INPUT') {
      return null;
    }

    // Must be standard text input
    const type = (input.getAttribute('type') || 'text').toLowerCase();
    if (type !== 'text' || input.disabled || input.readOnly) {
      return null;
    }

    // Exclude search or table filter inputs
    if (
      input.closest(
        '[class*="search" i], [class*="filter" i], [data-awsui-analytics*="Search" i], [data-awsui-analytics*="TextFilter" i]'
      )
    ) {
      return null;
    }

    // If input already has a value (e.g. user typed something), leave it alone
    if (input.value && input.value.trim().length > 0) {
      return null;
    }

    const placeholder = (input.getAttribute('placeholder') || '').trim();
    const container = findConfirmationContainer(input);
    const labelEl = findAssociatedLabel(input, container);
    const labelText = labelEl?.textContent?.trim() ?? '';
    const ariaLabel = (input.getAttribute('aria-label') || '').trim();
    const headingText = findContainerHeading(input, container);
    const containerText = container?.textContent?.trim() ?? '';

    const inputTestId =
      input.getAttribute('data-testid') ||
      input.closest('[data-testid]')?.getAttribute('data-testid') ||
      '';

    const fullContext = `${labelText} ${ariaLabel} ${headingText} ${inputTestId}`;

    // Validate that this is indeed an AWS confirmation prompt
    const hasConfirmKeyword =
      CONFIRM_KEYWORD_REGEX.test(fullContext) ||
      CONFIRM_KEYWORD_REGEX.test(containerText) ||
      /confirm/i.test(inputTestId);

    const hasDestructiveContext =
      DESTRUCTIVE_KEYWORD_REGEX.test(fullContext) ||
      DESTRUCTIVE_KEYWORD_REGEX.test(containerText);

    const isConfirmContext =
      (hasConfirmKeyword && hasDestructiveContext) ||
      CONFIRM_KEYWORD_REGEX.test(fullContext) ||
      /confirm.*delete|delete.*confirm/i.test(inputTestId);

    if (!isConfirmContext) {
      return null;
    }

    let extracted = null;

    // Strategy 1: Styled emphasis in label (AWS standard: <em>permanently delete</em> or <code>delete</code>)
    if (labelEl) {
      const styledTag = labelEl.querySelector('em, code, strong, b, mark');
      if (styledTag && styledTag.textContent) {
        const text = styledTag.textContent.trim();
        if (text) extracted = text;
      }
    }

    // Strategy 1b: Styled emphasis in container warning box if not found in label
    if (!extracted && container) {
      const styledTags = container.querySelectorAll('em, code, strong, b, mark');
      for (const tag of styledTags) {
        const text = tag.textContent.trim();
        if (text && !GENERIC_RESOURCE_TYPES.has(text.toLowerCase())) {
          if (placeholder && text.toLowerCase() === placeholder.toLowerCase()) {
            extracted = text;
            break;
          }
          if (headingText && headingText.toLowerCase().includes(text.toLowerCase())) {
            extracted = text;
            break;
          }
        }
      }
    }

    // Strategy 2: Quoted phrase in label text (e.g. type "delete")
    if (!extracted && labelText) {
      const quoted = labelText.match(/["'“‘`]([^"'”’`]+)["'”’`]/);
      if (quoted && quoted[1].trim()) {
        extracted = quoted[1].trim();
      }
    }

    // Strategy 3: Regex match "type/enter <phrase> in/into/to/below"
    if (!extracted && labelText) {
      const typeMatch = labelText.match(
        /(?:type|enter)\s+["'“‘`]?([a-zA-Z0-9_\-\.\/ ]+?)["'”’`]?\s+(?:in|into|below|to confirm)\b/i
      );
      if (typeMatch && typeMatch[1].trim()) {
        const phrase = typeMatch[1].trim();
        const isGenericDescription =
          /^(?:the\s+|a\s+|an\s+)?(?:name|role(?:\s+name)?|bucket(?:\s+name)?|table(?:\s+name)?|database(?:\s+name)?|cluster(?:\s+name)?|instance(?:\s+name)?|resource(?:\s+name)?|identifier|id|arn)\b/i.test(phrase) ||
          /^(?:the\s+)?name\s+of\b/i.test(phrase) ||
          /^(?:the|a|an)$/i.test(phrase);

        if (!isGenericDescription) {
          extracted = phrase;
        }
      }
    }

    // Strategy 4: Quoted or unquoted resource name in heading (e.g. Delete bucket "my-bucket"? or Delete my-role?)
    if (!extracted && headingText) {
      extracted = extractFromHeading(headingText);
    }

    // Strategy 5: Cloudscape placeholder cross-check and fallback
    if (placeholder) {
      // If extracted matches placeholder, high-confidence match
      if (extracted && extracted.toLowerCase() === placeholder.toLowerCase()) {
        return placeholder;
      }

      // If placeholder matches resource in heading or container styled text
      if (headingText && headingText.toLowerCase().includes(placeholder.toLowerCase())) {
        return placeholder;
      }

      // If extracted was not found or slightly different, verify placeholder is non-generic
      if (!GENERIC_PLACEHOLDER_REGEX.test(placeholder)) {
        return placeholder;
      }
    }

    return extracted;
  }

  /**
   * Safely populates an input and triggers React / Cloudscape synthetic events
   * so the confirmation action button (e.g. "Delete bucket") becomes active.
   */
  function fillInputValue(input, targetValue) {
    const win = input.ownerDocument.defaultView || window;

    try {
      input.focus();
    } catch (e) {}

    // In React 16+, setting input.value directly doesn't trigger component onChange
    // because React overrides the property setter on HTMLInputElement.prototype.
    // Calling the native prototype setter directly bypasses React's wrapper.
    const nativeSetter =
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set ||
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;

    if (nativeSetter) {
      nativeSetter.call(input, targetValue);
    } else {
      input.value = targetValue;
    }

    // On Firefox, if page-level React tracker is accessible through Xray unwrapping
    try {
      const unwrapped = input.wrappedJSObject || input;
      if (unwrapped._valueTracker) {
        unwrapped._valueTracker.setValue('');
      }
    } catch (e) {}

    // Dispatch input and change events so React's root listener captures the update
    const eventInit = { bubbles: true, cancelable: true, composed: true };

    try {
      input.dispatchEvent(
        new win.InputEvent('input', {
          ...eventInit,
          inputType: 'insertText',
          data: targetValue,
        })
      );
    } catch (e) {
      input.dispatchEvent(new win.Event('input', eventInit));
    }

    input.dispatchEvent(new win.Event('change', eventInit));

    // Mark as processed
    input.dataset.awsAutofilled = 'true';
    processedInputs.add(input);
    input.classList.add('aws-confirmation-autofilled');
    input.setAttribute('title', `Autofilled confirmation: "${targetValue}"`);

    console.info(`[AWS Confirmation Autofill] Filled confirmation input with: "${targetValue}"`);
  }

  /**
   * Inspects a specific input and autofills it if appropriate.
   */
  function processInput(input) {
    if (processedInputs.has(input) || input.dataset.awsAutofilled === 'true') {
      return;
    }

    const targetValue = extractConfirmationTarget(input);
    if (targetValue) {
      fillInputValue(input, targetValue);
    }
  }

  /**
   * Scans document for eligible confirmation inputs.
   */
  function scanInputs() {
    const inputs = document.querySelectorAll('input:not([data-aws-autofilled="true"])');
    for (const input of inputs) {
      processInput(input);
    }
  }

  // Debounced scan scheduler to optimize performance during dynamic DOM updates
  let scheduled = false;
  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scanInputs();
    });
  }

  // Initial scan
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanInputs, { once: true });
  } else {
    scanInputs();
  }

  // Observe DOM for newly rendered modals or dynamic Cloudscape components
  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        shouldScan = true;
        break;
      }
      if (
        mutation.type === 'attributes' &&
        (mutation.attributeName === 'placeholder' ||
          mutation.attributeName === 'aria-labelledby' ||
          mutation.attributeName === 'id' ||
          mutation.attributeName === 'disabled')
      ) {
        shouldScan = true;
        break;
      }
    }

    if (shouldScan) {
      scheduleScan();
    }
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['placeholder', 'aria-labelledby', 'id', 'disabled'],
  });
})();
