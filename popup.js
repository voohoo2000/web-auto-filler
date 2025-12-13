
let activeTabDomain = "";
let currentViewDomain = "";
let currentRules = [];
let draftState = null;

document.addEventListener('DOMContentLoaded', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.startsWith('http')) {
        const url = new URL(tab.url);
        activeTabDomain = url.hostname;
    } else {
        activeTabDomain = "";
    }
    currentViewDomain = activeTabDomain;

    const storageData = await chrome.storage.local.get(['draftState', 'pickerResult']);
    const savedDraft = storageData['draftState'];
    const pickerResult = storageData['pickerResult'];

    if (savedDraft) {
        draftState = savedDraft;
        currentViewDomain = draftState.domain;
        if (pickerResult) {
            applyPickerResult(draftState, pickerResult);
            chrome.storage.local.remove('pickerResult');
            saveDraft(); 
        }
        loadRules(currentViewDomain, () => { renderEditor(); switchView('editor'); });
    } else {
        if(currentViewDomain) { loadRules(currentViewDomain, () => switchView('list')); } 
        else { loadGlobalList(); switchView('global'); }
    }
    setupEvents();
});

function loadRules(domain, callback) {
    chrome.storage.local.get([domain], (result) => {
        currentRules = result[domain] || [];
        renderRulesList();
        updateHeader();
        if(callback) callback();
    });
}

function updateHeader() {
    const listTitle = document.getElementById('listTitle');
    const runBtn = document.getElementById('runAllBtn');
    const warning = document.getElementById('offlineNotice');
    
    if (currentViewDomain === activeTabDomain) {
        listTitle.innerText = "当前: " + currentViewDomain;
        runBtn.disabled = false;
        runBtn.title = "运行本页规则";
        warning.classList.add('hidden');
    } else {
        listTitle.innerText = "编辑: " + currentViewDomain;
        runBtn.disabled = true;
        runBtn.title = "无法在当前页面运行其他网站的规则";
        warning.classList.remove('hidden');
    }
}

function switchView(viewName) {
    ['list', 'editor', 'global'].forEach(v => {
        document.getElementById(`view-${v}`).classList.add('hidden');
    });
    document.getElementById(`view-${viewName}`).classList.remove('hidden');
}

function renderRulesList() {
    const container = document.getElementById('rulesListContainer');
    container.innerHTML = '';
    if (currentRules.length === 0) {
        document.getElementById('emptyState').classList.remove('hidden');
        return;
    }
    document.getElementById('emptyState').classList.add('hidden');
    
    currentRules.forEach((rule, index) => {
        const div = document.createElement('div');
        const isManual = rule.triggerMode === 'manual';
        const isMatched = rule.lastMatched && (currentViewDomain === activeTabDomain);
        div.className = `rule-card ${isMatched ? 'matched' : ''} ${isManual ? 'manual' : ''}`;
        let statusText = rule.enabled ? '🟢 已启用' : '⚪ 已禁用';
        let modeText = isManual ? '👆 手动触发' : '⚡ 自动触发';
        let canRun = isManual && (currentViewDomain === activeTabDomain);
        let runBtn = canRun ? `<button class="btn secondary run-single-btn" title="运行">▶</button>` : '';

        div.innerHTML = `
            <div class="rule-info"><strong>${rule.name}</strong><small>${statusText} | ${modeText}</small></div>
            <div class="rule-actions">
                ${runBtn}
                <button class="btn secondary edit-btn">编辑</button>
                <button class="btn secondary copy-btn">复制</button>
            </div>
        `;
        div.querySelector('.edit-btn').onclick = () => startEdit(index);
        div.querySelector('.copy-btn').onclick = () => copyRule(index);
        if(canRun) div.querySelector('.run-single-btn').onclick = () => runRule(rule);
        container.appendChild(div);
    });
}

