import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, callPopup, getRequestHeaders } from "../../../../script.js";

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const extensionName = "st-persona-weaver";
const STORAGE_KEY_HISTORY = 'pw_generation_history_v1';
const STORAGE_KEY_STATE = 'pw_current_state_v4';

const DEFAULT_TEMPLATE = `姓名：
年龄：
职业/身份：
外貌特征：
性格特点：
与当前角色的关系：
特殊能力/背景：`;

const defaultSettings = {
    autoSwitchPersona: true,
    syncToWorldInfo: true,
    historyLimit: 10,
    defaultOutputFormat: 'list',
    
    // Custom Template
    customTemplate: DEFAULT_TEMPLATE,
    
    // Independent API Settings
    apiSource: 'main', // 'main' | 'custom'
    customApiUrl: 'https://api.openai.com/v1',
    customApiKey: '',
    customApiModel: 'gpt-3.5-turbo'
};

// UI Text Constants
const TEXT = {
    PANEL_TITLE: "用户设定编织者 ✒️",
    BTN_OPEN_MAIN: "✨ 打开设定生成器",
    BTN_OPEN_DESC: "AI 辅助生成用户人设、属性表并同步世界书",
    
    // Settings UI
    LBL_AUTO_SWITCH: "保存后自动切换马甲",
    LBL_SYNC_WI: "默认勾选同步世界书",
    LBL_API_SOURCE: "AI 生成源",
    LBL_CUSTOM_URL: "API 地址 (Base URL)",
    LBL_CUSTOM_KEY: "API 密钥 (Key)",
    LBL_CUSTOM_MODEL: "模型名称 (Model)",
    LBL_TEMPLATE_EDIT: "编辑填写模板",
    
    // Popup UI
    TOAST_NO_CHAR: "请先打开一个角色聊天",
    TOAST_GEN_FAIL: "生成失败，请检查 API 设置",
    TOAST_SAVE_SUCCESS: (name) => `已保存并切换为: ${name}`,
    TOAST_WI_SUCCESS: (book) => `已更新世界书: ${book}`,
    LBL_SELECT_WB: "目标世界书 & 条目管理",
    LBL_ENTRIES_HEADER: "条目状态管理 (已选: {n})",
    LBL_ENTRIES_TIP: "在此勾选需要激活的条目，保存时会同步更新状态。"
};

// ============================================================================
// STATE & UTILS
// ============================================================================

let historyCache = [];
let currentBookEntries = {}; // Cache for current book entries
let entryChanges = {}; // Track user changes to existing entries

function loadHistory() {
    try {
        historyCache = JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY)) || [];
    } catch { historyCache = []; }
}

function saveHistory(item) {
    item.timestamp = new Date().toLocaleString();
    historyCache.unshift(item);
    if (historyCache.length > extension_settings[extensionName].historyLimit) {
        historyCache = historyCache.slice(0, extension_settings[extensionName].historyLimit);
    }
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(historyCache));
}

function saveState(data) {
    localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(data));
}

function loadState() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY_STATE)) || {};
    } catch { return {}; }
}

