import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, callPopup, getRequestHeaders } from "../../../../script.js";

// ============================================================================
// 1. 常量与配置
// ============================================================================

const extensionName = "st-persona-weaver";
const STORAGE_KEY_HISTORY = 'pw_history_v19'; // 版本升级清理旧缓存
const STORAGE_KEY_STATE = 'pw_state_v19'; 
const STORAGE_KEY_TAGS = 'pw_tags_v12';
const BUTTON_ID = 'pw_persona_tool_btn';

const defaultTags = [
    { name: "性别", value: "" },
    { name: "年龄", value: "" },
    { name: "MBTI", value: "" },
    { name: "职业", value: "" },
    { name: "阵营", value: "" },
    { name: "外貌", value: "" },
    { name: "性格", value: "" },
    { name: "关系", value: "" },
    { name: "XP", value: "" },
    { name: "秘密", value: "" }
];

const defaultSettings = {
    autoSwitchPersona: true,
    syncToWorldInfo: true,
    historyLimit: 50,
    apiSource: 'main', 
    indepApiUrl: 'https://api.openai.com/v1',
    indepApiKey: '',
    indepApiModel: 'gpt-3.5-turbo'
};

const TEXT = {
    PANEL_TITLE: "用户设定编织者 Pro",
    BTN_TITLE: "打开设定生成器",
    TOAST_NO_CHAR: "请先打开一个角色聊天",
    TOAST_API_OK: "API 连接成功",
    TOAST_API_ERR: "API 连接失败",
    TOAST_SAVE_API: "API 设置已保存",
    TOAST_SNAPSHOT: "已存入历史记录",
    TOAST_GEN_FAIL: "生成失败，请检查 API 设置",
    TOAST_SAVE_SUCCESS: (name) => `Persona "${name}" 已更新！`,
    TOAST_WI_SUCCESS: (book) => `已写入世界书: ${book}`,
    TOAST_WI_FAIL: "未找到绑定的世界书，无法保存条目"
};

let historyCache = [];
let tagsCache = [];
let worldInfoCache = {}; 
let availableWorldBooks = []; 
let isEditingTags = false; 

// ============================================================================
// 2. 核心逻辑函数
// ============================================================================

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
    historyCache.unshift(item);
    if (historyCache.length > limit) historyCache = historyCache.slice(0, limit);
    saveData();
}

function saveState(data) {
    localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(data));
}

function loadState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_STATE)) || {}; } catch { return {}; }
}

function injectStyles() {
    const styleId = 'persona-weaver-css-v18';
    if ($(`#${styleId}`).length) return;
}

// [核心] 暴力写入 Persona
async function forceSavePersona(name, description) {
    const context = getContext();
    if (!context.powerUserSettings.personas) context.powerUserSettings.personas = {};
    context.powerUserSettings.personas[name] = description;

    // 强制切换选中
    context.powerUserSettings.persona_selected = name;

    // 尝试更新 UI (如果存在)
    const $nameInput = $('#your_name'); // 这里指设置面板里的 input
    const $descInput = $('#persona_description');
    
    if ($nameInput.length) {
        $nameInput.val(name).trigger('input').trigger('change');
    }
    if ($descInput.length) {
        $descInput.val(description).trigger('input').trigger('change');
    }

    // 另外尝试更新主界面的 h5 显示 (虽然 ST 可能会自己刷新)
    const $h5Name = $('h5#your_name');
    if ($h5Name.length) $h5Name.text(name);

    await saveSettingsDebounced();
    console.log(`[PW] Persona "${name}" updated.`);
    return true;
}

// 获取所有可用世界书名
async function loadAvailableWorldBooks() {
    availableWorldBooks = [];
    try {
        const response = await fetch('/api/worldinfo/get', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({}) });
        if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data)) {
                availableWorldBooks = data.map(item => item.name || item);
            } else if (data && data.world_names) {
                availableWorldBooks = data.world_names;
            }
        }
    } catch (e) { console.error("[PW] API load failed", e); }
    availableWorldBooks = [...new Set(availableWorldBooks)].filter(x => x).sort();
}