function loadGlobalList() {
    chrome.storage.local.get(null, (items) => {
        const container = document.getElementById('domainListContainer');
        container.innerHTML = '';
        const systemKeys = ['draftState', 'pickerResult'];
        const domains = Object.keys(items).filter(k => !systemKeys.includes(k) && Array.isArray(items[k]));
        
        if (domains.length === 0) { document.getElementById('emptyGlobalState').classList.remove('hidden'); return; }
        document.getElementById('emptyGlobalState').classList.add('hidden');

        domains.forEach(domain => {
            const count = items[domain].length;
            const div = document.createElement('div');
            div.className = 'domain-card';
            div.innerHTML = `
                <div class="domain-info"><strong>${domain}</strong><small>${count} 条规则</small></div>
                <div class="domain-actions"><button class="btn danger del-domain-btn">删除</button></div>
            `;
            div.onclick = (e) => {
                if(e.target.classList.contains('del-domain-btn')) return;
                currentViewDomain = domain;
                loadRules(domain, () => switchView('list'));
            };
            div.querySelector('.del-domain-btn').onclick = () => {
                if(confirm(`确定删除 ${domain} 的所有规则？`)) { chrome.storage.local.remove(domain, () => loadGlobalList()); }
            };
            container.appendChild(div);
        });
    });
}

function runRule(rule) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if(tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: "executeSpecificRule", rule: rule }, (res) => {
            if(res && res.matched) location.reload(); else alert("未满足触发条件");
        });
    });
}

function runAllRules() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if(tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: "executeAllRules" }, (res) => {
            const count = res ? res.count : 0;
            loadRules(currentViewDomain);
            alert(`执行完毕。共触发 ${count} 条规则。`);
        });
    });
}

function copyRule(index) {
    const rule = JSON.parse(JSON.stringify(currentRules[index]));
    rule.name += " (Copy)";
    rule.lastMatched = false;
    currentRules.push(rule);
    saveCurrentRules();
}

function saveCurrentRules() {
    chrome.storage.local.set({ [currentViewDomain]: currentRules }, () => {
        loadRules(currentViewDomain);
        if (currentViewDomain === activeTabDomain) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if(tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: "reloadRules" });
            });
        }
    });
}

function startEdit(index) {
    const isNew = index === -1;
    const rule = isNew 
        ? { name: '新规则', enabled: true, triggerMode: 'auto', conditions: [], actions: [] } 
        : JSON.parse(JSON.stringify(currentRules[index]));

    draftState = { domain: currentViewDomain, rule: rule, isNew: isNew, index: index, pickerTarget: null };
    saveDraft();
    renderEditor();
    switchView('editor');
}

function renderEditor() {
    const rule = draftState.rule;
    const isOffline = currentViewDomain !== activeTabDomain;
    
    document.getElementById('ruleName').value = rule.name || '';
    document.getElementById('ruleEnabled').checked = rule.enabled;
    document.getElementById('triggerMode').value = rule.triggerMode || 'auto';

    document.getElementById('ruleName').oninput = () => { draftState.rule.name = document.getElementById('ruleName').value; saveDraft(); }
    document.getElementById('ruleEnabled').onchange = () => { draftState.rule.enabled = document.getElementById('ruleEnabled').checked; saveDraft(); }
    document.getElementById('triggerMode').onchange = () => { draftState.rule.triggerMode = document.getElementById('triggerMode').value; saveDraft(); }

    renderList('conditions', rule.conditions, isOffline);
    renderList('actions', rule.actions, isOffline);
}