function injectStyles() {
    const styleId = 'persona-weaver-css';
    if ($(`#${styleId}`).length) return;

    const css = `
    .pw-wrapper { display: flex; flex-direction: column; height: 100%; text-align: left; font-size: 0.95em; min-height: 500px; }
    .pw-header { padding: 12px; border-bottom: 1px solid var(--SmartThemeBorderColor); display: flex; justify-content: space-between; align-items: center; background: var(--SmartThemeBg); }
    .pw-title { font-weight: bold; font-size: 1.1em; display: flex; align-items: center; gap: 8px; }
    .pw-tools i { cursor: pointer; margin-left: 15px; opacity: 0.7; transition: 0.2s; font-size: 1.1em; }
    .pw-tools i:hover { opacity: 1; transform: scale(1.1); color: var(--SmartThemeQuoteColor); }
    
    .pw-scroll-area { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 15px; }
    
    .pw-section { display: flex; flex-direction: column; gap: 8px; }
    .pw-label { font-size: 0.85em; opacity: 0.8; font-weight: bold; display: flex; justify-content: space-between; align-items: center; }
    
    .pw-input-tools { display: flex; gap: 10px; margin-bottom: 5px; font-size: 0.85em; }
    .pw-text-btn { cursor: pointer; color: var(--SmartThemeQuoteColor); font-weight: bold; opacity: 0.9; text-decoration: underline; }
    .pw-text-btn:hover { opacity: 1; }

    .pw-fmt-toggle { display: flex; background: var(--black30a); padding: 3px; border-radius: 6px; border: 1px solid var(--SmartThemeBorderColor); }
    .pw-fmt-opt { flex: 1; text-align: center; padding: 4px 8px; cursor: pointer; border-radius: 4px; font-size: 0.85em; opacity: 0.7; transition: 0.2s; }
    .pw-fmt-opt.active { background: var(--SmartThemeQuoteColor); color: white; opacity: 1; font-weight: bold; }

    .pw-textarea { width: 100%; background: var(--SmartThemeInputColor); border: 1px solid var(--SmartThemeBorderColor); color: var(--SmartThemeBodyColor); border-radius: 6px; padding: 10px; resize: vertical; min-height: 100px; box-sizing: border-box; line-height: 1.5; font-family: inherit; }
    .pw-textarea:focus { outline: 2px solid var(--SmartThemeQuoteColor); border-color: transparent; }
    
    .pw-input { width: 100%; background: var(--SmartThemeInputColor); border: 1px solid var(--SmartThemeBorderColor); color: var(--SmartThemeBodyColor); padding: 8px; border-radius: 6px; box-sizing: border-box; }
    .pw-select { width: 100%; background: var(--SmartThemeInputColor); border: 1px solid var(--SmartThemeBorderColor); color: var(--SmartThemeBodyColor); padding: 8px; border-radius: 6px; box-sizing: border-box; cursor: pointer; }
    
    .pw-card { background: var(--black10a); border: 1px solid var(--SmartThemeBorderColor); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
    
    .pw-btn { border: none; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer; color: white; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; transition: 0.2s; }
    .pw-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .pw-btn.gen { background: var(--SmartThemeQuoteColor); margin-top: 5px; }
    .pw-btn.save { background: var(--SmartThemeEmColor); }
    .pw-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; filter: grayscale(0.5); }

    .pw-history-item { padding: 12px; border-bottom: 1px solid var(--SmartThemeBorderColor); cursor: pointer; transition: 0.2s; border-radius: 6px; margin-bottom: 5px; background: var(--black10a); }
    .pw-history-item:hover { background: var(--white10a); transform: translateX(3px); }
    
    .pw-view { display: none; flex-direction: column; flex: 1; min-height: 0; }
    .pw-view.active { display: flex; }

    /* Entry Manager Styles */
    .pw-entries-box { 
        background: var(--SmartThemeInputColor); 
        border: 1px solid var(--SmartThemeBorderColor); 
        border-radius: 6px; 
        margin-top: 8px; 
        max-height: 200px; 
        display: flex; 
        flex-direction: column;
    }
    .pw-entries-search {
        padding: 5px; border-bottom: 1px solid var(--SmartThemeBorderColor);
    }
    .pw-search-input {
        width: 100%; background: transparent; border: none; color: var(--SmartThemeBodyColor); padding: 4px; font-size: 0.9em;
    }
    .pw-search-input:focus { outline: none; }
    .pw-entries-list {
        flex: 1; overflow-y: auto; padding: 5px;
    }
    .pw-entry-item {
        display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 4px; cursor: pointer; user-select: none;
    }
    .pw-entry-item:hover { background: var(--white10a); }
    .pw-entry-item input { cursor: pointer; }
    .pw-entry-name { font-size: 0.9em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.9; }
    .pw-entry-comment { font-size: 0.8em; opacity: 0.5; margin-left: auto; }

    .pw-setting-row { margin-bottom: 10px; }
    .pw-setting-input { width: 100%; background: var(--black10a); border: 1px solid var(--SmartThemeBorderColor); color: var(--SmartThemeBodyColor); padding: 5px; border-radius: 4px; }
    `;
    $('<style>').attr('id', styleId).html(css).appendTo('head');
}

