import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, callPopup, getRequestHeaders } from "../../../../script.js";

// ============================================================================
// 1. 常量与配置
// ============================================================================

const extensionName = "st-persona-weaver";
const STORAGE_KEY_HISTORY = 'pw_history_v9';
const STORAGE_KEY_STATE = 'pw_state_v9'; 
const STORAGE_KEY_TAGS = 'pw_tags_v3';

const defaultTags = [
    { name: "姓名", value: "" },
    { name: "性别", value: "" },
    { name: "年龄", value: "" },
    { name: "职业", value: "" },
    { name: "外貌", value: "" },
    { name: "性格", value: "" },
    { name: "关系", value: "" },
    { name: "XP/性癖", value: "" },
    { name: "秘密", value: "" }
];

const defaultSettings = {
    autoSwitchPersona: true,
    syncToWorldInfo: true,
    historyLimit: 50,
    outputFormat: 'yaml', 
    apiSource: 'main', 
    indepApiUrl: 'https://api.openai.com/v1',
    indepApiKey: '',
    indepApiModel: 'gpt-3.5-turbo'
};

const TEXT = {
    PANEL_TITLE: "用户设定编织者 Pro",
    BTN_OPEN_MAIN: "打开设定生成器",
    LABEL_TAGS: "快速标签",
    TOAST_NO_CHAR: "请先打开一个角色聊天",
    TOAST_API_OK: "API 连接成功",
    TOAST_API_ERR: "API 连接失败",
    TOAST_SAVE_API: "API 设置已保存",
    TOAST_SNAPSHOT: "已存入历史记录",
    TOAST_GEN_FAIL: "生成失败，请检查 API 设置",
    TOAST_SAVE_SUCCESS: (name) => `设定已保存并切换为: ${name}`
};

// ============================================================================
// 2. 状态与存储
// ============================================================================

let historyCache = [];
let tagsCache = [];
let worldInfoCache = {}; 
let availableWorldBooks = []; 
let isEditingTags = false; 

function loadData() {
    try { historyCache = JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY)) || []; } catch { historyCache = []; }
    try { tagsCache = JSON.parse(localStorage.getItem(STORAGE_KEY_TAGS)) || defaultTags; } catch { tagsCache = defaultTags; }
}

function saveData() {
    localStorage.setItem(STORAGE_KEY_TAGS, JSON.stringify(tagsCache));
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(historyCache));
}

function saveHistory(item) {
    const limit = extension_settings[extensionName]?.historyLimit || 50;
    item.timestamp = new Date().toLocaleString();
    historyCache.unshift(item);
    if (historyCache.length > limit) historyCache = historyCache.slice(0, limit);
    saveData();
}

function updateHistoryTitle(index, newTitle) {
    if (historyCache[index]) {
        historyCache[index].data.customTitle = newTitle;
        saveData();
    }
}

function saveState(data) {
    localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(data));
}

function loadState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_STATE)) || {}; } catch { return {}; }
}

function injectStyles() {
    // 样式由 style.css 控制，此处保留空函数以防调用报错
    const styleId = 'persona-weaver-css-v9';
    if (!$(`#${styleId}`).length) {
        $('<style>').attr('id', styleId).html("/* CSS Loaded via file */").appendTo('head');
    }
}

// ============================================================================
// 3. 业务逻辑
// ============================================================================

async function loadAvailableWorldBooks() {
    availableWorldBooks = [];
    const context = getContext();
    if (window.TavernHelper?.getWorldbookNames) {
        try { availableWorldBooks = window.TavernHelper.getWorldbookNames(); } catch {}
    }
    if (!availableWorldBooks.length) {
        try {
            const r = await fetch('/api/worldinfo/get', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({}) });
            if (r.ok) {
                const d = await r.json();
                availableWorldBooks = (Array.isArray(d) ? d.map(i => i.name || i) : d.world_names) || [];
            }
        } catch {}
    }
    if (!availableWorldBooks.length && context.world_names) availableWorldBooks = [...context.world_names];
    availableWorldBooks = [...new Set(availableWorldBooks)].filter(x => x).sort();
}

