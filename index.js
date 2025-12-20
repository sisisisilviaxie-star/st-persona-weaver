import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, callPopup, getRequestHeaders } from "../../../../script.js";

const extensionName = "st-persona-weaver";
const STORAGE_KEY_HISTORY = 'pw_history_v20';
const STORAGE_KEY_STATE = 'pw_state_v20'; 
const STORAGE_KEY_TAGS = 'pw_tags_v12';
const STORAGE_KEY_PROMPTS = 'pw_prompts_v1';
const BUTTON_ID = 'pw_persona_tool_btn';

const defaultTags = [
    { name: "性别", value: "" }, { name: "年龄", value: "" }, { name: "MBTI", value: "" },
    { name: "职业", value: "" }, { name: "阵营", value: "" }, { name: "外貌", value: "" },
    { name: "性格", value: "" }, { name: "关系", value: "" }, { name: "XP", value: "" },
    { name: "秘密", value: "" }
];

const defaultSystemPromptInitial = 
`Creating User Persona for {{user}} (Target: {{char}}).
{{wi}}
Traits: {{tags}}.
Instruction: {{input}}
Task: Generate character details strictly in "Key: Value" format (one per line). Do NOT add extra commentary, headers, or lists.
Example:
Age: 25
Personality: Calm
Response: ONLY the Key-Value list.`;

const defaultSystemPromptRefine = 
`Optimizing User Persona for {{char}}.
{{wi}}
[Current Data]:
"""{{current}}"""
[Instruction]: "{{input}}"
Task: Modify the data based on instruction. If text is quoted, focus on that part. Maintain strict "Key: Value" format.
Response: ONLY the modified full Key-Value list.`;

const defaultSettings = {
    autoSwitchPersona: true, syncToWorldInfo: false,
    historyLimit: 50, apiSource: 'main', 
    indepApiUrl: 'https://api.openai.com/v1', indepApiKey: '', indepApiModel: 'gpt-3.5-turbo'
};

const TEXT = {
    PANEL_TITLE: "用户设定编织者 Pro",
    BTN_TITLE: "打开设定生成器",
    TOAST_SAVE_SUCCESS: (name) => `Persona "${name}" 已保存并覆盖！`, // 已经是覆盖了
    TOAST_WI_SUCCESS: (book) => `已实时更新世界书: ${book}`,
    TOAST_WI_FAIL: "当前角色未绑定世界书，无法同步",
    TOAST_WI_ERROR: "TavernHelper API 未加载，无法写入世界书",
    TOAST_SNAPSHOT: "已存入历史记录"
};

let historyCache = [];
let tagsCache = [];
let promptsCache = { initial: defaultSystemPromptInitial, refine: defaultSystemPromptRefine };
let availableWorldBooks = []; 
let isEditingTags = false; 
let observer = null; // 全局 Observer 引用，用于防卡死

// ============================================================================
// 1. 核心数据解析逻辑 (Key-Value 强力清洗)
// ============================================================================

function parseTextToMap(text) {
    const map = new Map();
    if (!text) return map;
    const lines = text.split('\n');
    
    lines.forEach((line) => {
        if (!line.trim()) return;
        const idx = line.indexOf(':');
        if (idx === -1) return; // 只处理包含冒号的行

        let rawKey = line.substring(0, idx).trim();
        // [修复] 更严格的 Key 清洗：移除所有非字母、数字、中文、空格的字符
        // \p{L} 匹配任何字母，\p{N} 匹配任何数字 (需要 'u' 标志 for Unicode property escapes)
        let cleanKey = rawKey.replace(/[^\p{L}\p{N}\s]/gu, '').trim(); 
        let val = line.substring(idx + 1).trim();

        if (cleanKey && val) {
            map.set(cleanKey, val);
        }
    });
    return map;
}

async function collectActiveWorldInfoContent() {
    let content = [];
    try {
        const boundBooks = await getContextWorldBooks();
        const manualBooks = window.pwExtraBooks || [];
        const allBooks = [...new Set([...boundBooks, ...manualBooks])];
        
        for (const bookName of allBooks) {
            const entries = await getWorldBookEntries(bookName);
            const enabledEntries = entries.filter(e => e.enabled);
            if (enabledEntries.length > 0) {
                content.push(`\n--- World Book: ${bookName} ---`);
                enabledEntries.forEach(e => {
                    content.push(`[Entry: ${e.displayName}]\n${e.content}`);
                });
            }
        }
    } catch (e) { console.error("Error collecting WI content:", e); }
    return content;
}

// ============================================================================
// 2. 存储与系统函数
// ============================================================================

function loadData() {
    try { historyCache = JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY)) || []; } catch { historyCache = []; }
    try { tagsCache = JSON.parse(localStorage.getItem(STORAGE_KEY_TAGS)) || defaultTags; } catch { tagsCache = defaultTags; }
    try { 
        const p = JSON.parse(localStorage.getItem(STORAGE_KEY_PROMPTS));
        promptsCache = { ...{ initial: defaultSystemPromptInitial, refine: defaultSystemPromptRefine }, ...p };
    } catch { promptsCache = { initial: defaultSystemPromptInitial, refine: defaultSystemPromptRefine }; }
}

function saveData() {
    localStorage.setItem(STORAGE_KEY_TAGS, JSON.stringify(tagsCache));
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(historyCache));
    localStorage.setItem(STORAGE_KEY_PROMPTS, JSON.stringify(promptsCache));
}

