
let rules = [];
let observer = null;
let isContextInvalidated = false;

function init() {
  if (!chrome.runtime?.id) return;
  const hostname = window.location.hostname;
  chrome.storage.local.get([hostname], (result) => {
    if (chrome.runtime.lastError) return;
    if (result[hostname]) {
      rules = result[hostname];
      startMonitoring();
    }
  });
}

function startMonitoring() {
  if (isContextInvalidated) return;
  checkAndExecuteAll(false);
  if (observer) observer.disconnect();
  observer = new MutationObserver((mutations) => {
    if (isContextInvalidated) { observer.disconnect(); return; }
    if(window.domChangeTimeout) clearTimeout(window.domChangeTimeout);
    window.domChangeTimeout = setTimeout(() => { checkAndExecuteAll(false); }, 500); 
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
}

function checkAndExecuteAll(forceRun) {
  if (isContextInvalidated) return 0;
  let triggeredCount = 0;
  rules.forEach(rule => {
    if (!rule.enabled) return;
    if (!forceRun && rule.triggerMode === 'manual') return;
    if (processRule(rule)) triggeredCount++;
  });
  try {
      if (chrome.runtime?.id) {
          chrome.runtime.sendMessage({ action: "updateBadge", count: triggeredCount });
          const hostname = window.location.hostname;
          chrome.storage.local.set({ [hostname]: rules });
      } else { throw new Error("Extension context invalidated"); }
  } catch (e) {
      if (e.message.includes("Extension context invalidated") || !chrome.runtime?.id) {
          isContextInvalidated = true;
          if (observer) observer.disconnect();
      }
  }
  return triggeredCount;
}

function processRule(rule) {
    let allConditionsMet = true;
    for (let condition of rule.conditions) {
      const el = locateElement(condition.locator);
      if (!el) { allConditionsMet = false; break; }
      const elValue = getElementValue(el); 
      const targetValue = getTargetValue(condition.targetType, condition.targetValue);
      if (!compareValues(elValue, condition.operator, targetValue)) {
        allConditionsMet = false; break;
      }
    }
    if (allConditionsMet) {
      rule.lastMatched = true;
      rule.actions.forEach(action => {
        const el = locateElement(action.locator);
        if (el) {
          const valueToSet = getTargetValue(action.valueType, action.value);
          setElementValue(el, valueToSet);
        }
      });
      return true;
    } else {
        rule.lastMatched = false;
        return false;
    }
}

function locateElement(locator) {
  if (!locator || !locator.value) return null;
  try {
      if (locator.type === 'id') return document.getElementById(locator.value);
      if (locator.type === 'name') return document.querySelector(`[name="${locator.value}"]`);
      if (locator.type === 'selector') return document.querySelector(locator.value);
      if (locator.type === 'text') {
        const xpath = `//*[contains(text(),'${locator.value}')]`;
        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        return result.singleNodeValue;
      }
  } catch(e) {}
  return null;
}

function getElementValue(el) {
  if (el.tagName === 'SELECT') {
      const selectedOpt = el.options[el.selectedIndex];
      return { isSelect: true, value: el.value, text: selectedOpt ? selectedOpt.text : '' };
  }
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return el.value;
  return el.innerText;
}

function getTargetValue(type, value) {
  if (type === 'static') return value;
  if (type === 'control') {
    const el = locateElement(value); 
    if (el && el.tagName === 'SELECT') return el.value;
    return el ? getElementValue(el) : '';
  }
  return value;
}

function compareValues(actual, operator, target) {
  const targetStr = String(target).trim();
  const checkSingle = (val) => {
      const valStr = String(val).trim();
      if (operator === 'equals') return valStr == targetStr;
      if (operator === 'not_equals') return valStr != targetStr;
      if (operator === 'contains') return valStr.includes(targetStr);
      return false;
  };
  if (actual && typeof actual === 'object' && actual.isSelect) {
      const valMatch = checkSingle(actual.value);
      const textMatch = checkSingle(actual.text);
      if (operator === 'not_equals') return valMatch && textMatch;
      return valMatch || textMatch;
  }
  return checkSingle(actual);
}

function setElementValue(el, value) {
  const valToSet = (typeof value === 'object' && value.isSelect) ? value.value : value;
  if (getElementValue(el) === valToSet) return;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    el.value = valToSet;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (el.tagName === 'SELECT') {
      el.value = valToSet;
      if (el.value !== valToSet) {
         for (let i = 0; i < el.options.length; i++) {
             if (el.options[i].text === valToSet) { el.selectedIndex = i; break; }
         }
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    el.innerText = valToSet;
  }
}

let pickerMode = false;
let highlightedElement = null;

function enablePicker() {
  pickerMode = true;
  document.body.style.cursor = 'crosshair';
  const overlay = document.createElement('div');
  overlay.id = 'waf-picker-overlay';
  Object.assign(overlay.style, {
      position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
      zIndex: 999999, background: 'rgba(0,0,0,0.05)', pointerEvents: 'none'
  });
  document.body.appendChild(overlay);
  document.addEventListener('mouseover', handleMouseOver);
  document.addEventListener('click', handleClick, true);
}

function disablePicker() {
  pickerMode = false;
  document.body.style.cursor = 'default';
  const overlay = document.getElementById('waf-picker-overlay');
  if (overlay) overlay.remove();
  if (highlightedElement) { highlightedElement.style.outline = ''; highlightedElement = null; }
  document.removeEventListener('mouseover', handleMouseOver);
  document.removeEventListener('click', handleClick, true);
}

function handleMouseOver(e) {
  if (!pickerMode) return;
  if (highlightedElement) highlightedElement.style.outline = '';
  e.target.style.outline = '3px solid #ff4757';
  highlightedElement = e.target;
}

function handleClick(e) {
  if (!pickerMode) return;
  e.preventDefault(); e.stopPropagation();
  const el = e.target;
  let locator = { type: 'selector', value: '' };
  
  // 智能推断，但现在 UI 支持手动修改类型了
  if (el.id) locator = { type: 'id', value: el.id };
  else if (el.name) locator = { type: 'name', value: el.name };
  else locator = { type: 'selector', value: generateSelector(el) };

  const result = { locator: locator, sampleText: el.innerText.substring(0, 20) };
  chrome.storage.local.set({ 'pickerResult': result }, () => {
      alert(`已捕获: [${locator.type}] ${locator.value}\n请重新打开插件窗口。`);
      disablePicker();
  });
}

function generateSelector(el) {
    if (el.tagName.toLowerCase() == "html") return "HTML";
    let str = el.tagName.toLowerCase();
    str += (el.id != "") ? "#" + el.id : "";
    if (el.className && typeof el.className === 'string') {
        let classes = el.className.split(/\s+/);
        for (let i = 0; i < classes.length; i++) {
            if(classes[i]) str += "." + classes[i];
        }
    }
    if(str.length < 5 && el.parentElement) return generateSelector(el.parentElement) + " > " + str;
    return str;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "startPicker") {
    enablePicker();
    sendResponse({status: "started"});
  } else if (request.action === "reloadRules") {
      init();
      sendResponse({status: "ok"});
  } else if (request.action === "executeSpecificRule") {
      const matched = processRule(request.rule);
      sendResponse({ success: true, matched: matched });
  } else if (request.action === "executeAllRules") {
      const count = checkAndExecuteAll(true);
      sendResponse({ count: count });
  }
});
init();