// ============================================================================
// CORE LOGIC
// ============================================================================

// 获取所有世界书列表
async function getAllWorldBooks() {
    try {
        const headers = getRequestHeaders();
        const response = await fetch('/api/worldinfo/get', { method: 'POST', headers, body: JSON.stringify({}) });
        if (response.ok) {
            const data = await response.json();
            return data.map(item => (typeof item === 'object' ? item.name : item)).sort();
        }
    } catch (e) {
        console.error("Failed to fetch world books", e);
    }
    return [];
}

// 获取特定世界书的内容（条目）
async function getWorldBookContent(bookName) {
    try {
        const headers = getRequestHeaders();
        const response = await fetch('/api/worldinfo/get', { 
            method: 'POST', headers, body: JSON.stringify({ name: bookName }) 
        });
        if (response.ok) {
            const data = await response.json();
            // entries is object {id: entry}, convert to array
            if (data.entries) {
                return Object.values(data.entries).sort((a, b) => (a.comment || '').localeCompare(b.comment || ''));
            }
        }
    } catch (e) {
        console.error(`Failed to fetch content for ${bookName}`, e);
    }
    return [];
}

async function getRecommendedWorldBook() {
    const context = getContext();
    if (context.chatMetadata && context.chatMetadata.world_info) return context.chatMetadata.world_info;
    const charId = context.characterId;
    if (charId !== undefined && context.characters[charId]) {
        const char = context.characters[charId];
        const data = char.data || char;
        const world = data.extensions?.world || data.world || data.character_book?.name;
        if (world && typeof world === 'string') return world;
    }
    return null;
}

// API Calls
async function callCustomApi(messages) {
    const settings = extension_settings[extensionName];
    const url = settings.customApiUrl.replace(/\/$/, '') + '/chat/completions';
    
    const body = {
        model: settings.customApiModel,
        messages: messages,
        temperature: 0.7,
        max_tokens: 1000
    };

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.customApiKey}`
    };

    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const data = await response.json();
    return data.choices[0].message.content;
}

async function generatePersona(userRequest, outputFormat = 'list') {
    const context = getContext();
    const charId = context.characterId;
    if (charId === undefined) throw new Error("No character selected");
    
    const char = context.characters[charId];
    const settings = extension_settings[extensionName];
    
    let formatInst = outputFormat === 'list' ? 
        `"description": "Output strictly as an Attribute List / Character Sheet format. Use newlines."` : 
        `"description": "Output as a narrative, descriptive paragraph in third person."`;

    const systemPrompt = `Task: Create a User Persona based on the user's request and the current character's context.
Current Character: ${char.name}
Scenario: ${char.scenario || "None"}

Return ONLY a JSON object:
{
    "name": "Name of the persona",
    ${formatInst},
    "wi_entry": "Background facts about this persona suitable for World Info/Lorebook (Key facts only)."
}`;

    const userPrompt = `User Request:\n${userRequest}`;

    try {
        let generatedText = "";
        if (settings.apiSource === 'custom' && settings.customApiKey) {
            generatedText = await callCustomApi([
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ]);
        } else {
            generatedText = await context.generateQuietPrompt(systemPrompt + "\n\n" + userPrompt, false, false, "System");
        }

        const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Failed to parse JSON");
        return JSON.parse(jsonMatch[0]);
    } catch (e) {
        console.error("Persona Weaver Generation Error:", e);
        throw e;
    }
}

// ============================================================================
// UI FUNCTIONS
// ============================================================================

// Render the list of entries for a world book
function renderEntryList(entries, filterText = "") {
    const $list = $('#pw-entries-list').empty();
    
    if (!entries || entries.length === 0) {
        $list.html('<div style="text-align:center; opacity:0.5; padding:10px;">(空)</div>');
        return;
    }

    const lowerFilter = filterText.toLowerCase();
    
    entries.forEach(entry => {
        const name = entry.comment || entry.key?.toString() || `Entry #${entry.uid}`;
        if (filterText && !name.toLowerCase().includes(lowerFilter)) return;

        // Check if user changed it, otherwise use original state
        const isChecked = entryChanges[entry.uid] !== undefined ? entryChanges[entry.uid] : entry.enabled;

        const $item = $(`
            <div class="pw-entry-item">
                <input type="checkbox" data-uid="${entry.uid}" ${isChecked ? 'checked' : ''}>
                <span class="pw-entry-name" title="${name}">${name}</span>
                <span class="pw-entry-comment">#${entry.uid}</span>
            </div>
        `);
        
        $item.on('click', function(e) {
            if (e.target.tagName !== 'INPUT') {
                const $cb = $(this).find('input');
                $cb.prop('checked', !$cb.prop('checked')).trigger('change');
            }
        });

        $list.append($item);
    });
}

