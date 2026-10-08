const fs = require('fs');

// We simulate the DOM elements structure for testing detection logic
class MockElement {
  constructor(tag, attrs = {}, textContent = '') {
    this.tagName = tag.toUpperCase();
    this.attrs = attrs;
    this.textContent = textContent;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.value = attrs.value || '';
    this.id = attrs.id || '';
  }

  getAttribute(name) {
    return this.attrs[name] || null;
  }

  setAttribute(name, val) {
    this.attrs[name] = val;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (curr.matches(selector)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  matches(selector) {
    // simplified matching for test
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return (this.attrs.class || '').includes(selector.slice(1));
    if (selector.includes('[')) {
      const match = selector.match(/\[([a-zA-Z0-9_\-]+)(?:([*~^$]?=)"?([^"\]]*)"?)?\]/);
      if (match) {
        const [, attr, op, val] = match;
        const actual = this.attrs[attr];
        if (!actual) return false;
        if (!op) return true;
        if (op === '=') return actual === val;
        if (op === '*=') return actual.includes(val);
      }
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelector(selector) {
    const list = this.querySelectorAll(selector);
    return list.length > 0 ? list[0] : null;
  }

  querySelectorAll(selector) {
    const results = [];
    function walk(node) {
      for (const ch of node.children) {
        if (ch.matches(selector)) results.push(ch);
        walk(ch);
      }
    }
    walk(this);
    return results;
  }
}

// Our detection logic to be used in content.js
function detectConfirmationTarget(input, rootDoc) {
  if (!input || input.tagName !== 'INPUT') return null;

  const type = (input.getAttribute('type') || 'text').toLowerCase();
  if (type !== 'text' && type !== '') return null;
  if (input.getAttribute('readonly') !== null || input.getAttribute('disabled') !== null) return null;
  if (input.value && input.value.trim().length > 0) return null;

  const placeholder = (input.getAttribute('placeholder') || '').trim();

  // 1. Find associated label
  let labelElement = null;
  const ariaLabelledBy = input.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    const ids = ariaLabelledBy.split(/\s+/);
    for (const id of ids) {
      const el = rootDoc.getElementById ? rootDoc.getElementById(id) : rootDoc.querySelector('#' + id);
      if (el) {
        labelElement = el;
        break;
      }
    }
  }

  if (!labelElement && input.id) {
    labelElement = rootDoc.querySelector ? rootDoc.querySelector(`label[for="${input.id}"]`) : null;
  }

  if (!labelElement) {
    const formField = input.closest('[data-awsui-analytics*="FormField"], .awsui_root_14mhv_2g2j7_96, [class*="form-field"], [class*="FormField"]');
    if (formField) {
      labelElement = formField.querySelector('label');
    }
  }

  if (!labelElement) {
    labelElement = input.closest('label');
  }

  // 2. Find container or modal heading
  const container = input.closest('[role="dialog"], [data-awsui-analytics*="Modal"], [data-awsui-analytics*="Container"], [class*="modal"], [class*="dialog"], form');
  let headingText = '';
  if (container) {
    const headingEl = container.querySelector('h1, h2, h3, h4, [class*="header"], [class*="heading"]');
    if (headingEl) {
      headingText = (headingEl.textContent || '').trim();
    }
  }

  const labelText = labelElement ? (labelElement.textContent || '').trim() : '';
  const ariaLabel = (input.getAttribute('aria-label') || '').trim();
  const fullContextText = `${labelText} ${ariaLabel} ${headingText}`;

  // 3. Verification: Is this a confirmation field?
  const isConfirmContext =
    /(?:to confirm|confirm (?:deletion|action|this action)|type .* to confirm|enter .* to confirm)/i.test(fullContextText) ||
    (/\bconfirm\b/i.test(fullContextText) && /\b(?:delete|deletion|permanently delete|terminate|empty bucket|destroy)\b/i.test(fullContextText));

  if (!isConfirmContext) {
    return null;
  }

  // 4. Extract expected text candidates
  let extracted = null;

  // Candidate A: Styled emphasis in label (e.g. <em>permanently delete</em> or <code>delete</code>)
  if (labelElement) {
    const emTag = labelElement.querySelector('em, code, strong, b, mark');
    if (emTag && emTag.textContent) {
      const emText = emTag.textContent.trim();
      if (emText) extracted = emText;
    }
  }

  // Candidate B: Quoted string in label text
  if (!extracted && labelText) {
    const quotedInLabel = labelText.match(/["'“]([^"'”]+)["'”]/);
    if (quotedInLabel && quotedInLabel[1].trim()) {
      extracted = quotedInLabel[1].trim();
    }
  }

  // Candidate C: Explicit "type <word(s)> in/into/to/below" in label
  if (!extracted && labelText) {
    const typeMatch = labelText.match(/(?:type|enter)\s+([a-zA-Z0-9_\-\.\/ ]+?)\s+(?:in|into|below|to confirm)\b/i);
    if (typeMatch && typeMatch[1].trim()) {
      const word = typeMatch[1].trim();
      if (!/^(?:the|a|an|name|identifier)$/i.test(word)) {
        extracted = word;
      }
    }
  }

  // Candidate D: Quoted string in container heading (e.g. Delete bucket "my-bucket"?)
  if (!extracted && headingText) {
    const quotedInHeading = headingText.match(/["'“]([^"'”]+)["'”]/);
    if (quotedInHeading && quotedInHeading[1].trim()) {
      extracted = quotedInHeading[1].trim();
    }
  }

  // Candidate E: Placeholder attribute
  // In AWS Cloudscape, the placeholder often contains the exact target string
  if (placeholder) {
    // If we have an extracted candidate that matches placeholder
    if (extracted && extracted.toLowerCase() === placeholder.toLowerCase()) {
      return placeholder; // exact match
    }

    // Check if placeholder is generic instructions
    const isGeneric = /^(?:enter|type|search|filter|select|optional|e\.?g\.)\b/i.test(placeholder);
    if (!isGeneric) {
      // Placeholder is a specific value (e.g. "permanently delete", "delete", "temp-612069931970-eu-west-1-an")
      return placeholder;
    }
  }

  return extracted;
}

// Parse HTML file into mock DOM
function parseHtmlFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const root = new MockElement('div');
  root.getElementById = function(id) {
    return this.querySelector('#' + id);
  };

  // Extract heading
  const hMatch = content.match(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/i);
  let headingEl = null;
  if (hMatch) {
    const hText = hMatch[2].replace(/<[^>]+>/g, '').trim();
    headingEl = new MockElement('h' + hMatch[1], {}, hText);
    root.appendChild(headingEl);
  }

  // Extract label
  const lMatch = content.match(/<label\s+([^>]*)>([\s\S]*?)<\/label>/i);
  let labelEl = null;
  if (lMatch) {
    const lAttrsStr = lMatch[1];
    const lAttrs = {};
    for (const m of lAttrsStr.matchAll(/([a-zA-Z0-9_\-]+)="([^"]*)"/g)) {
      lAttrs[m[1]] = m[2];
    }
    const innerHtml = lMatch[2];
    labelEl = new MockElement('label', lAttrs, innerHtml.replace(/<[^>]+>/g, '').trim());
    
    // Check for em/code/strong tags
    const emMatch = innerHtml.match(/<(em|code|strong|b)>([\s\S]*?)<\/\1>/i);
    if (emMatch) {
      const em = new MockElement(emMatch[1], {}, emMatch[2].trim());
      labelEl.appendChild(em);
    }
    root.appendChild(labelEl);
  }

  // Extract input
  const inpMatch = content.match(/<input\s+([^>]+)>/i);
  let inputEl = null;
  if (inpMatch) {
    const inpAttrsStr = inpMatch[1];
    const inpAttrs = {};
    for (const m of inpAttrsStr.matchAll(/([a-zA-Z0-9_\-]+)="([^"]*)"/g)) {
      inpAttrs[m[1]] = m[2];
    }
    inputEl = new MockElement('input', inpAttrs);
    root.appendChild(inputEl);
  }