function saveHistory(item) {
    const limit = extension_settings[extensionName]?.historyLimit || 50;
    historyCache.unshift(item);
    if (historyCache.length > limit) historyCache = historyCache.slice(0, limit);
    saveData();
}

function saveState(data) { localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(data)); }
function loadState() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY_STATE)) || {}; } catch { return {}; } }

function injectStyles() {
    const styleId = 'persona-weaver-css-v20'; // 更新版本号，确保 CSS 刷新
    if ($(`#${styleId}`).length) return;
}

async function forceSavePersona(name, description) {
    const context = getContext();
    if (!context.powerUserSettings.personas) context.powerUserSettings.personas = {};
    context.powerUserSettings.personas[name] = description;
    context.powerUserSettings.persona_selected = name;
    
    const $nameInput = $('#your_name');
    const $descInput = $('#persona_description');
    if ($nameInput.length) $nameInput.val(name).trigger('input').trigger('change');
    if ($descInput.length) $descInput.val(description).trigger('input').trigger('change');
    
    const $h5Name = $('h5#your_name');
    if ($h5Name.length) $h5Name.text(name);

    await saveSettingsDebounced();
    return true;
}

// [修复] 使用 TavernHelper 同步世界书，实现实时更新
async function syncToWorldInfoViaHelper(userName, content) {
    if (!window.TavernHelper || !window.TavernHelper.getCharWorldbookNames || !window.TavernHelper.getLorebookEntries) {
        toastr.error(TEXT.TOAST_WI_ERROR);
        return;
    }

    let targetBook = null;
    try {
        const charBooks = window.TavernHelper.getCharWorldbookNames('current');
        if (charBooks && charBooks.primary) {
            targetBook = charBooks.primary;
        } else if (charBooks && charBooks.additional && charBooks.additional.length > 0) {
            targetBook = charBooks.additional[0]; // 降级：如果没有主书，用第一本附加书
        }
    } catch (e) { console.warn("[PW] Failed to get char books via helper", e); }

    if (!targetBook) {
        toastr.warning(TEXT.TOAST_WI_FAIL);
        return;
    }

    try {
        const entries = await window.TavernHelper.getLorebookEntries(targetBook);
        const entryComment = `User: ${userName}`;
        const existingEntry = entries.find(e => e.comment === entryComment);

        if (existingEntry) {
            // === 更新逻辑 ===
            // TavernHelper.setLorebookEntries 会根据 UID 更新现有条目
            await window.TavernHelper.setLorebookEntries(targetBook, [{
                uid: existingEntry.uid,
                content: content,
                enabled: true // 确保它是启用的
            }]);
            console.log(`[PW] Updated entry ${existingEntry.uid} in ${targetBook}`);
        } else {
            // === 创建逻辑 ===
            // TavernHelper.createLorebookEntries 会创建新条目并返回 UID
            await window.TavernHelper.createLorebookEntries(targetBook, [{
                comment: entryComment,
                keys: [userName, "User Persona"], // 可以添加更具体的关键词
                content: content,
                enabled: true,
                selective: true, // 绿灯条目，需要关键词激活
                position: { // 默认插入位置
                    type: 'after_character_definition',
                    role: 'system',
                    depth: 0,
                    order: 0
                }
            }]);
            console.log(`[PW] Created new entry in ${targetBook}`);
        }
        
        toastr.success(TEXT.TOAST_WI_SUCCESS(targetBook));
    } catch (e) {
        console.error("[PW] TavernHelper Sync Error:", e);
        toastr.error("同步世界书时发生错误，请查看控制台");
    }
}


async function loadAvailableWorldBooks() {
    availableWorldBooks = [];
    if (window.TavernHelper && typeof window.TavernHelper.getWorldbookNames === 'function') {
        try { availableWorldBooks = window.TavernHelper.getWorldbookNames(); } catch {}
    }
    // 降级方案，保留以防 TavernHelper 不可用
    if (availableWorldBooks.length === 0 && window.world_names && Array.isArray(window.world_names)) {
        availableWorldBooks = window.world_names;
    }
    if (availableWorldBooks.length === 0) {
        try {
            const r = await fetch('/api/worldinfo/get', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({}) });
            if (r.ok) { const d = await r.json(); availableWorldBooks = d.world_names || d; }
        } catch (e) {}
    }
    availableWorldBooks = [...new Set(availableWorldBooks)].filter(x => x).sort();
}

async function getContextWorldBooks(extras = []) {
    const context = getContext();
    const books = new Set(extras); 
    const charId = context.characterId;
    if (charId !== undefined && context.characters[charId]) {
        const char = context.characters[charId];
        const data = char.data || char;
        if (data.character_book?.name) books.add(data.character_book.name);
        if (data.extensions?.world) books.add(data.extensions.world);
        if (data.world) books.add(data.world);
        if (context.chatMetadata?.world_info) books.add(context.chatMetadata.world_info);
    }
    return Array.from(books).filter(Boolean);
}

