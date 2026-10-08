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

  /**
   * Locates the label associated with an input element using ARIA, for/id, or Cloudscape wrappers.
   */
  function findAssociatedLabel(input) {
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
      } catch (e) {}
    }

    // 3. AWS Cloudscape / AWSUI FormField container wrapper
    const formField = input.closest(
      '[data-awsui-analytics*="FormField"], [class*="form-field"], [class*="FormField"], .awsui_root_14mhv_2g2j7_96'
    );
    if (formField) {
      const labelInField = formField.querySelector('label, [class*="label"]');
      if (labelInField) return labelInField;
    }

    // 4. Input wrapped in label
    return input.closest('label');
  }

  /**
   * Retrieves the heading of the parent dialog, modal, container, or form.
   */
  function findContainerHeading(input) {
    const container = input.closest(
      '[role="dialog"], [data-awsui-analytics*="Modal"], [data-awsui-analytics*="Container"], [data-analytics-funnel-step], [class*="modal"], [class*="dialog"], form'
    );
    if (!container) return '';

    const headingEl = container.querySelector(
      'h1, h2, h3, h4, [class*="heading"], [class*="title"], [data-analytics-funnel-key="substep-name"]'
    );
    return headingEl ? (headingEl.textContent || '').trim() : '';
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

    // If input already has a value (e.g. user typed something), leave it alone
    if (input.value && input.value.trim().length > 0) {
      return null;
    }

    const placeholder = (input.getAttribute('placeholder') || '').trim();
    const labelEl = findAssociatedLabel(input);
    const labelText = labelEl?.textContent?.trim() ?? '';
    const ariaLabel = (input.getAttribute('aria-label') || '').trim();
    const headingText = findContainerHeading(input);

    const fullContext = `${labelText} ${ariaLabel} ${headingText}`;

    // Validate that this is indeed an AWS confirmation prompt
    const isConfirmContext = CONFIRM_KEYWORD_REGEX.test(fullContext) || (/\bconfirm\b/i.test(fullContext) && DESTRUCTIVE_KEYWORD_REGEX.test(fullContext));

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
        if (!/^(?:the|a|an|the name of|name|identifier)$/i.test(phrase)) {
          extracted = phrase;
        }
      }
    }

    // Strategy 4: Quoted resource name in heading (e.g. Delete bucket "my-bucket"?)
    if (!extracted && headingText) {
      const quotedHeading = headingText.match(/["'“‘`]([^"'”’`]+)["'”’`]/);
      if (quotedHeading && quotedHeading[1].trim()) {
        extracted = quotedHeading[1].trim();
      }
    }

    // Strategy 5: Cloudscape placeholder cross-check and fallback
    // In AWS Cloudscape, the placeholder often contains the exact target string
    if (placeholder) {
      // If extracted matches placeholder, high-confidence match
      if (extracted && extracted.toLowerCase() === placeholder.toLowerCase()) {
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
          mutation.attributeName === 'id')
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
    attributeFilter: ['placeholder', 'aria-labelledby', 'id'],
  });
})();