  return { root, inputEl };
}

// Run test on example-1
const ex1 = parseHtmlFile('example-1.html');
const res1 = detectConfirmationTarget(ex1.inputEl, ex1.root);
console.log('Example 1 result:', res1, '-> Expected: "permanently delete" | Pass:', res1 === 'permanently delete');

// Run test on example-2
const ex2 = parseHtmlFile('example-2.html');
const res2 = detectConfirmationTarget(ex2.inputEl, ex2.root);
console.log('Example 2 result:', res2, '-> Expected: "temp-612069931970-eu-west-1-an" | Pass:', res2 === 'temp-612069931970-eu-west-1-an');

// Negative test 1: Regular bucket creation input
const negRoot = new MockElement('div');
const negLabel = new MockElement('label', { for: 'bucketName' }, 'Bucket name');
const negInput = new MockElement('input', { id: 'bucketName', placeholder: 'e.g. my-aws-bucket', type: 'text' });
negRoot.appendChild(negLabel);
negRoot.appendChild(negInput);
const resNeg = detectConfirmationTarget(negInput, negRoot);
console.log('Negative test (regular bucket creation input):', resNeg, '-> Expected: null | Pass:', resNeg === null);

// Negative test 2: Table search input
const searchRoot = new MockElement('div');
const searchInput = new MockElement('input', { placeholder: 'Find buckets by name', type: 'text' });
searchRoot.appendChild(searchInput);
const resSearch = detectConfirmationTarget(searchInput, searchRoot);
console.log('Negative test (table search input):', resSearch, '-> Expected: null | Pass:', resSearch === null);