// [更新] 读取世界书条目，优先使用 TavernHelper
async function getWorldBookEntries(bookName) {
    if (window.TavernHelper && typeof window.TavernHelper.getLorebookEntries === 'function') {
        try {
             const entries = await window.TavernHelper.getLorebookEntries(bookName);
             return entries.map(e => ({
                uid: e.uid,
                displayName: e.comment || (Array.isArray(e.keys) ? e.keys.join(', ') : e.keys) || "无标题",
                content: e.content || "",
                enabled: e.enabled
             }));
        } catch(e) { /* Fallback to legacy API if helper fails */ }
    }

    // 旧版 API 降级方案
    let entriesData = null;
    if (window.SillyTavern && typeof window.SillyTavern.loadWorldInfo === 'function') {
        try {
            const data = await window.SillyTavern.loadWorldInfo(bookName);
            if (data) entriesData = data.entries;
        } catch (e) { console.warn("[PW] ST loadWorldInfo error:", e); }
    }
    if (!entriesData) {
        try {
            const headers = getRequestHeaders();
            const response = await fetch('/api/worldinfo/get', { method: 'POST', headers, body: JSON.stringify({ name: bookName }) });
            if (response.ok) {
                const data = await response.json();
                entriesData = data.entries;
            }
        } catch (e) { console.error("[PW] API fetch error:", e); }
    }
    if (entriesData) {
        return Object.values(entriesData).map(e => ({
            uid: e.uid,
            displayName: e.comment || (Array.isArray(e.key) ? e.key.join(', ') : e.key) || "无标题",
            content: e.content || "",
            enabled: !e.disable && e.enabled !== false
        }));
    }
    return [];
}

async function runGeneration(data, apiConfig) {
    const context = getContext();
    const charId = context.characterId;
    const charName = (charId !== undefined) ? context.characters[charId].name : "None";
    const currentName = $('.persona_name').first().text().trim() || $('h5#your_name').text().trim() || "User";

    let wiText = "";
    if (data.wiContext && data.wiContext.length > 0) {
        wiText = `\n[Context from World Info]:\n${data.wiContext.join('\n')}\n`;
    }

    const tagsList = tagsCache.map(t => t.name).join(', ');
    
    let systemTemplate = data.mode === 'refine' ? promptsCache.refine : promptsCache.initial;
    
    let systemPrompt = systemTemplate
        .replace(/{{user}}/g, currentName)
        .replace(/{{char}}/g, charName)
        .replace(/{{wi}}/g, wiText)
        .replace(/{{tags}}/g, tagsList)
        .replace(/{{input}}/g, data.request)
        .replace(/{{current}}/g, data.currentText || "");

    let responseContent = "";
    if (apiConfig.apiSource === 'independent') {
        const res = await fetch(`${apiConfig.indepApiUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.indepApiKey}` },
            body: JSON.stringify({ model: apiConfig.indepApiModel, messages: [{ role: 'system', content: systemPrompt }], temperature: 0.7 })
        });
        const json = await res.json();
        responseContent = json.choices[0].message.content;
    } else {
        responseContent = await context.generateQuietPrompt(systemPrompt, false, false, "System");
    }
    return responseContent.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
}

// ============================================================================
// 3. UI 渲染 logic
// ============================================================================

