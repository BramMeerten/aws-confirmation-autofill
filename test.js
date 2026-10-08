// Simulate AWS React validation state behavior for example 1
const inp1 = document.getElementById('formField1250-1791278043897-1129');
const btn1 = document.getElementById('btn-ex1');
const status1 = document.getElementById('status-ex1');
if (inp1) {
  inp1.addEventListener('input', () => {
    if (inp1.value.trim() === 'permanently delete') {
      btn1.disabled = false;
      status1.className = 'status-badge ready';
      status1.textContent = 'Ready! Button enabled (permanently delete matched)';
    } else {
      btn1.disabled = true;
      status1.className = 'status-badge waiting';
      status1.textContent = 'Waiting for exact confirmation input...';
    }
  });
}

// Simulate AWS React validation state behavior for example 2
const inp2 = document.getElementById('formField1435-1791278139446-1463');
const btn2 = document.getElementById('btn-ex2');
const status2 = document.getElementById('status-ex2');
if (inp2) {
  inp2.addEventListener('input', () => {
    if (inp2.value.trim() === 'temp-612069931970-eu-west-1-an') {
      btn2.disabled = false;
      status2.className = 'status-badge ready';
      status2.textContent = 'Ready! Button enabled (bucket name matched)';
    } else {
      btn2.disabled = true;
      status2.className = 'status-badge waiting';
      status2.textContent = 'Waiting for exact confirmation input...';
    }
  });
}

// Dynamic modal simulator
const spawnBtn = document.getElementById('btn-spawn-modal');
if (spawnBtn) {
  spawnBtn.addEventListener('click', () => {
    const container = document.getElementById('dynamic-modal-container');
    container.innerHTML = `
      <div role="dialog" style="border: 2px dashed #ec7211; padding: 16px; border-radius: 6px; background:#fffaf5;">
        <h3>Delete DB Cluster "production-database"?</h3>
        <label id="dyn-label" for="dyn-input">To confirm deletion, type <em>delete me</em> in the text input field.</label>
        <div style="margin-top: 8px;">
          <input id="dyn-input" aria-labelledby="dyn-label" placeholder="delete me" type="text" autocomplete="off" value="">
        </div>
        <button id="dyn-btn" class="action-btn primary" disabled style="margin-top: 8px;">Delete cluster</button>
        <div id="dyn-status" class="status-badge waiting">Waiting for dynamic confirmation...</div>
      </div>
    `;

    const dynInp = document.getElementById('dyn-input');
    const dynBtn = document.getElementById('dyn-btn');
    const dynStatus = document.getElementById('dyn-status');
    dynInp.addEventListener('input', () => {
      if (dynInp.value.trim() === 'delete me') {
        dynBtn.disabled = false;
        dynStatus.className = 'status-badge ready';
        dynStatus.textContent = 'Ready! Dynamic modal auto-detected and button enabled!';
      }
    });
  });

  // Trigger dynamic modal
  spawnBtn.click();
}