// Load book entries and update UI
async function loadAndRenderEntries(bookName) {
    $('#pw-entries-list').html('<div style="text-align:center; padding:10px;"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>');
    
    currentBookEntries = await getWorldBookContent(bookName);
    entryChanges = {}; // Reset changes when switching books
    
    renderEntryList(currentBookEntries);
}

async function openCreatorPopup() {
    const context = getContext();
    if (context.characterId === undefined) {
        toastr.warning(TEXT.TOAST_NO_CHAR, TEXT.PANEL_TITLE);
        return;
    }

    loadHistory();
    const savedState = loadState();
    
    const allBooks = await getAllWorldBooks();
    const recommendedBook = await getRecommendedWorldBook();
    const selectedBook = savedState.selectedBook || recommendedBook || (allBooks.length > 0 ? allBooks[0] : "");
    
    let currentFormat = savedState.format || extension_settings[extensionName].defaultOutputFormat || 'list';

    let optionsHtml = allBooks.map(b => 
        `<option value="${b}" ${b === selectedBook ? 'selected' : ''}>${b}${b === recommendedBook ? ' (当前)' : ''}</option>`
    ).join('');
    
    if (allBooks.length === 0) optionsHtml = `<option value="" disabled selected>无可用世界书</option>`;

    const html = `
    <div class="pw-wrapper">
        <div class="pw-header">
            <div class="pw-title"><i class="fa-solid fa-wand-magic-sparkles"></i> 设定构思</div>
            <div class="pw-tools">
                <i class="fa-solid fa-eraser" id="pw-clear" title="清空"></i>
                <i class="fa-solid fa-clock-rotate-left" id="pw-history" title="历史"></i>
            </div>
        </div>

        <!-- Editor View -->
        <div id="pw-view-editor" class="pw-view active">
            <div class="pw-scroll-area">
                
                <!-- Input -->
                <div class="pw-section">
                    <div class="pw-label">
                        <span>我的要求 / 设定填空</span>
                        <div class="pw-input-tools">
                            <span class="pw-text-btn" id="pw-fill-template"><i class="fa-solid fa-clipboard-list"></i> 插入模板</span>
                        </div>
                    </div>
                    <textarea id="pw-request" class="pw-textarea" placeholder="输入要求...">${savedState.request || ''}</textarea>
                    
                    <div class="pw-label" style="margin-top:5px;">生成结果格式</div>
                    <div class="pw-fmt-toggle">
                        <div class="pw-fmt-opt ${currentFormat === 'list' ? 'active' : ''}" data-fmt="list"><i class="fa-solid fa-list-ul"></i> 属性表</div>
                        <div class="pw-fmt-opt ${currentFormat === 'paragraph' ? 'active' : ''}" data-fmt="paragraph"><i class="fa-solid fa-paragraph"></i> 段落</div>
                    </div>

                    <button id="pw-btn-gen" class="pw-btn gen"><i class="fa-solid fa-bolt"></i> AI 生成 / 润色</button>
                </div>

                <!-- Result -->
                <div id="pw-result-area" style="display: ${savedState.hasResult ? 'block' : 'none'}">
                    <div style="border-top: 1px dashed var(--SmartThemeBorderColor); margin: 5px 0 15px 0;"></div>
                    <div class="pw-label"><i class="fa-solid fa-check-circle"></i> 结果确认</div>
                    
                    <div class="pw-card">
                        <div>
                            <span class="pw-label">角色名称</span>
                            <input type="text" id="pw-res-name" class="pw-input" value="${savedState.name || ''}">
                        </div>
                        <div>
                            <span class="pw-label">用户设定</span>
                            <textarea id="pw-res-desc" class="pw-textarea" rows="5">${savedState.desc || ''}</textarea>
                        </div>
                        
                        <div style="background: var(--black10a); padding: 8px; border-radius: 6px; border: 1px solid var(--SmartThemeBorderColor);">
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                <input type="checkbox" id="pw-wi-toggle" ${extension_settings[extensionName].syncToWorldInfo ? 'checked' : ''}>
                                <label for="pw-wi-toggle" style="font-size: 0.9em; cursor: pointer; font-weight:bold;">${TEXT.LBL_SELECT_WB}</label>
                            </div>
                            
                            <div id="pw-wi-container">
                                <select id="pw-wi-select" class="pw-select">${optionsHtml}</select>
                                
                                <!-- Entry Manager -->
                                <div class="pw-entries-box">
                                    <div class="pw-entries-search">
                                        <input type="text" id="pw-entry-filter" class="pw-search-input" placeholder="🔍 搜索/筛选条目...">
                                    </div>
                                    <div id="pw-entries-list" class="pw-entries-list">
                                        <!-- Entries will be loaded here -->
                                    </div>
                                </div>
                                <div style="font-size:0.8em; opacity:0.6; margin-top:2px; text-align:right;">${TEXT.LBL_ENTRIES_TIP}</div>

                                <textarea id="pw-res-wi" class="pw-textarea" rows="3" placeholder="新条目内容..." style="margin-top:8px;">${savedState.wiContent || ''}</textarea>
                            </div>
                        </div>
                    </div>

                    <button id="pw-btn-save" class="pw-btn save"><i class="fa-solid fa-floppy-disk"></i> 保存并启用</button>
                </div>
            </div>
        </div>

        <!-- History -->
        <div id="pw-view-history" class="pw-view">
            <div class="pw-scroll-area" id="pw-history-list"></div>
            <div style="padding: 15px; border-top: 1px solid var(--SmartThemeBorderColor); text-align: center;">
                <button id="pw-btn-back" class="pw-btn" style="background:transparent; border:1px solid var(--SmartThemeBorderColor); color:var(--SmartThemeBodyColor); width:auto; display:inline-flex;">
                    <i class="fa-solid fa-arrow-left"></i> 返回编辑
                </button>
            </div>
        </div>
    </div>
    `;

    callPopup(html, 'text', '', { wide: true, large: true, okButton: "关闭" });
    
    // Initial Load of Entries
    if (selectedBook) {
        loadAndRenderEntries(selectedBook);
    }
}