async function openCreatorPopup() {
    const context = getContext();
    loadData();
    await loadAvailableWorldBooks();
    const savedState = loadState();
    const config = { ...defaultSettings, ...extension_settings[extensionName], ...savedState.localConfig };
    
    let currentName = $('.persona_name').first().text().trim();
    if (!currentName) currentName = $('h5#your_name').text().trim();
    if (!currentName) currentName = context.powerUserSettings?.persona_selected || "User";

    const wiChecked = savedState.wiSyncChecked !== undefined ? savedState.wiSyncChecked : false;

    const renderBookOptions = () => {
        if (availableWorldBooks.length > 0) {
            return availableWorldBooks.map(b => `<option value="${b}">${b}</option>`).join('');
        }
        return `<option disabled>未找到世界书</option>`;
    };

    const html = `
    <div class="pw-wrapper">
        <div class="pw-header">
            <div class="pw-top-bar"><div class="pw-title"><i class="fa-solid fa-wand-magic-sparkles" style="color:#e0af68;"></i> 设定编织者 Pro</div></div>
            <div class="pw-tabs">
                <div class="pw-tab active" data-tab="editor">编辑</div>
                <div class="pw-tab" data-tab="context">世界书</div>
                <div class="pw-tab" data-tab="api">API & Prompt</div>
                <div class="pw-tab" data-tab="history">历史</div>
            </div>
        </div>

        <div id="pw-view-editor" class="pw-view active ${!savedState.hasResult ? 'initial-state' : ''}"> <!-- [更新] 添加 initial-state 类 -->
            <div class="pw-scroll-area">
                <div class="pw-info-display"><div class="pw-info-item"><i class="fa-solid fa-user"></i><span id="pw-display-name">${currentName}</span></div></div>

                <div>
                    <div class="pw-tags-header"><span class="pw-tags-label">快速设定 (点击填入)</span><span class="pw-tags-edit-toggle" id="pw-toggle-edit-tags">编辑标签</span></div>
                    <div class="pw-tags-container" id="pw-tags-list"></div>
                </div>

                <textarea id="pw-request" class="pw-textarea" placeholder="在此输入初始设定要求...">${savedState.request || ''}</textarea>
                <button id="pw-btn-gen" class="pw-btn gen">生成设定</button>

                <div id="pw-result-area" style="display:${savedState.hasResult ? 'block' : 'none'}; margin-top:15px;">
                    <div class="pw-relative-container">
                        <textarea id="pw-result-text" class="pw-result-textarea" placeholder="生成的结果将显示在这里..."></textarea>
                    </div>
                    
                    <div class="pw-refine-toolbar">
                        <textarea id="pw-refine-input" class="pw-refine-input" placeholder="输入润色意见..."></textarea>
                        <div class="pw-refine-actions">
                            <div class="pw-tool-btn" id="pw-btn-refine" title="执行润色"><i class="fa-solid fa-magic"></i> 润色</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- [更新] 底部 Footer 重构 -->
            <div class="pw-footer">
                <div class="pw-footer-group">
                    <div class="pw-compact-btn danger" id="pw-clear" title="清空"><i class="fa-solid fa-eraser"></i></div>
                    <div class="pw-compact-btn" id="pw-snapshot" title="存入历史"><i class="fa-solid fa-save"></i></div>
                </div>
                <div class="pw-footer-group">
                    <div class="pw-wi-sync-toggle ${wiChecked ? 'active' : ''}" id="pw-wi-sync-btn" title="同步到世界书 (仅限绑定书)"><i class="fa-solid fa-book-medical"></i></div>
                    <div class="pw-footer-main-btn" id="pw-btn-apply"><i class="fa-solid fa-check"></i> 保存并覆盖</div>
                </div>
            </div>
        </div>

        <div id="pw-diff-overlay" class="pw-diff-container" style="display:none;">
            <div class="pw-diff-header">润色对比 (点击选择保留项)</div>
            <div class="pw-diff-scroll" id="pw-diff-list"></div>
            <div class="pw-diff-actions">
                <button class="pw-btn danger" id="pw-diff-cancel">放弃修改</button>
                <button class="pw-btn save" id="pw-diff-confirm">应用已选修改</button>
            </div>
        </div>

        <!-- [更新] 悬浮引用按钮位置 -->
        <div id="pw-float-quote-btn" class="pw-float-quote-btn"><i class="fa-solid fa-pen-to-square"></i> 修改此段</div>

        <div id="pw-view-context" class="pw-view"><div class="pw-scroll-area"><div class="pw-card-section"><div class="pw-wi-controls"><select id="pw-wi-select" class="pw-input pw-wi-select"><option value="">-- 添加参考/目标世界书 --</option>${renderBookOptions()}</select><button id="pw-wi-refresh" class="pw-btn primary pw-wi-refresh-btn"><i class="fa-solid fa-sync"></i></button><button id="pw-wi-add" class="pw-btn primary pw-wi-add-btn"><i class="fa-solid fa-plus"></i></button></div></div><div id="pw-wi-container"></div></div></div>
        
        <div id="pw-view-api" class="pw-view">
            <div class="pw-scroll-area">
                <div class="pw-card-section">
                    <div class="pw-row"><label>API 来源</label><select id="pw-api-source" class="pw-input" style="flex:1;"><option value="main" ${config.apiSource === 'main'?'selected':''}>主 API</option><option value="independent" ${config.apiSource === 'independent'?'selected':''}>独立 API</option></select></div>
                    <div id="pw-indep-settings" style="display:${config.apiSource === 'independent' ? 'flex' : 'none'}; flex-direction:column; gap:15px;">
                        <div class="pw-row"><label>URL</label><input type="text" id="pw-api-url" class="pw-input" value="${config.indepApiUrl}" style="flex:1;"></div>
                        <div class="pw-row"><label>Key</label><input type="password" id="pw-api-key" class="pw-input" value="${config.indepApiKey}" style="flex:1;"></div>
                        <div class="pw-row"><label>Model</label><div style="flex:1; display:flex; gap:5px; width:100%;"><input type="text" id="pw-api-model" class="pw-input" value="${config.indepApiModel}" list="pw-model-list" style="flex:1;"><datalist id="pw-model-list"></datalist><button id="pw-api-fetch" class="pw-btn primary pw-api-fetch-btn" title="获取模型" style="width:auto;"><i class="fa-solid fa-cloud-download-alt"></i></button></div></div>
                    </div>
                </div>

                <div class="pw-card-section pw-prompt-editor-block">
                    <div style="display:flex; justify-content:space-between;"><span class="pw-prompt-label">初始生成指令 (System Prompt)</span><button class="pw-mini-btn" id="pw-reset-prompts" style="font-size:0.7em;">恢复默认</button></div>
                    <div class="pw-var-btns">
                        <div class="pw-var-btn" data-ins="{{user}}">User名</div>
                        <div class="pw-var-btn" data-ins="{{char}}">Char名</div>
                        <div class="pw-var-btn" data-ins="{{tags}}">标签列表</div>
                        <div class="pw-var-btn" data-ins="{{input}}">用户要求</div>
                        <div class="pw-var-btn" data-ins="{{wi}}">世界书内容</div>
                    </div>
                    <textarea id="pw-prompt-initial" class="pw-textarea" style="height:150px; font-size:0.85em;">${promptsCache.initial}</textarea>
                    
                    <span class="pw-prompt-label" style="margin-top:10px;">润色指令 (System Prompt)</span>
                    <div class="pw-var-btns">
                        <div class="pw-var-btn" data-ins="{{current}}">当前文本</div>
                        <div class="pw-var-btn" data-ins="{{input}}">润色意见</div>
                    </div>
                    <textarea id="pw-prompt-refine" class="pw-textarea" style="height:150px; font-size:0.85em;">${promptsCache.refine}</textarea>
                </div>
                <div style="text-align:right; margin-top:5px;"><button id="pw-api-save" class="pw-btn primary" style="width:100%;">保存设置 & Prompts</button></div>
            </div>
        </div>

        <div id="pw-view-history" class="pw-view"><div class="pw-scroll-area"><div class="pw-search-box"><i class="fa-solid fa-search pw-search-icon"></i><input type="text" id="pw-history-search" class="pw-input pw-search-input" placeholder="搜索历史..."><i class="fa-solid fa-times pw-search-clear" id="pw-history-search-clear" title="清空搜索"></i></div><div id="pw-history-list" style="display:flex; flex-direction:column;"></div><button id="pw-history-clear-all" class="pw-btn danger">清空所有历史</button></div></div>
    </div>
    `;

    callPopup(html, 'text', '', { wide: true, large: true, okButton: "关闭" });
    bindEvents();
    renderTagsList();
    renderWiBooks();
    
    if (savedState.resultText) {
        $('#pw-result-text').val(savedState.resultText);
        $('#pw-result-area').show().addClass('active'); // [更新] 添加 active 类
        setTimeout(() => {
            const el = document.getElementById('pw-refine-input');
            if(el) { el.style.height = 'auto'; el.style.height = (el.scrollHeight) + 'px'; }
        }, 100);
    }
}