function renderList(type, items, isOffline) {
    const listEl = document.getElementById(type + 'List');
    listEl.innerHTML = '';
    
    items.forEach((item, i) => {
        const div = document.createElement('div');
        div.className = 'list-item';
        
        let targetAreaHtml = '';
        let pickerDisabled = isOffline ? 'disabled title="离线模式"' : 'title="选择元素"';

        if (type === 'conditions') {
            targetAreaHtml = `
            <div class="row">
                <select class="form-control op-select" data-field="operator">
                    <option value="equals" ${item.operator==='equals'?'selected':''}>等于</option>
                    <option value="not_equals" ${item.operator==='not_equals'?'selected':''}>不等于</option>
                    <option value="contains" ${item.operator==='contains'?'selected':''}>包含</option>
                </select>
                <input type="text" class="form-control value-input" value="${item.targetValue}" placeholder="匹配值" data-field="targetValue">
                <button class="btn remove-btn">删除</button>
            </div>`;
        } else {
            const isControl = item.valueType === 'control';
            let inputHtml = '';
            
            if (isControl) {
                let displayVal = (typeof item.value === 'object' && item.value.value) ? item.value.value : '';
                inputHtml = `
                    <button class="btn picker-btn" id="act-val-pick-${i}" ${pickerDisabled} style="margin-right:5px">🎯</button>
                    <input type="text" class="form-control value-input" value="${displayVal}" placeholder="来源控件ID/Name" data-field="value-control">`;
            } else {
                let displayVal = (typeof item.value === 'object') ? '' : item.value;
                inputHtml = `<input type="text" class="form-control value-input" value="${displayVal}" placeholder="填入文本" data-field="value-static">`;
            }

            targetAreaHtml = `
            <div class="row">
                <span>设为:</span>
                <select class="form-control op-select" id="act-type-${i}" style="width:90px; margin-right:5px;">
                    <option value="static" ${!isControl?'selected':''}>固定值</option>
                    <option value="control" ${isControl?'selected':''}>页面控件</option>
                </select>
                ${inputHtml}
                <button class="btn remove-btn">删除</button>
            </div>`;
        }

        // V16 核心变化：每一行 locator 前面增加类型选择框
        div.innerHTML = `
            <div class="row">
                <button class="btn picker-btn target-pick" ${pickerDisabled}>🎯</button>
                <select class="form-control type-select" data-field="locator-type">
                    <option value="selector" ${item.locator.type==='selector'?'selected':''}>CSS</option>
                    <option value="id" ${item.locator.type==='id'?'selected':''}>ID</option>
                    <option value="name" ${item.locator.type==='name'?'selected':''}>Name</option>
                    <option value="text" ${item.locator.type==='text'?'selected':''}>Text</option>
                </select>
                <input type="text" class="form-control locator-input" value="${item.locator.value}" placeholder="定位符" data-field="locator">
            </div>
            ${targetAreaHtml}
        `;
        
        if (!isOffline) div.querySelector('.target-pick').onclick = () => triggerPicker(type === 'conditions' ? 'condition' : 'action', i);

        if (type === 'actions') {
            const typeSelect = div.querySelector(`#act-type-${i}`);
            typeSelect.onchange = (e) => {
                const newType = e.target.value;
                item.valueType = newType;
                item.value = (newType === 'control') ? {type: 'selector', value: ''} : '';
                saveDraft();
                renderEditor();
            };
            if (item.valueType === 'control' && !isOffline) {
                div.querySelector(`#act-val-pick-${i}`).onclick = () => triggerPicker('action_value', i);
            }
        }

        div.querySelector('.remove-btn').onclick = () => { items.splice(i, 1); saveDraft(); renderEditor(); };
        
        // 统一处理输入
        const inputHandler = (e) => {
            const field = e.target.dataset.field;
            if (!field) return; 
            
            if (field === 'locator') { item.locator.value = e.target.value; } // 不再强制重置 type
            else if (field === 'locator-type') { item.locator.type = e.target.value; } // 手动切换类型
            else if (field === 'value-static') { item.value = e.target.value; }
            else if (field === 'value-control') { item.value = { type: 'selector', value: e.target.value }; }
            else if (field === 'targetValue') { item.targetValue = e.target.value; }
            else if (field === 'operator') { item.operator = e.target.value; }
            saveDraft();
        };

        div.querySelectorAll('input, select').forEach(input => {
            if (input.id && input.id.startsWith('act-type')) return;
            input.oninput = inputHandler;
            input.onchange = inputHandler;
        });
        
        listEl.appendChild(div);
    });
}

function triggerPicker(type, index) {
    updateDraftFromDOM(); 
    draftState.pickerTarget = { type, index };
    saveDraft().then(() => {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            chrome.tabs.sendMessage(tabs[0].id, {action: "startPicker"});
            window.close();
        });
    });
}

function updateDraftFromDOM() {
    draftState.rule.name = document.getElementById('ruleName').value;
    draftState.rule.enabled = document.getElementById('ruleEnabled').checked;
    draftState.rule.triggerMode = document.getElementById('triggerMode').value;
}