// ============================================================================
// GLOBAL EVENTS
// ============================================================================

function bindGlobalEvents() {
    $(document).off('click.pw_ext change.pw_ext input.pw_ext');

    // Save State
    $(document).on('input.pw_ext change.pw_ext', '#pw-request, #pw-res-name, #pw-res-desc, #pw-res-wi, #pw-wi-toggle', function() {
        const currentFormat = $('.pw-fmt-opt.active').data('fmt') || 'list';
        saveState({
            request: $('#pw-request').val(),
            format: currentFormat,
            hasResult: $('#pw-result-area').css('display') !== 'none',
            name: $('#pw-res-name').val(),
            desc: $('#pw-res-desc').val(),
            wiContent: $('#pw-res-wi').val(),
            selectedBook: $('#pw-wi-select').val()
        });
    });

    // World Book Change
    $(document).on('change.pw_ext', '#pw-wi-select', function() {
        const book = $(this).val();
        loadAndRenderEntries(book);
        $('#pw-request').trigger('change'); // trigger save state
    });

    // Entry Search
    $(document).on('input.pw_ext', '#pw-entry-filter', function() {
        renderEntryList(currentBookEntries, $(this).val());
    });

    // Entry Toggle Tracking
    $(document).on('change.pw_ext', '.pw-entry-item input', function() {
        const uid = $(this).data('uid');
        const checked = $(this).is(':checked');
        entryChanges[uid] = checked;
    });

    // Format Toggle
    $(document).on('click.pw_ext', '.pw-fmt-opt', function() {
        $('.pw-fmt-opt').removeClass('active');
        $(this).addClass('active');
        $('#pw-request').trigger('change');
    });

    // Template
    $(document).on('click.pw_ext', '#pw-fill-template', function() {
        const template = extension_settings[extensionName].customTemplate || DEFAULT_TEMPLATE;
        const currentVal = $('#pw-request').val();
        if (currentVal.trim() !== "" && !confirm("确定要追加模板吗？")) return;
        const newVal = currentVal ? currentVal + "\n\n" + template : template;
        $('#pw-request').val(newVal).focus().trigger('change');
    });

    // Generate
    $(document).on('click.pw_ext', '#pw-btn-gen', async function() {
        const req = $('#pw-request').val();
        if (!req.trim()) return toastr.warning("请输入要求");

        const currentFormat = $('.pw-fmt-opt.active').data('fmt') || 'list';
        const $btn = $(this);
        const oldText = $btn.html();
        $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> 生成中...');

        try {
            const data = await generatePersona(req, currentFormat);
            $('#pw-res-name').val(data.name);
            $('#pw-res-desc').val(data.description);
            $('#pw-res-wi').val(data.wi_entry || data.description);
            $('#pw-result-area').fadeIn();
            saveHistory({ request: req, format: currentFormat, data: data });
            $('#pw-request').trigger('change');
        } catch (e) {
            toastr.error(e.message || TEXT.TOAST_GEN_FAIL);
        } finally {
            $btn.prop('disabled', false).html(oldText);
        }
    });

    // Save Logic (Includes Entry Updates)
    $(document).on('click.pw_ext', '#pw-btn-save', async function() {
        const name = $('#pw-res-name').val();
        const desc = $('#pw-res-desc').val();
        const wiContent = $('#pw-res-wi').val();
        const syncWi = $('#pw-wi-toggle').is(':checked');
        const targetWb = $('#pw-wi-select').val();

        if (!name) return toastr.warning("名字不能为空");

        const $btn = $(this);
        $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> 保存中...');

        try {
            const context = getContext();
            
            // 1. Save Persona
            if (!context.powerUserSettings.personas) context.powerUserSettings.personas = {};
            context.powerUserSettings.personas[name] = desc;
            await saveSettingsDebounced();

            // 2. Sync World Info (Update existing + Add new)
            if (targetWb && syncWi) {
                const headers = getRequestHeaders();
                // Re-fetch to ensure fresh data
                const getRes = await fetch('/api/worldinfo/get', { 
                    method: 'POST', headers, body: JSON.stringify({ name: targetWb }) 
                });
                
                if (getRes.ok) {
                    const bookData = await getRes.json();
                    if (!bookData.entries) bookData.entries = {};
                    
                    let updatedCount = 0;

                    // Apply user toggles to existing entries
                    if (Object.keys(entryChanges).length > 0) {
                        for (const [uid, enabled] of Object.entries(entryChanges)) {
                            if (bookData.entries[uid]) {
                                bookData.entries[uid].enabled = enabled;
                                updatedCount++;
                            }
                        }
                    }

                    // Add new entry if content is present
                    if (wiContent) {
                        const ids = Object.keys(bookData.entries).map(Number);
                        const newId = ids.length ? Math.max(...ids) + 1 : 0;
                        
                        bookData.entries[newId] = {
                            uid: newId,
                            key: [name, "User", "用户"],
                            keysecondary: [],
                            comment: `[User] ${name}`,
                            content: wiContent,
                            constant: false,
                            selective: true,
                            enabled: true
                        };
                        updatedCount++;
                    }
                    
                    if (updatedCount > 0) {
                        await fetch('/api/worldinfo/edit', {
                            method: 'POST', headers, body: JSON.stringify({ name: targetWb, data: bookData })
                        });
                        toastr.success(TEXT.TOAST_WI_SUCCESS(targetWb), TEXT.PANEL_TITLE);
                        if (context.updateWorldInfoList) context.updateWorldInfoList();
                    }
                }
            }

            // 3. Auto Switch
            if (extension_settings[extensionName].autoSwitchPersona) {
                context.powerUserSettings.persona_selected = name;
                $("#your_name").val(name).trigger("input").trigger("change");
                $("#your_desc").val(desc).trigger("input").trigger("change");
            }

            toastr.success(TEXT.TOAST_SAVE_SUCCESS(name), TEXT.PANEL_TITLE);
            const $closeBtn = $('.swal2-confirm, .swal2-cancel, .popup_close');
            if ($closeBtn.length) $closeBtn.click();

        } catch (e) {
            console.error(e);
            toastr.error("保存失败: " + e.message);
        } finally {
            $btn.prop('disabled', false).html('<i class="fa-solid fa-floppy-disk"></i> 保存并启用');
        }
    });

    // Clear
    $(document).on('click.pw_ext', '#pw-clear', function() {
        if(confirm("确定清空当前所有内容？")) {
            $('input[type="text"], textarea').val('');
            $('#pw-result-area').hide();
            localStorage.removeItem(STORAGE_KEY_STATE);
        }
    });

    // History
    $(document).on('click.pw_ext', '#pw-history', function() {
        loadHistory();
        const $list = $('#pw-history-list').empty();
        if (historyCache.length === 0) $list.html('<div style="text-align:center; opacity:0.5;">暂无记录</div>');
        
        historyCache.forEach(item => {
            const $el = $(`
                <div class="pw-history-item">
                    <div style="font-size:0.8em; opacity:0.5; margin-bottom:4px;">${item.timestamp}</div>
                    <div style="font-weight:bold; color:var(--SmartThemeQuoteColor); font-size:1.05em;">${item.data.name}</div>
                    <div style="font-size:0.9em; opacity:0.8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                        <span style="opacity:0.6; border:1px solid var(--SmartThemeBorderColor); border-radius:3px; padding:0 3px; font-size:0.8em; margin-right:5px;">
                            ${item.format === 'paragraph' ? '段落' : '属性表'}
                        </span>
                        ${item.request}
                    </div>
                </div>
            `);
            $el.on('click', () => {
                $('#pw-request').val(item.request);
                $('#pw-res-name').val(item.data.name);
                $('#pw-res-desc').val(item.data.description);
                $('#pw-res-wi').val(item.data.wi_entry);
                
                $('.pw-fmt-opt').removeClass('active');
                $(`.pw-fmt-opt[data-fmt="${item.format || 'list'}"]`).addClass('active');

                $('#pw-result-area').show();
                $('#pw-request').trigger('change');
                
                $('.pw-view').removeClass('active');
                $(`#pw-view-editor`).addClass('active');
            });
            $list.append($el);
        });
        
        $('.pw-view').removeClass('active');
        $(`#pw-view-history`).addClass('active');
    });

    $(document).on('click.pw_ext', '#pw-btn-back', function() {
        $('.pw-view').removeClass('active');
        $(`#pw-view-editor`).addClass('active');
    });
}