// ============================================================================
// 4. 事件绑定 (防卡死优化)
// ============================================================================

function bindEvents() {
    $(document).off('.pw'); // 确保每次打开弹窗时，旧的事件监听器被移除

    const adjustHeight = (el) => { 
        el.style.height = 'auto'; 
        el.style.height = (el.scrollHeight) + 'px'; 
    };

    $(document).on('input.pw', '#pw-refine-input', function() { adjustHeight(this); });

    $(document).on('click.pw', '.pw-tab', function() {
        $('.pw-tab').removeClass('active'); $(this).addClass('active');
        $('.pw-view').removeClass('active');
        $(`#pw-view-${$(this).data('tab')}`).addClass('active');
        if($(this).data('tab') === 'history') renderHistoryList(); 
    });

    $(document).on('click.pw', '.pw-var-btn', function() {
        const ins = $(this).data('ins');
        const $activeText = $(this).parent().next('textarea'); 
        if ($activeText.length) {
            const el = $activeText[0];
            const start = el.selectionStart;
            const end = el.selectionEnd;
            const val = el.value;
            el.value = val.substring(0, start) + ins + val.substring(end);
            el.selectionStart = el.selectionEnd = start + ins.length;
            el.focus();
        }
    });

    const checkSelection = () => {
        const el = document.getElementById('pw-result-text');
        if (!el) return;
        const hasSelection = el.selectionStart !== el.selectionEnd;
        if (hasSelection) $('#pw-float-quote-btn').fadeIn(200).css('display', 'flex');
        else $('#pw-float-quote-btn').fadeOut(200);
    };
    $(document).on('touchend mouseup keyup', '#pw-result-text', checkSelection);

    $(document).on('click.pw', '#pw-float-quote-btn', function(e) {
        e.preventDefault(); e.stopPropagation();
        const textarea = document.getElementById('pw-result-text');
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selectedText = textarea.value.substring(start, end).trim();
        if (selectedText) {
            const $input = $('#pw-refine-input');
            const cur = $input.val();
            const newText = `将 "${selectedText}" 修改为: `;
            $input.val(cur ? cur + '\n' + newText : newText).focus();
            adjustHeight($input[0]);
            textarea.setSelectionRange(end, end);
            checkSelection();
        }
    });

    // 防抖保存，减少卡顿
    let saveTimeout;
    const saveCurrentState = () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            saveState({
                request: $('#pw-request').val(),
                resultText: $('#pw-result-text').val(),
                hasResult: $('#pw-result-area').is(':visible'),
                wiSyncChecked: $('#pw-wi-sync-btn').hasClass('active'),
                localConfig: {
                    apiSource: $('#pw-api-source').val(),
                    indepApiUrl: $('#pw-api-url').val(),
                    indepApiKey: $('#pw-api-key').val(),
                    indepApiModel: $('#pw-api-model').val(),
                    extraBooks: window.pwExtraBooks || []
                }
            });
        }, 500); // 500ms 防抖
    };
    $(document).on('input.pw change.pw', '#pw-request, #pw-result-text, #pw-wi-toggle, .pw-input', saveCurrentState);

    // 润色 (Diff)
    $(document).on('click.pw', '#pw-btn-refine', async function() {
        const refineReq = $('#pw-refine-input').val();
        if (!refineReq) return toastr.warning("请输入润色意见");
        const oldText = $('#pw-result-text').val();
        const $btn = $(this).html('<i class="fas fa-spinner fa-spin"></i>');

        try {
            const wiContent = await collectActiveWorldInfoContent();
            const config = { mode: 'refine', request: refineReq, currentText: oldText, wiContext: wiContent, apiSource: $('#pw-api-source').val(), indepApiUrl: $('#pw-api-url').val(), indepApiKey: $('#pw-api-key').val(), indepApiModel: $('#pw-api-model').val() };
            const responseText = await runGeneration(config, config);
            
            const oldMap = parseTextToMap(oldText);
            const newMap = parseTextToMap(responseText);
            const allCleanedKeys = [...new Set([...oldMap.keys(), ...newMap.keys()])]; // keys() 返回的已经是 cleanKey

            const $list = $('#pw-diff-list').empty();
            let changeCount = 0;

            allCleanedKeys.forEach(cleanedKey => { // 直接使用 cleanedKey
                const valOld = oldMap.get(cleanedKey) || ""; 
                const valNew = newMap.get(cleanedKey) || ""; 
                
                const isChanged = valOld.trim() !== valNew.trim();
                if (isChanged) changeCount++;
                if (!valOld && !valNew) return;

                let optionsHtml = '';
                if (!isChanged) {
                    optionsHtml = `<div class="pw-diff-options"><div class="pw-diff-opt single-view selected" data-val="${valNew}"><span class="pw-diff-opt-label">无变更</span><div class="pw-diff-opt-text">${valNew}</div></div></div>`;
                } else {
                    optionsHtml = `
                        <div class="pw-diff-options">
                            <div class="pw-diff-opt old diff-active" data-val="${valOld}"><span class="pw-diff-opt-label">原版本</span><div class="pw-diff-opt-text">${valOld || "(无)"}</div></div>
                            <div class="pw-diff-opt new selected diff-active" data-val="${valNew}"><span class="pw-diff-opt-label">新版本</span><div class="pw-diff-opt-text">${valNew || "(删除)"}</div></div>
                        </div>`;
                }
                // [修复] diff-row 的 data-key 和 attr-name 都使用 cleanedKey
                const $row = $(`<div class="pw-diff-row" data-key="${cleanedKey}"><div class="pw-diff-attr-name">${cleanedKey}</div>${optionsHtml}<div class="pw-diff-edit-area"><textarea class="pw-diff-custom-input" placeholder="可微调...">${valNew}</textarea></div></div>`);
                $list.append($row);
            });

            if (changeCount === 0) toastr.info("AI 认为无需修改");
            $('#pw-diff-overlay').fadeIn();
            $('#pw-refine-input').val(''); adjustHeight($('#pw-refine-input')[0]);
        } catch (e) { toastr.error(e.message); }
        finally { $btn.html('润色'); }
    });

    $(document).on('click.pw', '.pw-diff-opt:not(.single-view)', function() {
        $(this).siblings().removeClass('selected'); $(this).addClass('selected');
        const val = $(this).data('val'); $(this).closest('.pw-diff-row').find('.pw-diff-custom-input').val(val);
    });

    $(document).on('click.pw', '#pw-diff-confirm', function() {
        let finalLines = [];
        $('.pw-diff-row').each(function() {
            const key = $(this).data('key'); // 这里已经是 cleanedKey
            const val = $(this).find('.pw-diff-custom-input').val().trim();
            if (!val) return;
            finalLines.push(`${key}: ${val}`);
        });
        $('#pw-result-text').val(finalLines.join('\n'));
        $('#pw-diff-overlay').fadeOut();
        saveCurrentState(); 
        toastr.success("修改已应用");
    });

    $(document).on('click.pw', '#pw-diff-cancel', () => $('#pw-diff-overlay').fadeOut());

    $(document).on('click.pw', '#pw-btn-gen', async function() {
        const req = $('#pw-request').val();
        if (!req) return toastr.warning("请输入要求");
        const $btn = $(this).prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i>');
        try {
            const wiContent = await collectActiveWorldInfoContent();
            const config = { mode: 'initial', request: req, wiContext: wiContent, apiSource: $('#pw-api-source').val(), indepApiUrl: $('#pw-api-url').val(), indepApiKey: $('#pw-api-key').val(), indepApiModel: $('#pw-api-model').val() };
            const text = await runGeneration(config, config);
            $('#pw-result-text').val(text);
            $('#pw-result-area').fadeIn().addClass('active'); // [更新] 添加 active 类
            $('#pw-view-editor').removeClass('initial-state'); // [更新] 移除 initial-state 类
            saveCurrentState();
        } catch (e) { toastr.error(e.message); } 
        finally { $btn.prop('disabled', false).html('生成设定'); }
    });

    $(document).on('click.pw', '#pw-wi-sync-btn', function() {
        $(this).toggleClass('active');
        saveCurrentState();
    });

    $(document).on('click.pw', '#pw-btn-apply', async function() {
        const content = $('#pw-result-text').val();
        if (!content) return toastr.warning("内容为空");
        const name = $('.persona_name').first().text().trim() || $('h5#your_name').text().trim() || "User";

        await forceSavePersona(name, content);
        toastr.success(TEXT.TOAST_SAVE_SUCCESS(name));

        if ($('#pw-wi-sync-btn').hasClass('active')) {
            await syncToWorldInfoViaHelper(name, content);
        }
        $('.popup_close').click();
    });

    $(document).on('click.pw', '#pw-clear', function() {
        if(confirm("确定清空？")) { 
            $('#pw-request').val(''); 
            $('#pw-result-area').hide().removeClass('active'); // [更新] 移除 active 类
            $('#pw-view-editor').addClass('initial-state'); // [更新] 添加 initial-state 类
            $('#pw-result-text').val(''); 
            saveCurrentState(); 
        }
    });
    
    $(document).on('click.pw', '#pw-snapshot', function() {
        const text = $('#pw-result-text').val();
        if (!text) return toastr.warning("内容为空");
        const context = getContext();
        const userName = $('.persona_name').first().text().trim() || "User";
        const charName = context.characters[context.characterId]?.name || "";
        const defaultTitle = `${userName} + ${charName} (${new Date().toLocaleDateString()})`;
        saveHistory({ request: $('#pw-request').val() || "无", timestamp: new Date().toLocaleString(), title: defaultTitle, data: { name: userName, resultText: text } });
        toastr.success(TEXT.TOAST_SNAPSHOT);
    });

    $(document).on('blur.pw', '.pw-hist-title-edit', function() {
        const newTitle = $(this).val();
        const index = $(this).data('index');
        if (historyCache[index]) { historyCache[index].title = newTitle; saveData(); }
    });

    $(document).on('click.pw', '#pw-toggle-edit-tags', () => { isEditingTags = !isEditingTags; renderTagsList(); });
    $(document).on('change.pw', '#pw-api-source', function() { $('#pw-indep-settings').toggle($(this).val() === 'independent'); });
    $(document).on('click.pw', '#pw-api-fetch', async function() { /* same */ });
    
    $(document).on('click.pw', '#pw-api-save', () => { 
        promptsCache.initial = $('#pw-prompt-initial').val();
        promptsCache.refine = $('#pw-prompt-refine').val();
        saveData(); 
        toastr.success("设置与Prompt已保存"); 
    });
    $(document).on('click.pw', '#pw-reset-prompts', () => {
        if(confirm("重置所有 Prompt 为默认？")) {
            $('#pw-prompt-initial').val(defaultSystemPromptInitial);
            $('#pw-prompt-refine').val(defaultSystemPromptRefine);
            toastr.info("已恢复默认，请点击保存");
        }
    });

    $(document).on('click.pw', '#pw-wi-refresh', async () => {
        const btn = $(this); btn.find('i').addClass('fa-spin');
        await loadAvailableWorldBooks();
        const options = availableWorldBooks.length > 0 ? availableWorldBooks.map(b => `<option value="${b}">${b}</option>`).join('') : `<option disabled>未找到世界书</option>`;
        $('#pw-wi-select').html(`<option value="">-- 添加参考/目标世界书 --</option>${options}`);
        btn.find('i').removeClass('fa-spin'); toastr.success("已刷新");
    });
    $(document).on('click.pw', '#pw-wi-add', () => { const val = $('#pw-wi-select').val(); if (val && !window.pwExtraBooks.includes(val)) { window.pwExtraBooks.push(val); renderWiBooks(); } });
    $(document).on('input.pw', '#pw-history-search', renderHistoryList);
    $(document).on('click.pw', '#pw-history-search-clear', function() { $('#pw-history-search').val('').trigger('input'); });
    $(document).on('click.pw', '#pw-history-clear-all', function() { if(confirm("清空?")){historyCache=[];saveData();renderHistoryList();} });
}