async function getContextWorldBooks(extras = []) {
    const context = getContext();
    const books = new Set(extras); 
    const char = context.characters[context.characterId];
    if (char) {
        const d = char.data || char;
        const main = d.extensions?.world || d.world || d.character_book?.name;
        if (main) books.add(main);
    }
    context.worldInfoSettings?.globalSelect?.forEach(b => books.add(b));
    return Array.from(books).filter(Boolean);
}

async function getWorldBookEntries(bookName) {
    if (worldInfoCache[bookName]) return worldInfoCache[bookName];
    try {
        const r = await fetch('/api/worldinfo/get', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ name: bookName }) });
        if (r.ok) {
            const d = await r.json();
            const entries = Object.values(d.entries || {}).map(e => ({
                uid: e.uid,
                displayName: e.comment?.trim() || (Array.isArray(e.key) ? e.key.join(', ') : e.key),
                content: e.content,
                enabled: !e.disable
            }));
            worldInfoCache[bookName] = entries;
            return entries;
        }
    } catch {}
    return [];
}

async function fetchModels(url, key) {
    try {
        const endpoint = url.includes('v1') ? `${url.replace(/\/$/, '')}/models` : `${url.replace(/\/$/, '')}/v1/models`;
        const r = await fetch(endpoint, { method: 'GET', headers: { 'Authorization': `Bearer ${key}` } });
        if (!r.ok) throw new Error("Fetch failed");
        const d = await r.json();
        return (d.data || d).map(m => m.id).sort();
    } catch (e) { return []; }
}

async function runGeneration(data, apiConfig) {
    const context = getContext();
    const char = context.characters[context.characterId];
    const systemPrompt = `You are a creative writing assistant.
Task: Create a detailed User Persona for a roleplay with: ${char.name}.
${data.wiContext?.length ? `[Context]:\n${data.wiContext.join('\n')}\n` : ''}
[Request]: ${data.request}
[Format]: JSON object with keys: "name", "description" (${data.format==='yaml'?'YAML format properties':'Narrative paragraph'}), "wi_entry" (Summary).`;

    if (apiConfig.apiSource === 'independent') {
        const r = await fetch(`${apiConfig.indepApiUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.indepApiKey}` },
            body: JSON.stringify({ model: apiConfig.indepApiModel, messages: [{ role: 'system', content: systemPrompt }], temperature: 0.7 })
        });
        if (!r.ok) throw new Error("API Error");
        const json = await r.json();
        return JSON.parse(json.choices[0].message.content.match(/\{[\s\S]*\}/)[0]);
    } else {
        const txt = await context.generateQuietPrompt(systemPrompt, false, false, "System");
        return JSON.parse(txt.match(/\{[\s\S]*\}/)[0]);
    }
}

// ============================================================================
// 4. UI 渲染与交互
// ============================================================================