// ============================================================================
// SETTINGS & INIT
// ============================================================================

async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
    
    $("#pw_auto_switch").prop("checked", extension_settings[extensionName].autoSwitchPersona);
    $("#pw_sync_wi").prop("checked", extension_settings[extensionName].syncToWorldInfo);
    
    $("#pw_api_source").val(extension_settings[extensionName].apiSource || 'main');
    $("#pw_custom_url").val(extension_settings[extensionName].customApiUrl);
    $("#pw_custom_key").val(extension_settings[extensionName].customApiKey);
    $("#pw_custom_model").val(extension_settings[extensionName].customApiModel);
    $("#pw_custom_template").val(extension_settings[extensionName].customTemplate || DEFAULT_TEMPLATE);
    
    updateApiVisibility();
}

function updateApiVisibility() {
    const source = $("#pw_api_source").val();
    if (source === 'custom') $("#pw_custom_api_settings").slideDown();
    else $("#pw_custom_api_settings").slideUp();
}

function onSettingChanged() {
    const s = extension_settings[extensionName];
    s.autoSwitchPersona = $("#pw_auto_switch").prop("checked");
    s.syncToWorldInfo = $("#pw_sync_wi").prop("checked");
    s.apiSource = $("#pw_api_source").val();
    s.customApiUrl = $("#pw_custom_url").val();
    s.customApiKey = $("#pw_custom_key").val();
    s.customApiModel = $("#pw_custom_model").val();
    s.customTemplate = $("#pw_custom_template").val();
    
    saveSettingsDebounced();
    updateApiVisibility();
}