// ... 辅助渲染函数 (Tags, History, WiBooks) 保持基本不变 ...
const renderTagsList = () => {
    const $container = $('#pw-tags-list').empty();
    const $toggleBtn = $('#pw-toggle-edit-tags');
    $toggleBtn.text(isEditingTags ? '取消编辑' : '编辑标签');
    $toggleBtn.css('color', isEditingTags ? '#ff6b6b' : '#5b8db8');
    tagsCache.forEach((tag, index) => {
        if (isEditingTags) {
            const $row = $(`<div class="pw-tag-edit-row"><input class="pw-tag-edit-input t-name" value="${tag.name}"><input class="pw-tag-edit-input t-val" value="${tag.value}"><div class="pw-tag-del-btn"><i class="fa-solid fa-trash"></i></div></div>`);
            $row.find('input').on('input', function() { tag.name = $row.find('.t-name').val(); tag.value = $row.find('.t-val').val(); saveData(); });
            $row.find('.pw-tag-del-btn').on('click', () => { if (confirm("删除?")) { tagsCache.splice(index, 1); saveData(); renderTagsList(); } });
            $container.append($row);
        } else {
            const $chip = $(`<div class="pw-tag-chip"><i class="fa-solid fa-tag" style="opacity:0.5; margin-right:4px;"></i><span>${tag.name}</span>${tag.value ? `<span class="pw-tag-val">${tag.value}</span>` : ''}</div>`);
            $chip.on('click', () => {
                const $text = $('#pw-request');
                const cur = $text.val();
                const prefix = (cur && !cur.endsWith('\n')) ? '\n' : '';
                $text.val(cur + prefix + (tag.value ? `${tag.name}: ${tag.value}` : `${tag.name}: `)).focus();
            });
            $container.append($chip);
        }
    });
    const $addBtn = $(`<div class="pw-tag-add-btn"><i class="fa-solid fa-plus"></i> ${isEditingTags ? '新增' : '标签'}</div>`);
    $addBtn.on('click', () => { tagsCache.push({ name: "", value: "" }); saveData(); if (!isEditingTags) isEditingTags = true; renderTagsList(); });
    $container.append($addBtn);
    if (isEditingTags) { const $finishBtn = $(`<div class="pw-tags-finish-bar"><i class="fa-solid fa-check"></i> 完成编辑</div>`); $finishBtn.on('click', () => { isEditingTags = false; renderTagsList(); }); $container.append($finishBtn); }
};