// 获取当前上下文绑定的世界书
async function getContextWorldBooks(extras = []) {
    const context = getContext();
    const books = new Set(extras); 

    const charId = context.characterId;
    if (charId !== undefined && context.characters[charId]) {
        const char = context.characters[charId];
        const data = char.data || char;
        
        const v2Book = data.character_book?.name;
        const extWorld = data.extensions?.world;
        const legacyWorld = data.world;
        const chatWorld = context.chatMetadata?.world_info;

        if (v2Book) books.add(v2Book);
        if (extWorld) books.add(extWorld);
        if (legacyWorld) books.add(legacyWorld);
        if (chatWorld) books.add(chatWorld);
    }
    return Array.from(books).filter(Boolean);
}

async function getWorldBookEntries(bookName) {
    if (worldInfoCache[bookName]) return worldInfoCache[bookName];
    try {
        const headers = getRequestHeaders();
        const response = await fetch('/api/worldinfo/get', { method: 'POST', headers, body: JSON.stringify({ name: bookName }) });
        if (response.ok) {
            const data = await response.json();
            const entries = Object.values(data.entries || {}).map(e => ({
                uid: e.uid,
                displayName: e.comment || (Array.isArray(e.key) ? e.key.join(', ') : e.key),
                content: e.content,
                enabled: !e.disable && e.enabled !== false
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
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${key}` }
        });
        if (!response.ok) throw new Error("Fetch failed");
        const data = await response.json();
        return (data.data || data).map(m => m.id).sort();
    } catch (e) { console.error(e); return []; }
}

// [核心] 生成与润色逻辑
async function runGeneration(data, apiConfig) {
    const context = getContext();
    const char = context.characters[context.characterId];
    
    // 获取当前名字
    const currentName = $('#pw-display-name').text().trim() || "User";

    let wiText = "";
    if (data.wiContext && data.wiContext.length > 0) {
        wiText = `\n[Context from World Info]:\n${data.wiContext.join('\n\n')}\n`;
    }

    let systemPrompt = "";
    
    if (data.mode === 'refine') {
        // === 润色模式 ===
        systemPrompt = `You are a creative writing assistant optimizing a User Persona.
Target Character: ${char.name}
Scenario: ${char.scenario || "None"}
${wiText}

[Current Persona Data]:
"""
${data.currentText}
"""

[Refinement Instruction]:
"${data.request}"

[Task]:
1. Modify the Persona Data according to the instruction.
2. If the user provided a specific text segment, focus on modifying that part.
3. Maintain the "Key: Value" list format.
4. User Name: "${currentName}" (Immutable).

[Response Format]:
Return ONLY the Key-Value list (or plain text if that's the current format). No JSON wrapping needed unless it's strictly JSON. Just return the text content.
`;
    } else {
        // === 初次生成模式 ===
        const targetKeys = tagsCache.map(t => t.name).filter(n => n).join(', ');

        systemPrompt = `You are a creative writing assistant creating a User Persona.
Target Character: ${char.name}
Scenario: ${char.scenario || "None"}
${wiText}

[User Request]:
${data.request}

[Task]:
1. Create a detailed Persona for "${currentName}".
2. Use "Key: Value" format for traits (one per line).
3. Recommended Keys: ${targetKeys}.

[Response Format]:
Return ONLY the Key-Value list text.
Example:
Gender: Female
Age: 20
Personality: ...
`;
    }

    // 调用 API
    let responseContent = "";
    if (apiConfig.apiSource === 'independent') {
        const url = `${apiConfig.indepApiUrl.replace(/\/$/, '')}/chat/completions`;
        const body = {
            model: apiConfig.indepApiModel,
            messages: [{ role: 'system', content: systemPrompt }],
            temperature: 0.7
        };
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.indepApiKey}` },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error("Independent API Error");
        const json = await res.json();
        responseContent = json.choices[0].message.content;
    } else {
        responseContent = await context.generateQuietPrompt(systemPrompt, false, false, "System");
    }

    // 清理一下可能出现的 markdown 代码块符号
    return responseContent.replace(/```json/g, '').replace(/```/g, '').trim();
}

// ============================================================================
// 3. UI 渲染与 HTML 模板
// ============================================================================

async function openCreatorPopup() {
    const context = getContext();
    if (context.characterId === undefined) {
        return toastr.warning(TEXT.TOAST_NO_CHAR);
    }

    loadData();
    await loadAvailableWorldBooks();
    const savedState = loadState();
    const config = { ...defaultSettings, ...extension_settings[extensionName], ...savedState.localConfig };
    
    // [修复] 从 h5#your_name 获取最准确的显示名
    let currentName = $('h5#your_name').text().trim();
    if (!currentName || currentName === "User") {
        // fallback
        currentName = context.powerUserSettings?.persona_selected || "User";
    }

    const wiOptions = availableWorldBooks.length > 0 
        ? availableWorldBooks.map(b => `<option value="${b}">${b}</option>`).join('')
        : `<option disabled>未找到世界书</option>`;

    const html = `
    <div class="pw-wrapper">
        <div class="pw-header">
            <div class="pw-top-bar">
                <div class="pw-title"><i class="fa-solid fa-wand-magic-sparkles" style="color:#e0af68;"></i> 设定编织者 Pro</div>
            </div>
            <div class="pw-tabs">
                <div class="pw-tab active" data-tab="editor"><i class="fa-solid fa-pen-to-square"></i> 编辑</div>
                <div class="pw-tab" data-tab="context"><i class="fa-solid fa-book"></i> 世界书</div>
                <div class="pw-tab" data-tab="api"><i class="fa-solid fa-gear"></i> API</div>
                <div class="pw-tab" data-tab="history"><i class="fa-solid fa-clock-rotate-left"></i> 历史</div>
            </div>
        </div>

        <div id="pw-view-editor" class="pw-view active">
            <div class="pw-scroll-area">
                
                <!-- 1. 只读名字展示 -->
                <div class="pw-info-display">
                    <div class="pw-info-item">
                        <i class="fa-solid fa-user"></i>
                        <span id="pw-display-name">${currentName}</span>
                    </div>
                </div>

                <!-- 2. 输入区域 -->
                <div>
                    <div class="pw-tags-header">
                        <span class="pw-tags-label">快速设定 (点击标签填入)</span>
                        <span class="pw-tags-edit-toggle" id="pw-toggle-edit-tags">编辑标签</span>
                    </div>
                    <div class="pw-tags-container" id="pw-tags-list"></div>
                </div>

                <textarea id="pw-request" class="pw-textarea" placeholder="在此输入初始设定要求..." style="min-height:80px;">${savedState.request || ''}</textarea>
                
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:5px;">
                    <!-- 找回清空和存入历史按钮 -->
                    <div class="pw-editor-tools">
                        <div class="pw-mini-btn" id="pw-clear"><i class="fa-solid fa-eraser"></i> 清空</div>
                        <div class="pw-mini-btn" id="pw-snapshot"><i class="fa-solid fa-save"></i> 存入历史</div>
                    </div>
                    <button id="pw-btn-gen" class="pw-btn gen" style="width:auto; padding:8px 20px;"><i class="fa-solid fa-bolt"></i> 生成设定</button>
                </div>

                <!-- 3. 结果展示区域 (文本列表模式) -->
                <div id="pw-result-area" class="pw-result-container" style="display:none;">
                    <div style="font-weight:bold; color:#5b8db8; margin-bottom:5px;"><i class="fa-solid fa-list-ul"></i> 设定详情 (可直接修改)</div>
                    
                    <textarea id="pw-result-text" class="pw-result-textarea" placeholder="生成的结果将显示在这里..."></textarea>

                    <!-- 润色工具 -->
                    <div class="pw-refine-box" style="align-items:stretch;">
                        <div style="flex:1; display:flex; flex-direction:column; gap:5px;">
                            <input type="text" id="pw-refine-input" class="pw-input" placeholder="输入修改意见 (或点击上方标签/选中文字插入)...">
                            <div style="font-size:0.8em; opacity:0.6; cursor:pointer;" id="pw-insert-selection"><i class="fa-solid fa-quote-left"></i> 点击此处将上方选中的文字填入修改框</div>
                        </div>
                        <button id="pw-btn-refine" class="pw-btn primary" style="width:auto;"><i class="fa-solid fa-magic"></i> 润色</button>
                    </div>

                    <div class="pw-save-bar">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <div style="display:flex; align-items:center; gap:5px;">
                                <input type="checkbox" id="pw-wi-toggle" checked>
                                <span style="font-size:0.9em;">同步保存到世界书</span>
                            </div>
                        </div>
                        <button id="pw-btn-apply" class="pw-btn save"><i class="fa-solid fa-check"></i> 保存并生效</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Tab: Context (WI) -->
        <div id="pw-view-context" class="pw-view">
            <div class="pw-scroll-area">
                <div class="pw-card-section">
                    <div class="pw-wi-controls">
                        <select id="pw-wi-select" class="pw-input pw-wi-select">
                            <option value="">-- 添加参考世界书 --</option>
                            ${wiOptions}
                        </select>
                        <button id="pw-wi-add" class="pw-btn primary pw-wi-add-btn"><i class="fa-solid fa-plus"></i></button>
                    </div>
                </div>
                <div id="pw-wi-container"></div>
            </div>
        </div>

        <!-- Tab: API -->
        <div id="pw-view-api" class="pw-view">
            <div class="pw-scroll-area">
                <div class="pw-card-section">
                    <div class="pw-row">
                        <label>API 来源</label>
                        <select id="pw-api-source" class="pw-input" style="flex:1;">
                            <option value="main" ${config.apiSource === 'main' ? 'selected' : ''}>使用主 API</option>
                            <option value="independent" ${config.apiSource === 'independent' ? 'selected' : ''}>独立 API</option>
                        </select>
                    </div>
                    <div id="pw-indep-settings" style="display:${config.apiSource === 'independent' ? 'flex' : 'none'}; flex-direction:column; gap:15px;">
                        <div class="pw-row">
                            <label>URL</label>
                            <input type="text" id="pw-api-url" class="pw-input" value="${config.indepApiUrl}" placeholder="https://api.openai.com/v1" style="flex:1;">
                        </div>
                        <div class="pw-row">
                            <label>Key</label>
                            <input type="password" id="pw-api-key" class="pw-input" value="${config.indepApiKey}" style="flex:1;">
                        </div>
                        <div class="pw-row pw-api-model-row">
                            <label>Model</label>
                            <div style="flex:1; display:flex; gap:5px; width:100%;">
                                <input type="text" id="pw-api-model" class="pw-input" value="${config.indepApiModel}" list="pw-model-list" style="flex:1;">
                                <datalist id="pw-model-list"></datalist>
                                <button id="pw-api-fetch" class="pw-btn primary pw-api-fetch-btn" title="获取模型" style="width:auto;"><i class="fa-solid fa-cloud-download-alt"></i></button>
                            </div>
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <button id="pw-api-save" class="pw-btn primary" style="width:auto;"><i class="fa-solid fa-save"></i> 保存设置</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Tab: History -->
        <div id="pw-view-history" class="pw-view">
            <div class="pw-scroll-area">
                <div class="pw-search-box">
                    <input type="text" id="pw-history-search" class="pw-input pw-search-input" placeholder="🔍 搜索历史...">
                    <i class="fa-solid fa-times pw-search-clear" id="pw-history-search-clear" title="清空搜索"></i>
                </div>
                <div id="pw-history-list" style="display:flex; flex-direction:column;"></div>
                <button id="pw-history-clear-all" class="pw-btn danger"><i class="fa-solid fa-trash-alt"></i> 清空所有历史记录</button>
            </div>
        </div>
    </div>
    `;

    callPopup(html, 'text', '', { wide: true, large: true, okButton: "关闭" });

    bindEvents();
    renderTagsList();
    renderWiBooks();
    
    if (savedState.resultText) {
        $('#pw-result-text').val(savedState.resultText);
        $('#pw-result-area').show();
    }
}

// ============================================================================
// 4. 事件绑定
// ============================================================================

function bindEvents() {
    $(document).off('.pw');

    const saveCurrentState = () => {
        saveState({
            request: $('#pw-request').val(),
            resultText: $('#pw-result-text').val(),
            hasResult: $('#pw-result-area').is(':visible'),
            localConfig: {
                apiSource: $('#pw-api-source').val(),
                indepApiUrl: $('#pw-api-url').val(),
                indepApiKey: $('#pw-api-key').val(),
                indepApiModel: $('#pw-api-model').val(),
                extraBooks: window.pwExtraBooks || []
            }
        });
    };
    $(document).on('input.pw change.pw', '#pw-request, #pw-result-text, .pw-input', saveCurrentState);

    // Tab 切换
    $(document).on('click.pw', '.pw-tab', function() {
        $('.pw-tab').removeClass('active');
        $(this).addClass('active');
        $('.pw-view').removeClass('active');
        const tab = $(this).data('tab');
        $(`#pw-view-${tab}`).addClass('active');
        if(tab === 'history') renderHistoryList(); 
    });

    // 引用选中内容 (新增功能)
    $(document).on('click.pw', '#pw-insert-selection', function() {
        // 获取 textarea 的选中内容
        const textarea = document.getElementById('pw-result-text');
        if (textarea) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const selectedText = textarea.value.substring(start, end).trim();
            
            if (selectedText) {
                const $input = $('#pw-refine-input');
                const current = $input.val();
                // 格式：将 “原内容” 修改为...
                $input.val(current + ` 将 "${selectedText}" 修改为: `).focus();
            } else {
                toastr.info("请先在上方结果框中划选文字");
            }
        }
    });

    // 清空
    $(document).on('click.pw', '#pw-clear', function() {
        if(confirm("清空所有输入内容？")) {
            $('#pw-request').val('');
            $('#pw-result-area').hide();
            $('#pw-result-text').val('');
            $('#pw-refine-input').val('');
            saveCurrentState();
        }
    });

    // 存入历史
    $(document).on('click.pw', '#pw-snapshot', function() {
        const req = $('#pw-request').val();
        const curName = $('#pw-display-name').text();
        const curText = $('#pw-result-text').val();
        
        if (!req && !curText) return toastr.warning("内容为空，无法保存");
        
        saveHistory({ 
            request: req || "无请求内容", 
            timestamp: new Date().toLocaleString(),
            targetChar: getContext().characters[getContext().characterId]?.name || "未知",
            data: { name: curName, resultText: curText } 
        });
        toastr.success(TEXT.TOAST_SNAPSHOT);
    });

    // --- 1. 生成逻辑 (初次) ---
    $(document).on('click.pw', '#pw-btn-gen', async function() {
        const req = $('#pw-request').val();
        if (!req) return toastr.warning("请输入一些设定要求");

        const $btn = $(this);
        const oldText = $btn.html();
        $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> 生成中...');

        try {
            const wiContext = [];
            $('.pw-wi-check:checked').each(function() { wiContext.push(decodeURIComponent($(this).data('content'))); });

            const config = {
                mode: 'initial',
                request: req,
                wiContext: wiContext,
                apiSource: $('#pw-api-source').val(),
                indepApiUrl: $('#pw-api-url').val(),
                indepApiKey: $('#pw-api-key').val(),
                indepApiModel: $('#pw-api-model').val()
            };

            const responseText = await runGeneration(config, config);
            
            $('#pw-result-text').val(responseText);
            $('#pw-result-area').fadeIn();
            saveCurrentState();

        } catch (e) {
            toastr.error(`${TEXT.TOAST_GEN_FAIL}: ${e.message}`);
        } finally {
            $btn.prop('disabled', false).html(oldText);
        }
    });

    // --- 2. 润色逻辑 (二次) ---
    $(document).on('click.pw', '#pw-btn-refine', async function() {
        const refineReq = $('#pw-refine-input').val();
        if (!refineReq) return toastr.warning("请输入润色意见");

        const currentRawText = $('#pw-result-text').val();
        const $btn = $(this);
        const oldText = $btn.html();
        $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> 润色中...');

        try {
            const config = {
                mode: 'refine',
                request: refineReq,
                currentText: currentRawText, 
                apiSource: $('#pw-api-source').val(),
                indepApiUrl: $('#pw-api-url').val(),
                indepApiKey: $('#pw-api-key').val(),
                indepApiModel: $('#pw-api-model').val()
            };

            const responseText = await runGeneration(config, config);
            
            $('#pw-result-text').val(responseText);
            $('#pw-refine-input').val(''); 
            saveCurrentState();
            toastr.success("润色完成");

        } catch (e) {
            toastr.error(`润色失败: ${e.message}`);
        } finally {
            $btn.prop('disabled', false).html(oldText);
        }
    });

    // --- 3. 保存并应用 (世界书修复) ---
    $(document).on('click.pw', '#pw-btn-apply', async function() {
        const name = $('#pw-display-name').text();
        const finalContent = $('#pw-result-text').val();
        
        if (!finalContent) return toastr.warning("内容为空");

        // 1. 保存到 Persona
        try {
            await forceSavePersona(name, finalContent);
            toastr.success(TEXT.TOAST_SAVE_SUCCESS(name));
        } catch (e) { toastr.error(e.message); return; }

        // 2. 保存到世界书 (修复逻辑)
        if ($('#pw-wi-toggle').is(':checked')) {
            const context = getContext();
            
            // 优先级：用户手动选的 -> 绑定的 -> 警告
            const boundBooks = await getContextWorldBooks();
            let targetBook = null;

            if (window.pwExtraBooks && window.pwExtraBooks.length > 0) {
                targetBook = window.pwExtraBooks[0]; 
            } else if (boundBooks.length > 0) {
                targetBook = boundBooks[0];
            }

            if (targetBook) {
                try {
                    const h = getRequestHeaders();
                    const r = await fetch('/api/worldinfo/get', { method: 'POST', headers: h, body: JSON.stringify({ name: targetBook }) });
                    if (r.ok) {
                        const d = await r.json();
                        if (!d.entries) d.entries = {};
                        const ids = Object.keys(d.entries).map(Number);
                        const newId = ids.length ? Math.max(...ids) + 1 : 0;
                        
                        // [关键修复] 设置正确的 Entry 名字和关键词
                        const entryName = `User: ${name}`;
                        const entryKeys = [name, "User"];

                        d.entries[newId] = { 
                            uid: newId, 
                            key: entryKeys, 
                            content: finalContent, 
                            comment: entryName, 
                            enabled: true, 
                            selective: true 
                        };
                        
                        await fetch('/api/worldinfo/edit', { method: 'POST', headers: h, body: JSON.stringify({ name: targetBook, data: d }) });
                        toastr.success(TEXT.TOAST_WI_SUCCESS(targetBook));
                        if (context.updateWorldInfoList) context.updateWorldInfoList();
                    }
                } catch(e) { console.error("WI Update Failed", e); }
            } else {
                toastr.warning(TEXT.TOAST_WI_FAIL);
            }
        }

        saveHistory({
            request: $('#pw-request').val(),
            timestamp: new Date().toLocaleString(),
            targetChar: getContext().characters[getContext().characterId]?.name || "未知",
            data: { name: name, resultText: finalContent } 
        });

        $('.popup_close').click();
    });

    $(document).on('click.pw', '#pw-toggle-edit-tags', () => {
        isEditingTags = !isEditingTags;
        renderTagsList();
    });

    $(document).on('change.pw', '#pw-api-source', function() { $('#pw-indep-settings').toggle($(this).val() === 'independent'); });
    
    $(document).on('click.pw', '#pw-api-fetch', async function() {
        const btn = $(this);
        btn.html('<i class="fas fa-spinner fa-spin"></i>');
        const models = await fetchModels($('#pw-api-url').val(), $('#pw-api-key').val());
        btn.html('<i class="fa-solid fa-cloud-download-alt"></i>');
        if (models.length) {
            const list = $('#pw-model-list').empty();
            models.forEach(m => list.append(`<option value="${m}">`));
            toastr.success(TEXT.TOAST_API_OK);
        } else { toastr.error(TEXT.TOAST_API_ERR); }
    });
    
    $(document).on('click.pw', '#pw-api-save', () => { saveCurrentState(); toastr.success(TEXT.TOAST_SAVE_API); });

    $(document).on('input.pw', '#pw-history-search', renderHistoryList);
    $(document).on('click.pw', '#pw-history-search-clear', function() { $('#pw-history-search').val('').trigger('input'); });
    $(document).on('click.pw', '#pw-history-clear-all', function() {
        if (historyCache.length === 0) return;
        if(confirm("确定要清空所有历史记录吗？")) {
            historyCache = [];
            saveData();
            renderHistoryList();
        }
    });
    
    $(document).on('click.pw', '#pw-wi-add', () => {
        const val = $('#pw-wi-select').val();
        if (val && !window.pwExtraBooks.includes(val)) {
            window.pwExtraBooks.push(val);
            renderWiBooks();
        }
    });
}

// ============================================================================
// 5. 辅助渲染函数
// ============================================================================

const renderTagsList = () => {
    const $container = $('#pw-tags-list').empty();
    const $toggleBtn = $('#pw-toggle-edit-tags');

    $toggleBtn.text(isEditingTags ? '取消编辑' : '编辑标签');
    $toggleBtn.css('color', isEditingTags ? '#ff6b6b' : '#5b8db8');

    tagsCache.forEach((tag, index) => {
        if (isEditingTags) {
            const $row = $(`
                <div class="pw-tag-edit-row">
                    <input class="pw-tag-edit-input t-name" value="${tag.name}" placeholder="名">
                    <input class="pw-tag-edit-input t-val" value="${tag.value}" placeholder="值">
                    <div class="pw-tag-del-btn" title="删除"><i class="fa-solid fa-trash"></i></div>
                </div>
            `);
            $row.find('input').on('input', function() { tag.name = $row.find('.t-name').val(); tag.value = $row.find('.t-val').val(); saveData(); });
            $row.find('.pw-tag-del-btn').on('click', () => { if (confirm(`删除标签 "${tag.name}"?`)) { tagsCache.splice(index, 1); saveData(); renderTagsList(); } });
            $container.append($row);
        } else {
            const $chip = $(`
                <div class="pw-tag-chip" title="点击插入">
                    <i class="fa-solid fa-tag" style="opacity:0.5; margin-right:4px;"></i>
                    <span>${tag.name}</span>
                    ${tag.value ? `<span class="pw-tag-val">${tag.value}</span>` : ''}
                </div>
            `);
            $chip.on('click', () => {
                // 逻辑更新：如果结果区打开了，就插入到润色框；否则插入到请求框
                const tagText = tag.value ? `${tag.name}: ${tag.value}` : `${tag.name}`;
                
                if ($('#pw-result-area').is(':visible')) {
                    const $refine = $('#pw-refine-input');
                    $refine.val($refine.val() + ` 修改 ${tagText} `).focus();
                } else {
                    const $text = $('#pw-request');
                    const cur = $text.val();
                    const prefix = (cur && !cur.endsWith('\n')) ? '\n' : '';
                    $text.val(cur + prefix + tagText).focus();
                    $text[0].scrollTop = $text[0].scrollHeight;
                }
                saveData(); 
            });
            $container.append($chip);
        }
    });
    const $addBtn = $(`<div class="pw-tag-add-btn"><i class="fa-solid fa-plus"></i> ${isEditingTags ? '新增' : '标签'}</div>`);
    $addBtn.on('click', () => { tagsCache.push({ name: "", value: "" }); saveData(); if (!isEditingTags) isEditingTags = true; renderTagsList(); });
    $container.append($addBtn);
    if (isEditingTags) {
        const $finishBtn = $(`<div class="pw-tags-finish-bar"><i class="fa-solid fa-check"></i> 完成编辑</div>`);
        $finishBtn.on('click', () => { isEditingTags = false; renderTagsList(); });
        $container.append($finishBtn);
    }
};

window.pwExtraBooks = [];
const renderWiBooks = async () => {
    const container = $('#pw-wi-container').empty();
    const baseBooks = await getContextWorldBooks();
    const allBooks = [...new Set([...baseBooks, ...(window.pwExtraBooks || [])])];

    if (allBooks.length === 0) {
        container.html('<div style="opacity:0.6; padding:10px; text-align:center;">此角色未绑定世界书，请先在世界书面板绑定，或在上方手动添加。</div>');
        return;
    }

    for (const book of allBooks) {
        const isBound = baseBooks.includes(book);
        const $el = $(`
            <div class="pw-wi-book">
                <div class="pw-wi-header">
                    <span><i class="fa-solid fa-book"></i> ${book} ${isBound ? '<span style="color:#9ece6a;font-size:0.8em;margin-left:5px;">(已绑定)</span>' : ''}</span>
                    <div>
                        ${!isBound ? '<i class="fa-solid fa-times remove-book" style="color:#ff6b6b;margin-right:10px;" title="移除"></i>' : ''}
                        <i class="fa-solid fa-chevron-down arrow"></i>
                    </div>
                </div>
                <div class="pw-wi-list" data-book="${book}"></div>
            </div>
        `);
        $el.find('.remove-book').on('click', (e) => { e.stopPropagation(); window.pwExtraBooks = window.pwExtraBooks.filter(b => b !== book); renderWiBooks(); });
        $el.find('.pw-wi-header').on('click', async function() {
            const $list = $el.find('.pw-wi-list');
            const $arrow = $(this).find('.arrow');
            if ($list.is(':visible')) { $list.slideUp(); $arrow.removeClass('fa-flip-vertical'); } else {
                $list.slideDown(); $arrow.addClass('fa-flip-vertical');
                if (!$list.data('loaded')) {
                    $list.html('<div style="padding:10px;text-align:center;"><i class="fas fa-spinner fa-spin"></i></div>');
                    const entries = await getWorldBookEntries(book);
                    $list.empty();
                    if (entries.length === 0) $list.html('<div style="padding:10px;opacity:0.5;">无条目</div>');
                    entries.forEach(entry => {
                        const isChecked = entry.enabled ? 'checked' : '';
                        const $item = $(`
                            <div class="pw-wi-item">
                                <div class="pw-wi-item-row">
                                    <input type="checkbox" class="pw-wi-check" ${isChecked} data-content="${encodeURIComponent(entry.content)}">
                                    <div style="font-weight:bold; font-size:0.9em; flex:1;">${entry.displayName}</div>
                                    <i class="fa-solid fa-eye pw-wi-toggle-icon" title="查看内容"></i>
                                </div>
                                <div class="pw-wi-desc">${entry.content}<div class="pw-wi-close-bar"><i class="fa-solid fa-angle-up"></i> 收起</div></div>
                            </div>
                        `);
                        $item.find('.pw-wi-toggle-icon').on('click', function(e) { e.stopPropagation(); const $desc = $(this).closest('.pw-wi-item').find('.pw-wi-desc'); if($desc.is(':visible')) { $desc.slideUp(); $(this).css('color', ''); } else { $desc.slideDown(); $(this).css('color', '#5b8db8'); } });
                        $item.find('.pw-wi-close-bar').on('click', function() { $(this).parent().slideUp(); $item.find('.pw-wi-toggle-icon').css('color', ''); });
                        $list.append($item);
                    });
                    $list.data('loaded', true);
                }
            }
        });
        container.append($el);
    }
};

const renderHistoryList = () => {
    loadData();
    const $list = $('#pw-history-list').empty();
    const search = $('#pw-history-search').val().toLowerCase();

    const filtered = historyCache.filter(item => {
        if (!search) return true;
        const name = (item.data.name || "").toLowerCase();
        const content = (item.data.resultText || "").toLowerCase();
        return name.includes(search) || content.includes(search);
    });

    if (filtered.length === 0) {
        $list.html('<div style="text-align:center; opacity:0.6; padding:20px;">暂无历史记录</div>');
        return;
    }

    filtered.forEach((item, index) => {
        const displayTitle = item.data.name || "未命名";
        const targetChar = item.targetChar || "未知";
        const previewText = item.data.resultText || '无内容';

        const $el = $(`
            <div class="pw-history-item">
                <div class="pw-hist-main">
                    <div style="font-weight:bold; color:#e0af68;">${displayTitle}</div>
                    <div class="pw-hist-meta">
                        <span><i class="fa-solid fa-user-tag"></i> ${targetChar}</span>
                        <span><i class="fa-regular fa-clock"></i> ${item.timestamp || ''}</span>
                    </div>
                    <div class="pw-hist-desc">${previewText}</div>
                </div>
                <div class="pw-hist-del-btn"><i class="fa-solid fa-trash"></i></div>
            </div>
        `);

        $el.on('click', function(e) {
            if ($(e.target).closest('.pw-hist-del-btn').length) return;
            $('#pw-request').val(item.request);
            $('#pw-result-text').val(previewText); 
            $('#pw-result-area').show();
            $('.pw-tab[data-tab="editor"]').click();
        });

        $el.find('.pw-hist-del-btn').on('click', function(e) {
            e.stopPropagation();
            if(confirm(`删除这条记录?`)) {
                historyCache.splice(historyCache.indexOf(item), 1);
                saveData();
                renderHistoryList();
            }
        });

        $list.append($el);
    });
};

// ============================================================================
// 初始化
// ============================================================================

function addPersonaButton() {
    const container = $('.persona_controls_buttons_block');
    if (container.length === 0 || $(`#${BUTTON_ID}`).length > 0) return;

    const newButton = $(`
        <div id="${BUTTON_ID}"
             class="menu_button fa-solid fa-wand-magic-sparkles interactable"
             title="${TEXT.BTN_TITLE}"
             tabindex="0"
             role="button">
        </div>
    `);

    newButton.on('click', openCreatorPopup);
    container.prepend(newButton);
}

jQuery(async () => {
    injectStyles();
    
    addPersonaButton();

    const observer = new MutationObserver(() => {
        if ($(`#${BUTTON_ID}`).length === 0 && $('.persona_controls_buttons_block').length > 0) {
            addPersonaButton();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    console.log(`${extensionName} v18 loaded.`);
});
