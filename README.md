# AWS Confirmation Autofill (Firefox Extension)

A lightweight Firefox browser extension (Manifest V3) that automatically detects and populates confirmation fields in the AWS Management Console (e.g. `permanently delete`, `delete`, or exact resource names) without auto-submitting.

---

## Can We Detect When & What to Fill In?

**Yes, reliably.** In the AWS Console (built on AWS Cloudscape / AWSUI), confirmation inputs adhere to very consistent patterns:

### 1. Detecting the Confirmation Input (Avoiding False Positives)
The extension identifies confirmation prompts by checking:
* **Associated Label Context:** The input's `<label>` (via `aria-labelledby`, `for`/`id`, or Cloudscape `FormField` container wrapper) contains keywords like:
  * `"To confirm deletion..."`
  * `"To confirm this action..."`
  * `"type <word> to confirm..."` / `"enter <word> in the text input field..."`
* **Container / Modal Context:** The parent modal dialog or container heading features destructive actions (`"Permanently delete..."`, `"Delete bucket..."`, `"Terminate instances..."`).
* **Input State:** Only empty, editable text inputs (`type="text"`) within confirmation containers are considered. Standard form inputs (e.g., creating a new resource) and search fields are ignored.

### 2. Extracting the Exact Confirmation String
AWS prompts provide the target text in one of three predictable ways:
1. **Styled Emphasis in Label:** AWS frequently wraps the target phrase inside an `<em>`, `<code>`, `<strong>`, or `<b>` tag (e.g., `To confirm deletion, type <em>permanently delete</em> in the text input field.`).
2. **Quoted Resource Identifier in Heading:** For resource-specific deletion, the resource name is quoted in the modal heading (e.g., `Delete bucket "temp-612069931970-eu-west-1-an"?`).
3. **Cloudscape Component Placeholder:** AWS Cloudscape sets the `<input placeholder="...">` attribute to the exact target string (e.g., `placeholder="permanently delete"` or `placeholder="temp-612069931970-eu-west-1-an"`).

The extension correlates these sources: if the label or heading confirms destructive confirmation, the matching placeholder or extracted phrase is filled.

### 3. Enabling the Submit Button in React / Cloudscape
AWS Console uses React. Directly setting `input.value = "..."` does not notify React's internal value tracker (`_valueTracker`), leaving the "Delete" button disabled. 

This extension:
1. Invokes the native `HTMLInputElement.prototype.value` setter to bypass React's wrapper.
2. Dispatches synthetic `InputEvent('input', { bubbles: true, composed: true })` and `Event('change', { bubbles: true })` events.
3. This triggers React's state update, causing Cloudscape to validate the input and immediately enable the confirmation button.
4. **Does not click or submit:** The user retains full control to review the action and click the button manually.

### 4. Detecting Dynamic Modals (SPAs)
AWS Console dynamically creates and mounts modals. The extension uses a debounced `MutationObserver` on `document.documentElement` to instantly detect and fill confirmation inputs as soon as modals are inserted.

---

## How to Install in Firefox

### Option A: Load Temporary Add-on (Instant)
1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click **"Load Temporary Add-on..."**.
3. Navigate to this directory (`/Users/bram/src/personal/aws-confirmation`) and select `manifest.json`.
4. The extension is now active in Firefox.

### Option B: Run with `web-ext`
From this directory:
```bash
npx web-ext run
```
This opens a clean Firefox instance with the extension pre-loaded.

---

## Testing

Open `test.html` in Firefox:
```bash
open test.html
```
Or start a local test server:
```bash
python3 -m http.server 8000
# Visit http://localhost:8000/test.html
```
You will see:
* **Example 1 (`permanently delete`):** Automatically filled and the "Empty bucket" button is enabled.
* **Example 2 (Bucket name in quotes):** Automatically filled with `temp-612069931970-eu-west-1-an` and "Delete bucket" button is enabled.
* **Dynamic Modal:** Dynamically spawned dialogs are automatically detected and filled via `MutationObserver`.
* **Control Input:** Standard creation inputs remain completely untouched.