const renderHistoryList = () => {
    loadData();
    const $list = $('#pw-history-list').empty();
    const search = $('#pw-history-search').val().toLowerCase();
    const filtered = historyCache.filter(item => {
        if (!search) return true;
        const content = (item.data.resultText || "").toLowerCase();
        const title = (item.title || "").toLowerCase();
        return title.includes(search) || content.includes(search);
    });
    if (filtered.length === 0) { $list.html('<div style="text-align:center; opacity:0.6; padding:20px;">暂无历史记录</div>'); return; }
    
    filtered.forEach((item, index) => {
        const previewText = item.data.resultText || '无内容';
        const displayTitle = item.title || "未命名";
        
        const $el = $(`
            <div class="pw-history-item">
                <div class="pw-hist-main">
                    <div class="pw-hist-header">
                        <input type="text" class="pw-hist-title-edit" value="${displayTitle}" data-index="${index}" onclick="event.stopPropagation()">
                    </div>
                    <div class="pw-hist-meta"><span>${item.timestamp || ''}</span></div>
                    <div class="pw-hist-desc">${previewText}</div>
                </div>
                <div class="pw-hist-del-btn"><i class="fa-solid fa-trash"></i></div>
            </div>
        `);
        $el.on('click', function(e) {
            if ($(e.target).closest('.pw-hist-del-btn, .pw-hist-title-edit').length) return;
            $('#pw-request').val(item.request); 
            $('#pw-result-text').val(previewText); 
            $('#pw-result-area').show().addClass('active'); // [更新] 添加 active 类
            $('#pw-view-editor').removeClass('initial-state'); // [更新] 移除 initial-state 类
            $('.pw-tab[data-tab="editor"]').click();
        });
        $el.find('.pw-hist-del-btn').on('click', function(e) { e.stopPropagation(); if(confirm("删除?")) { historyCache.splice(historyCache.indexOf(item), 1); saveData(); renderHistoryList(); } });
        $list.append($el);
    });
};