function applyPickerResult(state, result) {
    if (!state.pickerTarget) return;
    const { type, index } = state.pickerTarget;
    // Picker 返回了 type 和 value，我们需要全部更新
    if (type === 'condition') { state.rule.conditions[index].locator = result.locator; } 
    else if (type === 'action') { state.rule.actions[index].locator = result.locator; } 
    else if (type === 'action_value') { state.rule.actions[index].value = result.locator; }
    state.pickerTarget = null;
}

function saveDraft() { return chrome.storage.local.set({ 'draftState': draftState }); }
function clearDraft() { draftState = null; chrome.storage.local.remove('draftState'); }

function saveFinalRule() {
    updateDraftFromDOM();
    if (draftState.isNew) currentRules.push(draftState.rule); else currentRules[draftState.index] = draftState.rule;
    saveCurrentRules();
    clearDraft(); switchView('list');
}

function setupEvents() {
    document.getElementById('addRuleBtn').onclick = () => startEdit(-1);
    document.getElementById('runAllBtn').onclick = runAllRules;
    document.getElementById('globalBtn').onclick = () => { loadGlobalList(); switchView('global'); };
    document.getElementById('backBtn').onclick = () => { clearDraft(); switchView('list'); };
    document.getElementById('saveRuleBtn').onclick = saveFinalRule;
    
    document.getElementById('deleteRuleBtn').onclick = () => {
        if (!draftState.isNew && confirm('确定删除？')) {
            currentRules.splice(draftState.index, 1);
            saveCurrentRules();
            clearDraft(); switchView('list');
        } else if (draftState.isNew) { clearDraft(); switchView('list'); }
    };
    
    document.getElementById('addConditionBtn').onclick = () => {
        updateDraftFromDOM();
        draftState.rule.conditions.push({ locator: {type:'', value:''}, operator: 'equals', targetValue: '' });
        saveDraft(); renderEditor();
    };
    
    document.getElementById('addActionBtn').onclick = () => {
        updateDraftFromDOM();
        draftState.rule.actions.push({ locator: {type:'', value:''}, valueType: 'static', value: '' });
        saveDraft(); renderEditor();
    };
    
    document.getElementById('globalBackBtn').onclick = () => {
        if(activeTabDomain) { currentViewDomain = activeTabDomain; loadRules(currentViewDomain, () => switchView('list')); } 
        else { alert("当前无活动标签页"); }
    };
    
    document.getElementById('exportBtn').onclick = () => {
        const blob = new Blob([JSON.stringify(currentRules, null, 2)], {type : 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `${currentViewDomain}_rules.json`; a.click();
    };
    document.getElementById('importBtn').onclick = () => document.getElementById('fileInput').click();
    document.getElementById('fileInput').onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (event) => {
            try { 
                const data = JSON.parse(event.target.result); 
                if (!Array.isArray(data)) throw new Error("Format");
                currentRules = data; saveCurrentRules(); alert('导入成功'); 
            } catch(err) { alert('单站导入失败：文件格式需为数组'); }
        };
        reader.readAsText(file);
    };

    document.getElementById('globalExportBtn').onclick = () => {
        chrome.storage.local.get(null, (items) => {
            const exportData = {};
            Object.keys(items).forEach(k => {
                if (k !== 'draftState' && k !== 'pickerResult') { exportData[k] = items[k]; }
            });
            const blob = new Blob([JSON.stringify(exportData, null, 2)], {type : 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `WebAutoFiller_Full_Backup.json`; a.click();
        });
    };

    document.getElementById('globalImportBtn').onclick = () => document.getElementById('globalFileInput').click();
    document.getElementById('globalFileInput').onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (event) => {
            try { 
                const data = JSON.parse(event.target.result);
                if (Array.isArray(data)) { alert('这是单站备份，请去首页导入'); return; }
                chrome.storage.local.set(data, () => { loadGlobalList(); alert('全局数据恢复成功！'); });
            } catch(err) { alert('全局导入失败'); }
        };
        reader.readAsText(file);
    };
}
