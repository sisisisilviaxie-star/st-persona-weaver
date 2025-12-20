import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, callPopup, getRequestHeaders } from "../../../../script.js";

const extensionName = "st-persona-weaver";
const STORAGE_KEY_HISTORY = 'pw_history_v20';
const STORAGE_KEY_STATE = 'pw_state_v20'; 
const STORAGE_KEY_TEMPLATE = 'pw_template_v1'; // 新增：用户自定义模版
const STORAGE_KEY_PROMPTS = 'pw_prompts_v1';
const BUTTON_ID = 'pw_persona_tool_btn';

// 移除默认 Name，作为基础模版
const defaultTemplateText = 
`gender:
identity:
- 
date_of_birth:
zodiac_sign:
mbti:
sexual_orientation:
appearance:
  height:
  weight:
  build:
  body:
    breast:
    pussy:
    ass hole:
    legs:
    hip:
  features:
    overall:
    eyes:
    nose:
    lips:
    glasses:
  hair:
  skin:
  odur:
  distinguishing_marks:
  overall_impression:

family_background:
   Father:
   Mother:
   Other:
      - 

background_story:
  童年(0-12岁):
    -
  少年(13-18岁):
    -
  青年(19-35岁):
    -
  中年(35-至今):
    -
  现状:
    -
social_status:
  -

attire:
  business_formal:
  business_casual:
  casual_wear:
  home_wear:

personality:
  core_traits:
    -
  public_persona:
    -
  pravite_persona:
    -
  romantic_traits:
    -
  advantage:
    -
  disadvantage:
    -

lifestyle_and_habits:
  residence:
  personal_habits:
    -
  preferences:
     likes:
       -
     dislikes:
       -

work_behaviors:
  -

emotional_behaviors:
  angry:
  happy:

goals/motivation:
  -

weakness:
  -

skills:
  - 工作: ["",""]
  - 生活: ["",""]
  - 爱好: ["",""]

relationship:

NSFW_information:
  Sex_related traits:
    first_time:
    experiences:
    sexual_knowledge:
    sexual_orientation:
      -
    sexual_role:
    sexual_habits:
      -
    sexual_preference:
  Kinks:
    -
  Limits:
    -`;

const defaultSystemPromptInitial = 
`Creating User Persona for {{user}} (Target: {{char}}).
{{wi}}
Instruction: {{input}}
Task: Generate character details strictly following the format of the provided template. Fill in the missing values. Do NOT add extra commentary.
Response: ONLY the filled Key-Value list.`;

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
    TOAST_SAVE_SUCCESS: (name) => `Persona "${name}" 已保存并覆盖！`,
    TOAST_WI_SUCCESS: (book) => `已实时更新世界书: ${book}`,
    TOAST_WI_FAIL: "当前角色未绑定世界书，无法同步",
    TOAST_WI_ERROR: "TavernHelper API 未加载，无法写入世界书",
    TOAST_SNAPSHOT: "已存入草稿箱",
    TOAST_TEST_OK: "API 连接成功！",
    TOAST_TEST_FAIL: "API 连接失败: "
};

let historyCache = [];
let templateCache = defaultTemplateText;
let promptsCache = { initial: defaultSystemPromptInitial, refine: defaultSystemPromptRefine };
let availableWorldBooks = []; 
let isEditingTemplate = false; 
let checkInterval = null; // [Fix] 改用 setInterval

// ============================================================================
// 1. 核心数据解析逻辑 (Diff 支持中英文冒号)
// ============================================================================

function parseTextToMap(text) {
    const map = new Map();
    if (!text) return map;
    const lines = text.split('\n');
    
    lines.forEach((line, index) => {
        if (!line.trim()) return;
        
        // [Fix] 同时匹配英文和中文冒号
        const match = line.match(/^([^:：]+)[:：](.*)$/);
        
        if (match) {
            let rawKey = match[1].trim();
            // 强力清洗 Key
            let cleanKey = rawKey.replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, '').trim(); 
            let val = match[2].trim();

            if (cleanKey && val) {
                map.set(cleanKey, val);
            }
        }
    });
    return map;
}