window.pwExtraBooks = [];
const renderWiBooks = async () => { const container = $('#pw-wi-container').empty(); const baseBooks = await getContextWorldBooks(); const allBooks = [...new Set([...baseBooks, ...(window.pwExtraBooks || [])])]; if (allBooks.length === 0) { container.html('<div style="opacity:0.6; padding:10px; text-align:center;">此角色未绑定世界书，请在“世界书”标签页手动添加或在酒馆主界面绑定。</div>'); return; } for (const book of allBooks) { const isBound = baseBooks.includes(book); const $el = $(`<div class="pw-wi-book"><div class="pw-wi-header"><span><i class="fa-solid fa-book"></i> ${book} ${isBound ? '<span style="color:#9ece6a;font-size:0.8em;margin-left:5px;">(已绑定)</span>' : ''}</span><div>${!isBound ? '<i class="fa-solid fa-times remove-book" style="color:#ff6b6b;margin-right:10px;" title="移除"></i>' : ''}<i class="fa-solid fa-chevron-down arrow"></i></div></div><div class="pw-wi-list" data-book="${book}"></div></div>`); $el.find('.remove-book').on('click', (e) => { e.stopPropagation(); window.pwExtraBooks = window.pwExtraBooks.filter(b => b !== book); renderWiBooks(); }); $el.find('.pw-wi-header').on('click', async function() { const $list = $el.find('.pw-wi-list'); const $arrow = $(this).find('.arrow'); if ($list.is(':visible')) { $list.slideUp(); $arrow.removeClass('fa-flip-vertical'); } else { $list.slideDown(); $arrow.addClass('fa-flip-vertical'); if (!$list.data('loaded')) { $list.html('<div style="padding:10px;text-align:center;"><i class="fas fa-spinner fa-spin"></i></div>'); const entries = await getWorldBookEntries(book); $list.empty(); if (entries.length === 0) $list.html('<div style="padding:10px;opacity:0.5;">无条目</div>'); entries.forEach(entry => { const isChecked = entry.enabled ? 'checked' : ''; const $item = $(`<div class="pw-wi-item"><div class="pw-wi-item-row"><input type="checkbox" class="pw-wi-check" ${isChecked} data-content="${encodeURIComponent(entry.content)}"><div style="font-weight:bold; font-size:0.9em; flex:1;">${entry.displayName}</div><i class="fa-solid fa-eye pw-wi-toggle-icon"></i></div><div class="pw-wi-desc">${entry.content}<div class="pw-wi-close-bar"><i class="fa-solid fa-angle-up"></i> 收起</div></div></div>`); $item.find('.pw-wi-toggle-icon').on('click', function(e) { e.stopPropagation(); const $desc = $(this).closest('.pw-wi-item').find('.pw-wi-desc'); if($desc.is(':visible')) { $desc.slideUp(); $(this).css('color', ''); } else { $desc.slideDown(); $(this).css('color', '#5b8db8'); } }); $item.find('.pw-wi-close-bar').on('click', function() { $(this).parent().slideUp(); $item.find('.pw-wi-toggle-icon').css('color', ''); }); $list.append($item); }); $list.data('loaded', true); } } }); container.append($el); } };

function addPersonaButton() {
    const container = $('.persona_controls_buttons_block');
    if (container.length === 0 || $(`#${BUTTON_ID}`).length > 0) return;
    const newButton = $(`<div id="${BUTTON_ID}" class="menu_button fa-solid fa-wand-magic-sparkles interactable" title="${TEXT.BTN_TITLE}" tabindex="0" role="button"></div>`);
    newButton.on('click', openCreatorPopup);
    container.prepend(newButton);
    return true; // 成功添加
}

// [优化] 防卡死 Observer
function initObserver() {
    if (observer) observer.disconnect(); // 确保旧的观察者被停止
    
    // 如果按钮已经存在，则无需观察
    if ($(`#${BUTTON_ID}`).length > 0) return;

    observer = new MutationObserver((mutations, obs) => { 
        if ($('.persona_controls_buttons_block').length > 0) {
            // 找到容器后，尝试添加按钮
            if (addPersonaButton()) {
                obs.disconnect(); // 按钮添加成功，停止观察
                observer = null; // 清空引用
            }
        }
    });

    // 观察整个 body，因为 persona_controls_buttons_block 可能是动态加载的
    observer.observe(document.body, { childList: true, subtree: true });
}

jQuery(async () => {
    injectStyles();
    // 立即尝试添加按钮，如果成功则不启动观察者
    if (!addPersonaButton()) {
        // 如果立即添加失败（说明元素还没加载），则启动观察者
        setTimeout(initObserver, 1000); // 延迟启动，给页面一些加载时间
    }
    
    // 监听页面卸载事件，清理可能残留的事件监听器和观察者
    $(window).on('pagehide', () => {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        $(document).off('.pw'); // 确保所有 .pw 命名空间下的事件被移除
    });
});