async function openCreatorPopup() {
    const context = getContext();
    if (context.characterId === undefined) return toastr.warning(TEXT.TOAST_NO_CHAR);

    loadData();
    await loadAvailableWorldBooks();
    const savedState = loadState();
    const config = { ...defaultSettings, ...extension_settings[extensionName], ...savedState.localConfig };
    
    // [修复] 标签渲染：始终包含 + 按钮
    const renderTags = () => {
        let html = '';
        if (!isEditingTags) {
            html = tagsCache.map((t, i) => `
                <div class="pw-tag" data-idx="${i}">
                    <i class="fa-solid fa-tag" style="opacity:0.5;font-size:0.8em;margin-right:4px;"></i>${t.name}
                    ${t.value ? `<span class="pw-tag-val">${t.value}</span>` : ''}
                </div>
            `).join('');
            // 正常模式下的添加按钮 (紧凑)
            html += `<div class="pw-tag-add-btn" id="pw-tag-quick-add" title="添加新标签"><i class="fa-solid fa-plus"></i></div>`;
        } else {
            html = tagsCache.map((t, i) => `
                <div class="pw-tag-edit-row">
                    <input class="pw-tag-input t-name" data-idx="${i}" value="${t.name}" placeholder="标签名" style="flex:1;">
                    <input class="pw-tag-input t-val" data-idx="${i}" value="${t.value}" placeholder="预填内容" style="flex:2;">
                    <i class="fa-solid fa-trash" style="color:#ff6b6b;cursor:pointer;padding:8px;" data-del-idx="${i}"></i>
                </div>
            `).join('');
            // 编辑模式下的添加按钮 (宽条)
            html += `<div class="pw-tag-add-btn" id="pw-tag-quick-add" style="width:100%; margin-top:5px; padding:8px;"><i class="fa-solid fa-plus"></i> 添加新标签</div>`;
        }
        return html;
    };

    const wiOptions = availableWorldBooks.length > 0 
        ? availableWorldBooks.map(b => `<option value="${b}">${b}</option>`).join('')
        : `<option disabled>未找到世界书</option>`;

    const html = `
    <div class="pw-wrapper">
        <div class="pw-header">
            <div class="pw-title"><i class="fa-solid fa-wand-magic-sparkles"></i> 设定编织者 Pro</div>
        </div>
        
        <div class="pw-tabs">
            <div class="pw-tab active" data-tab="editor">📝 编辑</div>
            <div class="pw-tab" data-tab="context">📚 世界书</div>
            <div class="pw-tab" data-tab="api">⚙️ API</div>
            <div class="pw-tab" data-tab="history">📜 历史</div>
        </div>

        <!-- 1. 编辑视图 -->
        <div id="pw-view-editor" class="pw-view active">
            <div class="pw-scroll-area">
                <div>
                    <div class="pw-label" style="display:flex; justify-content:space-between; align-items:center;">
                        <span>${TEXT.LABEL_TAGS}</span>
                        <div style="cursor:pointer; opacity:0.7; font-size:0.9em;" id="pw-toggle-edit-tags">
                            <i class="fa-solid ${isEditingTags ? 'fa-check' : 'fa-gear'}"></i> ${isEditingTags ? '完成' : '管理'}
                        </div>
                    </div>
                    <div class="pw-tags-wrapper">
                        <div class="pw-tags-container" id="pw-tags-list">
                            ${renderTags()}
                        </div>
                    </div>
                </div>

                <div style="flex:1; display:flex; flex-direction:column;">
                    <textarea id="pw-request" class="pw-textarea" placeholder="在此输入要求，或点击上方标签..." style="flex:1;">${savedState.request || ''}</textarea>
                    
                    <div class="pw-editor-controls" style="margin-top:8px; display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; gap:10px;">
                            <div class="pw-mini-btn" id="pw-clear"><i class="fa-solid fa-eraser"></i> 清空</div>
                            <div class="pw-mini-btn" id="pw-snapshot"><i class="fa-solid fa-save"></i> 存入历史</div>
                        </div>
                        <div style="display:flex; align-items:center; gap:5px;">
                            <span style="font-size:0.85em; opacity:0.7;">格式:</span>
                            <select id="pw-fmt-select" class="pw-input" style="padding:4px; margin:0; width:auto;">
                                <option value="yaml" ${config.outputFormat === 'yaml' ? 'selected' : ''}>YAML</option>
                                <option value="paragraph" ${config.outputFormat === 'paragraph' ? 'selected' : ''}>小说段落</option>
                            </select>
                        </div>
                    </div>
                </div>

                <button id="pw-btn-gen" class="pw-btn gen" style="margin-top:15px;"><i class="fa-solid fa-bolt"></i> 生成 / 润色</button>

                <div id="pw-result-area" style="display: ${savedState.hasResult ? 'block' : 'none'}; border-top: 1px dashed var(--smart-theme-border-color-1); padding-top: 10px; margin-top:15px;">
                    <div class="pw-label" style="color:#5b8db8;">
                        <i class="fa-solid fa-check-circle"></i> 生成结果
                    </div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        <input type="text" id="pw-res-name" class="pw-input" placeholder="角色名称" value="${savedState.name || ''}">
                        <textarea id="pw-res-desc" class="pw-textarea" rows="6" placeholder="用户设定描述">${savedState.desc || ''}</textarea>
                        
                        <div style="background:rgba(0,0,0,0.15); padding:10px; border-radius:6px; border:1px solid var(--smart-theme-border-color-1);">
                            <div style="display:flex; align-items:center; gap:5px; margin-bottom:5px;">
                                <input type="checkbox" id="pw-wi-toggle" checked>
                                <span style="font-size:0.9em; font-weight:bold;">同步写入世界书</span>
                            </div>
                            <textarea id="pw-res-wi" class="pw-textarea" rows="3" placeholder="世界书条目内容...">${savedState.wiContent || ''}</textarea>
                        </div>
                    </div>
                    <button id="pw-btn-apply" class="pw-btn save"><i class="fa-solid fa-check"></i> 保存并切换</button>
                </div>
            </div>
        </div>

        <!-- 2. 世界书视图 -->
        <div id="pw-view-context" class="pw-view">
            <div class="pw-scroll-area">
                <div class="pw-label">添加参考世界书</div>
                <div class="pw-wi-controls">
                    <select id="pw-wi-select" class="pw-input" style="flex:1;">
                        <option value="">-- 选择世界书 --</option>
                        ${wiOptions}
                    </select>
                    <button id="pw-wi-add" class="pw-btn normal"><i class="fa-solid fa-plus"></i></button>
                </div>
                <div id="pw-wi-container"></div>
            </div>
        </div>

        <!-- 3. API 设置视图 (修复样式) -->
        <div id="pw-view-api" class="pw-view">
            <div class="pw-scroll-area">
                <div class="pw-card-box">
                    <div class="pw-row">
                        <label>API 来源</label>
                        <select id="pw-api-source" class="pw-input" style="flex:1;">
                            <option value="main" ${config.apiSource === 'main' ? 'selected' : ''}>使用主 API</option>
                            <option value="independent" ${config.apiSource === 'independent' ? 'selected' : ''}>独立 API</option>
                        </select>
                    </div>
                    
                    <div id="pw-indep-settings" style="display:${config.apiSource === 'independent' ? 'flex' : 'none'}; flex-direction:column; gap:10px;">
                        <div class="pw-row">
                            <label>URL</label>
                            <input type="text" id="pw-api-url" class="pw-input" style="flex:1;" value="${config.indepApiUrl}" placeholder="https://api.openai.com/v1">
                        </div>
                        <div class="pw-row">
                            <label>Key</label>
                            <input type="password" id="pw-api-key" class="pw-input" style="flex:1;" value="${config.indepApiKey}">
                        </div>
                        <div class="pw-row">
                            <label>Model</label>
                            <div style="flex:1; display:flex; gap:5px; width:100%;">
                                <input type="text" id="pw-api-model" class="pw-input" value="${config.indepApiModel}" list="pw-model-list" style="flex:1;">
                                <datalist id="pw-model-list"></datalist>
                                <button id="pw-api-fetch" class="pw-btn normal" title="获取模型列表"><i class="fa-solid fa-cloud-download-alt"></i></button>
                            </div>
                        </div>
                    </div>
                    <div style="text-align:right; margin-top:5px;">
                        <button id="pw-api-save" class="pw-btn primary"><i class="fa-solid fa-save"></i> 保存 API 设置</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 4. 历史视图 -->
        <div id="pw-view-history" class="pw-view">
            <div class="pw-scroll-area">
                <div class="pw-history-toolbar" style="margin-bottom:10px;">
                    <div class="pw-search-wrapper" style="position:relative;">
                        <input type="text" id="pw-history-search" class="pw-input" placeholder="🔍 搜索 (标题/内容/角色/时间)..." style="width:100%; padding-right:30px;">
                        <i class="fa-solid fa-times pw-search-clear" style="position:absolute; right:10px; top:50%; transform:translateY(-50%); cursor:pointer; opacity:0.5;"></i>
                    </div>
                </div>
                <div id="pw-history-list" style="display:flex; flex-direction:column;"></div>
                
                <div id="pw-history-clear-all" class="pw-text-danger-btn">
                    <i class="fa-solid fa-trash-alt"></i> 清空所有历史记录
                </div>
            </div>
        </div>
    </div>
    `;

    callPopup(html, 'text', '', { wide: true, large: true, okButton: "关闭" });

    // ========================================================================
    // 逻辑绑定
    // ========================================================================
    
    // 状态保存
    const saveCurrentState = () => {
        saveState({
            request: $('#pw-request').val(),
            name: $('#pw-res-name').val(),
            desc: $('#pw-res-desc').val(),
            wiContent: $('#pw-res-wi').val(),
            hasResult: $('#pw-result-area').is(':visible'),
            localConfig: {
                outputFormat: $('#pw-fmt-select').val(),
                apiSource: $('#pw-api-source').val(),
                indepApiUrl: $('#pw-api-url').val(),
                indepApiKey: $('#pw-api-key').val(),
                indepApiModel: $('#pw-api-model').val(),
                extraBooks: window.pwExtraBooks || []
            }
        });
    };
    $(document).off('.pw');
    $(document).on('input.pw change.pw', '#pw-request, #pw-res-name, #pw-res-desc, #pw-res-wi, .pw-input', saveCurrentState);

    // Tab 切换
    $(document).on('click.pw', '.pw-tab', function() {
        $('.pw-tab').removeClass('active');
        $(this).addClass('active');
        $('.pw-view').removeClass('active');
        const tab = $(this).data('tab');
        $(`#pw-view-${tab}`).addClass('active');
        if(tab === 'history') renderHistoryList(); 
    });

    // 标签系统
    $(document).on('click.pw', '#pw-toggle-edit-tags', function() {
        isEditingTags = !isEditingTags;
        const icon = isEditingTags ? 'fa-check' : 'fa-gear';
        const text = isEditingTags ? '完成' : '管理';
        $(this).html(`<i class="fa-solid ${icon}"></i> ${text}`);
        $('#pw-tags-list').html(renderTags());
    });

    $(document).on('click.pw', '.pw-tag', function(e) {
        if (isEditingTags) return; 
        e.preventDefault(); e.stopPropagation();
        const idx = $(this).data('idx');
        const tag = tagsCache[idx];
        const $text = $('#pw-request');
        const cur = $text.val();
        const insert = tag.value ? `${tag.name}: ${tag.value}` : `${tag.name}: `;
        const prefix = (cur && !cur.endsWith('\n')) ? '\n' : '';
        $text.val(cur + prefix + insert).focus();
        $text[0].scrollTop = $text[0].scrollHeight;
        saveCurrentState();
    });

    // 新增标签 (点击+)
    $(document).on('click.pw', '#pw-tag-quick-add', function(e) {
        e.stopPropagation();
        tagsCache.push({ name: "", value: "" });
        saveData();
        if (!isEditingTags) {
            isEditingTags = true;
            $('#pw-toggle-edit-tags').html(`<i class="fa-solid fa-check"></i> 完成`);
        }
        $('#pw-tags-list').html(renderTags());
        setTimeout(() => $('#pw-tags-list .t-name').last().focus(), 50);
    });

    $(document).on('input.pw', '.pw-tag-input', function() {
        const idx = $(this).data('idx');
        const isVal = $(this).hasClass('t-val');
        if (tagsCache[idx]) {
            if (isVal) tagsCache[idx].value = $(this).val();
            else tagsCache[idx].name = $(this).val();
            saveData();
        }
    });

    $(document).on('click.pw', '.fa-trash', function(e) {
        const idx = $(this).data('del-idx');
        if (idx !== undefined && confirm("确定删除此标签？")) {
            tagsCache.splice(idx, 1);
            saveData();
            $('#pw-tags-list').html(renderTags());
        }
    });

    // API 逻辑
    $('#pw-api-source').on('change', function() { $('#pw-indep-settings').toggle($(this).val() === 'independent'); });
    $('#pw-api-fetch').on('click', async function() {
        const btn = $(this);
        btn.html('<i class="fas fa-spinner fa-spin"></i>');
        const models = await fetchModels($('#pw-api-url').val(), $('#pw-api-key').val());
        btn.html('<i class="fa-solid fa-cloud-download-alt"></i>');
        if (models.length) {
            $('#pw-model-list').empty().append(models.map(m=>`<option value="${m}">`));
            toastr.success(TEXT.TOAST_API_OK);
        } else toastr.error(TEXT.TOAST_API_ERR);
    });
    $('#pw-api-save').on('click', () => { saveCurrentState(); toastr.success(TEXT.TOAST_SAVE_API); });

    // 工具栏
    $('#pw-clear').on('click', () => { if(confirm("清空输入内容？")) { $('#pw-request').val(''); $('#pw-result-area').hide(); saveCurrentState(); } });

    // [逻辑修复] 存入历史 - 强制 User + CurrentChar
    $('#pw-snapshot').on('click', () => {
        const req = $('#pw-request').val();
        const curName = $('#pw-res-name').val();
        const curDesc = $('#pw-res-desc').val();
        if (!req && !curName) return;
        
        const context = getContext();
        // 目标角色名 (强制单个)
        const charName = context.characters[context.characterId]?.name || "未知角色";
        // 玩家设定名
        const personaName = curName || "User";
        
        saveHistory({ 
            request: req || "无请求内容", 
            targetChar: charName,
            data: { 
                name: personaName, 
                description: curDesc || "", 
                wi_entry: $('#pw-res-wi').val(),
                // 强制标题格式：UserName & CharName
                customTitle: `${personaName} & ${charName}`
            } 
        });
        toastr.success(TEXT.TOAST_SNAPSHOT);
    });

    // 生成
    $('#pw-btn-gen').on('click', async function() {
        const req = $('#pw-request').val();
        const curName = $('#pw-res-name').val();
        const curDesc = $('#pw-res-desc').val();
        let fullReq = req;
        if (curName || curDesc) fullReq += `\n\n[Draft]:\nName: ${curName}\nDesc: ${curDesc}`;

        const $btn = $(this);
        const oldText = $btn.html();
        $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> ...');

        const wiContext = [];
        $('.pw-wi-check:checked').each(function() { wiContext.push(decodeURIComponent($(this).data('content'))); });

        const config = {
            request: fullReq, format: $('#pw-fmt-select').val(), wiContext,
            apiSource: $('#pw-api-source').val(),
            indepApiUrl: $('#pw-api-url').val(), indepApiKey: $('#pw-api-key').val(), indepApiModel: $('#pw-api-model').val()
        };

        try {
            const data = await runGeneration(config, config);
            $('#pw-res-name').val(data.name);
            $('#pw-res-desc').val(data.description);
            $('#pw-res-wi').val(data.wi_entry || data.description);
            $('#pw-result-area').fadeIn();
            
            const context = getContext();
            const charName = context.characters[context.characterId]?.name || "未知角色";
            const personaName = data.name || "User";
            data.customTitle = `${personaName} & ${charName}`;
            
            saveHistory({ request: req, targetChar: charName, data });
            saveCurrentState();
        } catch (e) { console.error(e); toastr.error(`${TEXT.TOAST_GEN_FAIL}: ${e.message}`); } 
        finally { $btn.prop('disabled', false).html(oldText); }
    });

    // 应用
    $('#pw-btn-apply').on('click', async function() {
        const name = $('#pw-res-name').val();
        const desc = $('#pw-res-desc').val();
        const wiContent = $('#pw-res-wi').val();
        if (!name) return toastr.warning("名字不能为空");
        
        const context = getContext();
        if (!context.powerUserSettings.personas) context.powerUserSettings.personas = {};
        context.powerUserSettings.personas[name] = desc;
        await saveSettingsDebounced();

        if ($('#pw-wi-toggle').is(':checked') && wiContent) {
            const books = await getContextWorldBooks();
            if (books.length > 0) {
                const book = books[0];
                try {
                    const r = await fetch('/api/worldinfo/get', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ name: book }) });
                    if (r.ok) {
                        const d = await r.json();
                        if (!d.entries) d.entries = {};
                        const ids = Object.keys(d.entries).map(Number);
                        const newId = ids.length ? Math.max(...ids) + 1 : 0;
                        d.entries[newId] = { uid: newId, key: [name, "User"], content: wiContent, comment: `User: ${name}`, enabled: true, selective: true };
                        await fetch('/api/worldinfo/edit', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ name: book, data: d }) });
                        toastr.success(`WI Updated: ${book}`);
                        if (context.updateWorldInfoList) context.updateWorldInfoList();
                    }
                } catch {}
            }
        }
        if (defaultSettings.autoSwitchPersona) {
            context.powerUserSettings.persona_selected = name;
            $("#your_name").val(name).trigger("input").trigger("change");
            $("#your_desc").val(desc).trigger("input").trigger("change");
        }
        toastr.success(TEXT.TOAST_SAVE_SUCCESS(name));
        $('.popup_close').click();
    });

    // 历史列表
    const renderHistoryList = () => {
        loadData();
        const $list = $('#pw-history-list').empty();
        const search = $('#pw-history-search').val().toLowerCase();
        const filtered = historyCache.filter(item => {
            if (!search) return true;
            return (item.data.customTitle||"").toLowerCase().includes(search) || 
                   (item.data.description||"").toLowerCase().includes(search) ||
                   (item.targetChar||"").toLowerCase().includes(search);
        });

        if (filtered.length === 0) return $list.html('<div style="text-align:center; opacity:0.6; padding:20px;">暂无历史记录</div>');

        filtered.forEach((item) => {
            const displayTitle = item.data.customTitle || "未命名 & 未知角色";
            const $el = $(`
                <div class="pw-history-item">
                    <div class="pw-hist-header">
                        <input class="pw-hist-title" value="${displayTitle}" readonly>
                        <div>
                            <i class="fa-solid fa-pencil pw-hist-edit-icon" style="opacity:0.5;cursor:pointer;margin-right:10px;"></i>
                            <i class="fa-solid fa-trash pw-hist-del" style="color:#ff6b6b;cursor:pointer;"></i>
                        </div>
                    </div>
                    <div class="pw-hist-meta">
                        <span><i class="fa-regular fa-clock"></i> ${item.timestamp || ''}</span>
                        <span><i class="fa-solid fa-user-tag"></i> ${item.targetChar || '未知'}</span>
                    </div>
                    <div class="pw-hist-desc">${item.data.description || item.request || ''}</div>
                </div>
            `);

            $el.on('click', function(e) {
                if ($(e.target).closest('.pw-hist-del, .pw-hist-edit-icon, input').length) return;
                $('#pw-request').val(item.request);
                $('#pw-res-name').val(item.data.name);
                $('#pw-res-desc').val(item.data.description);
                $('#pw-res-wi').val(item.data.wi_entry);
                $('#pw-result-area').show();
                $('.pw-tab[data-tab="editor"]').click();
            });

            // 编辑标题
            const $ti = $el.find('.pw-hist-title');
            $el.find('.pw-hist-edit-icon').on('click', function(e) {
                e.stopPropagation();
                if ($ti.attr('readonly')) $ti.removeAttr('readonly').addClass('editing').focus();
                else {
                    $ti.attr('readonly', true).removeClass('editing');
                    const realIndex = historyCache.indexOf(item);
                    if (realIndex > -1) updateHistoryTitle(realIndex, $ti.val());
                }
            });
            $ti.on('blur keydown', function(e) {
                if(e.type==='keydown' && e.key!=='Enter') return;
                if (!$ti.attr('readonly')) {
                    $ti.attr('readonly', true).removeClass('editing');
                    const realIndex = historyCache.indexOf(item);
                    if (realIndex > -1) updateHistoryTitle(realIndex, $ti.val());
                }
            });

            $el.find('.pw-hist-del').on('click', function(e) {
                e.stopPropagation();
                if(confirm("删除此记录？")) {
                    const idx = historyCache.indexOf(item);
                    if (idx > -1) { historyCache.splice(idx, 1); saveData(); renderHistoryList(); }
                }
            });
            $list.append($el);
        });
    };
    $(document).on('input.pw', '#pw-history-search', renderHistoryList);
    $(document).on('click.pw', '.pw-search-clear', function(){ $('#pw-history-search').val('').trigger('input'); });
    $(document).on('click.pw', '#pw-history-clear-all', function(){ if(confirm("清空历史？")) { historyCache=[]; saveData(); renderHistoryList(); } });

    // 世界书
    const renderWiBooks = async () => {
        const container = $('#pw-wi-container').empty();
        const baseBooks = await getContextWorldBooks();
        const allBooks = [...new Set([...baseBooks, ...window.pwExtraBooks])];
        if (!allBooks.length) return container.html('<div style="text-align:center;opacity:0.6;padding:10px;">暂无世界书</div>');

        for (const book of allBooks) {
            const isBound = baseBooks.includes(book);
            const $el = $(`
                <div class="pw-wi-book">
                    <div class="pw-wi-header">
                        <span><i class="fa-solid fa-book"></i> ${book} ${isBound?'<span style="opacity:0.5;font-size:0.8em;">(绑定)</span>':''}</span>
                        <div>${!isBound?'<i class="fa-solid fa-times remove-book" style="color:#ff6b6b;margin-right:10px;"></i>':''}<i class="fa-solid fa-chevron-down arrow"></i></div>
                    </div>
                    <div class="pw-wi-list" style="display:none;padding:10px;"></div>
                </div>
            `);
            $el.find('.remove-book').on('click', (e)=>{ e.stopPropagation(); window.pwExtraBooks=window.pwExtraBooks.filter(b=>b!==book); renderWiBooks(); });
            $el.find('.pw-wi-header').on('click', async function() {
                const $l = $el.find('.pw-wi-list');
                if ($l.is(':visible')) { $l.slideUp(); } else {
                    $l.slideDown();
                    if(!$l.data('loaded')) {
                        $l.html('<div style="text-align:center;"><i class="fas fa-spinner fa-spin"></i></div>');
                        const entries = await getWorldBookEntries(book);
                        $l.empty();
                        if(!entries.length) $l.html('<div style="opacity:0.5;">无条目</div>');
                        entries.forEach(e => {
                            $l.append(`<div style="padding:4px;"><input type="checkbox" class="pw-wi-check" ${e.enabled?'checked':''} data-content="${encodeURIComponent(e.content)}"> <b>${e.displayName}</b></div>`);
                        });
                        $l.data('loaded',true);
                    }
                }
            });
            container.append($el);
        }
    };
    renderWiBooks();
    $('#pw-wi-add').on('click', () => { const v=$('#pw-wi-select').val(); if(v && !window.pwExtraBooks.includes(v)) { window.pwExtraBooks.push(v); renderWiBooks(); } });
}

jQuery(async () => {
    injectStyles();
    $("#extensions_settings2").append(`
        <div class="world-info-cleanup-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header"><b>${TEXT.PANEL_TITLE}</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
                <div class="inline-drawer-content">
                    <div style="margin:10px 0;"><input id="pw_open_btn" class="menu_button" type="button" value="${TEXT.BTN_OPEN_MAIN}" style="width:100%;font-weight:bold;background:#5b8db8;color:#fff;" /></div>
                </div>
            </div>
        </div>
    `);
    $("#pw_open_btn").on("click", openCreatorPopup);
    console.log(`${extensionName} v10 loaded.`);
});