function findMatchingKey(targetKey, map) {
    if (map.has(targetKey)) return targetKey;
    for (const key of map.keys()) {
        if (key.toLowerCase() === targetKey.toLowerCase()) return key;
    }
    return null;
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
    try { 
        const t = JSON.parse(localStorage.getItem(STORAGE_KEY_TEMPLATE));
        templateCache = t !== null ? t : defaultTemplateText;
    } catch { templateCache = defaultTemplateText; }
    try { 
        const p = JSON.parse(localStorage.getItem(STORAGE_KEY_PROMPTS));
        promptsCache = { ...{ initial: defaultSystemPromptInitial, refine: defaultSystemPromptRefine }, ...p };
    } catch { promptsCache = { initial: defaultSystemPromptInitial, refine: defaultSystemPromptRefine }; }
}

function saveData() {
    localStorage.setItem(STORAGE_KEY_TEMPLATE, JSON.stringify(templateCache));
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
    const styleId = 'persona-weaver-css-v21';
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

async function syncToWorldInfoViaHelper(userName, content) {
    if (!window.TavernHelper) {
        toastr.error(TEXT.TOAST_WI_ERROR);
        return;
    }
    let targetBook = null;
    try {
        const charBooks = window.TavernHelper.getCharWorldbookNames('current');
        if (charBooks && charBooks.primary) {
            targetBook = charBooks.primary;
        } else if (charBooks && charBooks.additional && charBooks.additional.length > 0) {
            targetBook = charBooks.additional[0]; 
        }
    } catch (e) { console.warn("[PW] Failed to get char books via helper", e); }

    if (!targetBook) {
        const boundBooks = await getContextWorldBooks();
        if (boundBooks.length > 0) targetBook = boundBooks[0];
    }

    if (!targetBook) {
        toastr.warning(TEXT.TOAST_WI_FAIL);
        return;
    }

    try {
        const entries = await window.TavernHelper.getLorebookEntries(targetBook);
        const entryComment = `User: ${userName}`;
        const existingEntry = entries.find(e => e.comment === entryComment);

        if (existingEntry) {
            if (existingEntry.content !== content) {
                await window.TavernHelper.setLorebookEntries(targetBook, [{
                    uid: existingEntry.uid,
                    content: content,
                    enabled: true 
                }]);
            }
        } else {
            const newEntry = {
                comment: entryComment,
                keys: [userName, "User"],
                content: content,
                enabled: true,
                selective: true, 
                constant: false,
                position: { type: 'before_character_definition' }
            };
            await window.TavernHelper.createLorebookEntries(targetBook, [newEntry]);
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

async function getWorldBookEntries(bookName) {
    let entriesData = null;
    if (window.TavernHelper && typeof window.TavernHelper.getLorebookEntries === 'function') {
        try {
             const entries = await window.TavernHelper.getLorebookEntries(bookName);
             return entries.map(e => ({
                uid: e.uid,
                displayName: e.comment || (Array.isArray(e.keys) ? e.keys.join(', ') : e.keys) || "无标题",
                content: e.content || "",
                enabled: e.enabled
             }));
        } catch(e) {}
    }

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

    let systemTemplate = data.mode === 'refine' ? promptsCache.refine : promptsCache.initial;
    
    // 移除了 tags 变量，因为现在是基于模版生成
    let systemPrompt = systemTemplate
        .replace(/{{user}}/g, currentName)
        .replace(/{{char}}/g, charName)
        .replace(/{{wi}}/g, wiText)
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

async function testApiConnection(config) {
    if (config.apiSource !== 'independent') return toastr.info("主 API 连接由酒馆管理");
    try {
        const res = await fetch(`${config.indepApiUrl.replace(/\/$/, '')}/models`, {
            method: 'GET', headers: { 'Authorization': `Bearer ${config.indepApiKey}` }
        });
        if(res.ok) {
            toastr.success(TEXT.TOAST_TEST_OK);
            return true;
        } else { throw new Error(res.statusText); }
    } catch(e) {
        toastr.error(TEXT.TOAST_TEST_FAIL + e.message);
        return false;
    }
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
                <div class="pw-tab" data-tab="history">草稿</div>
            </div>
        </div>

        <div id="pw-view-editor" class="pw-view active">
            <div class="pw-scroll-area">
                <div class="pw-info-display"><div class="pw-info-item"><i class="fa-solid fa-user"></i><span id="pw-display-name">${currentName}</span></div></div>

                <div>
                    <div class="pw-template-header">
                        <span class="pw-template-label">人设模版/初始要求</span>
                        <div class="pw-template-actions">
                            <span class="pw-action-link insert" id="pw-btn-insert-template" title="将保存的模版插入输入框"><i class="fa-solid fa-file-import"></i> 插入模版</span>
                            <span class="pw-action-link edit" id="pw-btn-edit-template"><i class="fa-solid fa-edit"></i> 编辑模版</span>
                        </div>
                    </div>
                </div>

                <textarea id="pw-request" class="pw-textarea" placeholder="在此输入人设信息或特殊要求...\n点击“插入模版”可填入预设结构。" style="min-height:250px;">${savedState.request || ''}</textarea>
                <div id="pw-template-edit-bar" style="display:none; text-align:right; margin-bottom:5px;">
                    <span class="pw-action-link cancel" id="pw-btn-cancel-template" style="display:inline-flex; margin-right:10px;"><i class="fa-solid fa-times"></i> 取消</span>
                    <span class="pw-action-link insert" id="pw-btn-save-template" style="display:inline-flex;"><i class="fa-solid fa-save"></i> 保存模版</span>
                </div>

                <button id="pw-btn-gen" class="pw-btn gen">生成设定</button>

                <div id="pw-result-area" style="display:none; margin-top:15px;">
                    <div class="pw-relative-container">
                        <textarea id="pw-result-text" class="pw-result-textarea" placeholder="生成的结果将显示在这里..."></textarea>
                    </div>
                    
                    <div class="pw-refine-toolbar">
                        <textarea id="pw-refine-input" class="pw-refine-input" placeholder="输入润色意见..."></textarea>
                        <div class="pw-tool-btn-vertical" id="pw-btn-refine" title="执行润色">润色</div>
                    </div>
                </div>
            </div>

            <div class="pw-footer">
                <div class="pw-footer-group">
                    <div class="pw-compact-btn danger" id="pw-clear" title="清空"><i class="fa-solid fa-eraser"></i></div>
                    <div class="pw-compact-btn" id="pw-snapshot" title="存入草稿 (Drafts)"><i class="fa-solid fa-save"></i></div>
                </div>
                <div class="pw-footer-group" style="flex:1; justify-content:flex-end;">
                    <div class="pw-wi-sync-toggle ${wiChecked ? 'active' : ''}" id="pw-wi-sync-btn" title="同时存入/更新世界书 (仅限角色绑定的世界书)"><i class="fa-solid fa-book-medical"></i></div>
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

        <div id="pw-float-quote-btn" class="pw-float-quote-btn"><i class="fa-solid fa-pen-to-square"></i> 修改此段</div>

        <div id="pw-view-context" class="pw-view"><div class="pw-scroll-area"><div class="pw-card-section"><div class="pw-wi-controls"><select id="pw-wi-select" class="pw-input pw-wi-select"><option value="">-- 添加参考/目标世界书 --</option>${renderBookOptions()}</select><button id="pw-wi-refresh" class="pw-btn primary pw-wi-refresh-btn"><i class="fa-solid fa-sync"></i></button><button id="pw-wi-add" class="pw-btn primary pw-wi-add-btn"><i class="fa-solid fa-plus"></i></button></div></div><div id="pw-wi-container"></div></div></div>
        
        <div id="pw-view-api" class="pw-view">
            <div class="pw-scroll-area">
                <div class="pw-card-section">
                    <div class="pw-row"><label>API 来源</label><select id="pw-api-source" class="pw-input" style="flex:1;"><option value="main" ${config.apiSource === 'main'?'selected':''}>主 API</option><option value="independent" ${config.apiSource === 'independent'?'selected':''}>独立 API</option></select></div>
                    <div id="pw-indep-settings" style="display:${config.apiSource === 'independent' ? 'flex' : 'none'}; flex-direction:column; gap:15px;">
                        <div class="pw-row"><label>URL</label><input type="text" id="pw-api-url" class="pw-input" value="${config.indepApiUrl}" style="flex:1;"></div>
                        <div class="pw-row"><label>Key</label><input type="password" id="pw-api-key" class="pw-input" value="${config.indepApiKey}" style="flex:1;"></div>
                        <div class="pw-row pw-api-flex-row">
                            <label>Model</label>
                            <div class="pw-api-input-group">
                                <input type="text" id="pw-api-model" class="pw-input" value="${config.indepApiModel}" list="pw-model-list" style="flex:1;">
                                <datalist id="pw-model-list"></datalist>
                                <button id="pw-api-fetch" class="pw-btn primary" title="获取模型列表" style="width:auto; padding:0 10px;"><i class="fa-solid fa-cloud-download-alt"></i></button>
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <button id="pw-api-test" class="pw-btn primary" style="width:auto;"><i class="fa-solid fa-plug"></i> 测试连接</button>
                        </div>
                    </div>
                </div>

                <div class="pw-card-section pw-prompt-editor-block">
                    <div style="display:flex; justify-content:space-between;"><span class="pw-prompt-label">初始生成指令 (System Prompt)</span><button class="pw-mini-btn" id="pw-reset-prompts" style="font-size:0.7em;">恢复默认</button></div>
                    <div class="pw-var-btns">
                        <div class="pw-var-btn" data-ins="{{user}}">User名</div>
                        <div class="pw-var-btn" data-ins="{{char}}">Char名</div>
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
            </div>
        </div>

        <div id="pw-view-history" class="pw-view"><div class="pw-scroll-area"><div class="pw-search-box"><i class="fa-solid fa-search pw-search-icon"></i><input type="text" id="pw-history-search" class="pw-input pw-search-input" placeholder="搜索草稿..."><i class="fa-solid fa-times pw-search-clear" id="pw-history-search-clear" title="清空搜索"></i></div><div id="pw-history-list" style="display:flex; flex-direction:column;"></div><button id="pw-history-clear-all" class="pw-btn danger">清空所有草稿</button></div></div>
    </div>
    `;

    callPopup(html, 'text', '', { wide: true, large: true, okButton: "关闭" });
    bindEvents();
    renderWiBooks(); // 不再渲染Tags
    
    if (savedState.resultText) {
        $('#pw-result-text').val(savedState.resultText);
        $('#pw-result-area').show();
        $('#pw-request').addClass('minimized');
    }
}

// ============================================================================
// 4. 事件绑定
// ============================================================================

function bindEvents() {
    $(document).off('.pw');
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

    // 模版系统
    $(document).on('click.pw', '#pw-btn-insert-template', function() {
        if(isEditingTemplate) return toastr.warning("请先保存或取消编辑模版");
        const cur = $('#pw-request').val();
        const newVal = cur ? (cur + '\n\n' + templateCache) : templateCache;
        $('#pw-request').val(newVal).focus();
        toastr.success("模版已插入");
    });

    $(document).on('click.pw', '#pw-btn-edit-template', function() {
        isEditingTemplate = true;
        // 进入编辑模式：将当前模版存入 request 框让用户改
        $('#pw-request').data('original-request', $('#pw-request').val()); // 暂存用户输入
        $('#pw-request').val(templateCache).addClass('editing-mode').focus();
        $('.pw-template-actions').hide();
        $('#pw-template-edit-bar').show();
        $('#pw-btn-gen').prop('disabled', true); // 编辑模版时禁止生成
    });

    $(document).on('click.pw', '#pw-btn-save-template', function() {
        templateCache = $('#pw-request').val();
        saveData();
        toastr.success("模版已更新");
        exitEditMode();
    });

    $(document).on('click.pw', '#pw-btn-cancel-template', function() {
        exitEditMode();
    });

    function exitEditMode() {
        isEditingTemplate = false;
        $('#pw-request').val($('#pw-request').data('original-request') || '').removeClass('editing-mode');
        $('#pw-template-edit-bar').hide();
        $('.pw-template-actions').show();
        $('#pw-btn-gen').prop('disabled', false);
    }

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
            // API 和 Prompt 实时保存
            promptsCache.initial = $('#pw-prompt-initial').val();
            promptsCache.refine = $('#pw-prompt-refine').val();
            saveData();
        }, 500); 
    };
    $(document).on('input.pw change.pw', '#pw-request, #pw-result-text, #pw-wi-toggle, .pw-input, #pw-prompt-initial, #pw-prompt-refine', saveCurrentState);

    $(document).on('click.pw', '#pw-btn-refine', async function() {
        const refineReq = $('#pw-refine-input').val();
        if (!refineReq) return toastr.warning("请输入润色意见");
        const oldText = $('#pw-result-text').val();
        // 润色按钮加载状态
        const $btn = $(this).text('...').css('pointer-events', 'none');

        try {
            const wiContent = await collectActiveWorldInfoContent();
            const config = { mode: 'refine', request: refineReq, currentText: oldText, wiContext: wiContent, apiSource: $('#pw-api-source').val(), indepApiUrl: $('#pw-api-url').val(), indepApiKey: $('#pw-api-key').val(), indepApiModel: $('#pw-api-model').val() };
            const responseText = await runGeneration(config, config);
            
            const oldMap = parseTextToMap(oldText);
            const newMap = parseTextToMap(responseText);
            const allKeys = [...new Set([...oldMap.keys(), ...newMap.keys()])];
            
            const $list = $('#pw-diff-list').empty();
            let changeCount = 0;

            allKeys.forEach(key => {
                const matchedKeyInOld = findMatchingKey(key, oldMap) || key;
                const matchedKeyInNew = findMatchingKey(key, newMap) || key;
                const valOld = oldMap.get(matchedKeyInOld) || "";
                const valNew = newMap.get(matchedKeyInNew) || "";
                
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
                const $row = $(`<div class="pw-diff-row" data-key="${key}"><div class="pw-diff-attr-name">${key}</div>${optionsHtml}<div class="pw-diff-edit-area"><textarea class="pw-diff-custom-input" placeholder="可微调...">${valNew}</textarea></div></div>`);
                $list.append($row);
            });

            if (changeCount === 0) toastr.info("AI 认为无需修改");
            $('#pw-diff-overlay').fadeIn();
            $('#pw-refine-input').val(''); adjustHeight($('#pw-refine-input')[0]);
        } catch (e) { toastr.error(e.message); }
        finally { $btn.text('润色').css('pointer-events', 'auto'); }
    });

    $(document).on('click.pw', '.pw-diff-opt:not(.single-view)', function() {
        $(this).siblings().removeClass('selected'); $(this).addClass('selected');
        const val = $(this).data('val'); $(this).closest('.pw-diff-row').find('.pw-diff-custom-input').val(val);
    });

    $(document).on('click.pw', '#pw-diff-confirm', function() {
        let finalLines = [];
        $('.pw-diff-row').each(function() {
            const key = $(this).data('key');
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
            $('#pw-result-area').fadeIn();
            $('#pw-request').addClass('minimized');
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
            $('#pw-request').val('').removeClass('minimized'); 
            $('#pw-result-area').hide(); 
            $('#pw-result-text').val(''); 
            saveCurrentState(); 
        }
    });
    
    $(document).on('click.pw', '#pw-snapshot', function() {
        const text = $('#pw-result-text').val();
        const req = $('#pw-request').val();
        if (!text && !req) return toastr.warning("没有任何内容可保存");
        const context = getContext();
        const userName = $('.persona_name').first().text().trim() || "User";
        const charName = context.characters[context.characterId]?.name || "";
        const defaultTitle = `${userName} + ${charName} (${new Date().toLocaleDateString()})`;
        saveHistory({ request: req || "无", timestamp: new Date().toLocaleString(), title: defaultTitle, data: { name: userName, resultText: text || "(仅有请求，未生成结果)" } });
        toastr.success(TEXT.TOAST_SNAPSHOT);
    });

    $(document).on('click.pw', '.pw-hist-action-btn.edit', function(e) {
        e.stopPropagation();
        const $header = $(this).closest('.pw-hist-header');
        const $display = $header.find('.pw-hist-title-display');
        const $input = $header.find('.pw-hist-title-input');
        $display.hide(); $input.show().focus();
        const saveEdit = () => {
            const newVal = $input.val();
            $display.text(newVal).show(); $input.hide();
            const index = $header.closest('.pw-history-item').find('.pw-hist-action-btn.del').data('index'); 
            if (historyCache[index]) { historyCache[index].title = newVal; saveData(); }
            $(document).off('click.pw-hist-blur');
        };
        $input.one('blur keyup', function(ev) {
            if(ev.type === 'keyup' && ev.key !== 'Enter') return;
            saveEdit();
        });
    });

    $(document).on('change.pw', '#pw-api-source', function() { $('#pw-indep-settings').toggle($(this).val() === 'independent'); });
    $(document).on('click.pw', '#pw-api-fetch', async function() { /* same fetch logic */ });
    
    // [Fix] API 测试按钮
    $(document).on('click.pw', '#pw-api-test', async function() {
        const $btn = $(this);
        $btn.html('<i class="fas fa-spinner fa-spin"></i> 测试中...');
        const config = {
            apiSource: 'independent',
            indepApiUrl: $('#pw-api-url').val(),
            indepApiKey: $('#pw-api-key').val(),
            indepApiModel: $('#pw-api-model').val()
        };
        await testApiConnection(config);
        $btn.html('<i class="fa-solid fa-plug"></i> 测试连接');
    });

    $(document).on('click.pw', '#pw-reset-prompts', () => {
        if(confirm("重置所有 Prompt 为默认？")) {
            $('#pw-prompt-initial').val(defaultSystemPromptInitial);
            $('#pw-prompt-refine').val(defaultSystemPromptRefine);
            toastr.info("已恢复默认，内容已自动保存");
            promptsCache.initial = defaultSystemPromptInitial;
            promptsCache.refine = defaultSystemPromptRefine;
            saveData();
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

// ... History, WiBooks Render functions remain same ...
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
    if (filtered.length === 0) { $list.html('<div style="text-align:center; opacity:0.6; padding:20px;">暂无草稿</div>'); return; }
    
    filtered.forEach((item, index) => {
        const previewText = item.data.resultText || '无内容';
        const displayTitle = item.title || "未命名";
        
        const $el = $(`
            <div class="pw-history-item">
                <div class="pw-hist-main">
                    <div class="pw-hist-header">
                        <span class="pw-hist-title-display">${displayTitle}</span>
                        <input type="text" class="pw-hist-title-input" value="${displayTitle}" style="display:none;">
                        <div style="display:flex; gap:5px;">
                            <i class="fa-solid fa-pen pw-hist-action-btn edit" title="编辑标题"></i>
                            <i class="fa-solid fa-trash pw-hist-action-btn del" data-index="${index}" title="删除"></i>
                        </div>
                    </div>
                    <div class="pw-hist-meta"><span>${item.timestamp || ''}</span></div>
                    <div class="pw-hist-desc">${previewText}</div>
                </div>
            </div>
        `);
        $el.on('click', function(e) {
            if ($(e.target).closest('.pw-hist-action-btn, .pw-hist-title-input').length) return;
            $('#pw-request').val(item.request); $('#pw-result-text').val(previewText); $('#pw-result-area').show(); 
            $('#pw-request').addClass('minimized'); 
            $('.pw-tab[data-tab="editor"]').click();
        });
        $el.find('.pw-hist-action-btn.del').on('click', function(e) { 
            e.stopPropagation(); 
            if(confirm("删除?")) { 
                historyCache.splice(historyCache.indexOf(item), 1); 
                saveData(); renderHistoryList(); 
            } 
        });
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
}

// [Fix] 绝对防卡死：使用 setInterval 替代 MutationObserver
function initButtonCheck() {
    if (checkInterval) clearInterval(checkInterval);
    checkInterval = setInterval(() => {
        // 只有当容器存在，且按钮不存在时，才执行添加操作
        if ($('.persona_controls_buttons_block').length > 0 && $(`#${BUTTON_ID}`).length === 0) {
            addPersonaButton();
        }
    }, 2000); // 2秒检查一次，性能损耗忽略不计
}

jQuery(async () => {
    injectStyles();
    addPersonaButton();
    initButtonCheck();
});