jQuery(async () => {
    injectStyles();
    await loadSettings();
    bindGlobalEvents();

    const settingsHtml = `
    <div class="world-info-cleanup-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>${TEXT.PANEL_TITLE}</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div style="margin: 10px 0;">
                    <input id="pw_open_btn" class="menu_button" type="button" 
                           value="${TEXT.BTN_OPEN_MAIN}" 
                           style="width: 100%; padding: 8px; font-weight: bold; background: var(--SmartThemeQuoteColor); color: #fff;" />
                    <small style="display: block; text-align: center; opacity: 0.7; margin-top: 5px;">${TEXT.BTN_OPEN_DESC}</small>
                </div>
                <hr class="sysHR" />
                <div style="margin-bottom: 10px;">
                    <div class="flex-container" style="margin: 5px 0; align-items: center;">
                        <input id="pw_auto_switch" type="checkbox" />
                        <label for="pw_auto_switch" style="margin-left: 8px;">${TEXT.LBL_AUTO_SWITCH}</label>
                    </div>
                    <div class="flex-container" style="margin: 5px 0; align-items: center;">
                        <input id="pw_sync_wi" type="checkbox" />
                        <label for="pw_sync_wi" style="margin-left: 8px;">${TEXT.LBL_SYNC_WI}</label>
                    </div>
                </div>
                <hr class="sysHR" />
                <div style="margin-bottom: 15px;">
                    <h4 style="margin:0 0 10px 0;">API 设置</h4>
                    <div class="pw-setting-row">
                        <label class="pw-label">${TEXT.LBL_API_SOURCE}</label>
                        <select id="pw_api_source" class="pw-select">
                            <option value="main">酒馆主连接 (Main)</option>
                            <option value="custom">独立 API (OpenAI Compatible)</option>
                        </select>
                    </div>
                    <div id="pw_custom_api_settings" style="display:none; padding-left: 10px; border-left: 2px solid var(--SmartThemeBorderColor);">
                        <div class="pw-setting-row">
                            <label class="pw-label">${TEXT.LBL_CUSTOM_URL}</label>
                            <input id="pw_custom_url" class="pw-setting-input" placeholder="https://api.openai.com/v1" />
                        </div>
                        <div class="pw-setting-row">
                            <label class="pw-label">${TEXT.LBL_CUSTOM_KEY}</label>
                            <input id="pw_custom_key" type="password" class="pw-setting-input" placeholder="sk-..." />
                        </div>
                        <div class="pw-setting-row">
                            <label class="pw-label">${TEXT.LBL_CUSTOM_MODEL}</label>
                            <input id="pw_custom_model" class="pw-setting-input" placeholder="gpt-4o" />
                        </div>
                    </div>
                </div>
                <hr class="sysHR" />
                <div style="margin-bottom: 10px;">
                    <h4 style="margin:0 0 10px 0;">${TEXT.LBL_TEMPLATE_EDIT}</h4>
                    <textarea id="pw_custom_template" class="pw-textarea" rows="6"></textarea>
                </div>
            </div>
        </div>
    </div>`;

    $("#extensions_settings2").append(settingsHtml);
    $("#pw_open_btn").on("click", openCreatorPopup);
    $("#pw_auto_switch, #pw_sync_wi").on("change", onSettingChanged);
    $("#pw_api_source, #pw_custom_url, #pw_custom_key, #pw_custom_model").on("change", onSettingChanged);
    $("#pw_custom_template").on("change", onSettingChanged);

    console.log(`${extensionName} loaded.`);
});
