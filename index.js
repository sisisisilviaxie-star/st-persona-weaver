import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, callPopup, getRequestHeaders } from "../../../../script.js";

// ============================================================================
// 1. 常量与配置
// ============================================================================

const extensionName = "st-persona-weaver";
const STORAGE_KEY_HISTORY = 'pw_history_v21'; // 版本微调
const STORAGE_KEY_STATE = 'pw_state_v21'; 
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
    TOAST_API_OK: "API 连接成功",
    TOAST_API_ERR: "API 连接失败",
    TOAST_SAVE_API: "API 设置已保存",
    TOAST_SNAPSHOT: "已存入历史记录",
    TOAST_GEN_FAIL: "生成失败，请检查 API 设置",
    TOAST_SAVE_SUCCESS: (name) => `Persona "${name}" 已保存并覆盖！`,
    TOAST_WI_SUCCESS: (book) => `已写入世界书: ${book}`,
    TOAST_WI_FAIL: "未找到目标世界书，请在插件的世界书选项卡中添加一个。",
    TOAST_WI_SELECT_HINT: "请先在上方下拉框选择一本世界书"
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

    // 强制选中该 Persona
    context.powerUserSettings.persona_selected = name;

    // 尝试更新设置面板 UI (如果打开了)
    const $nameInput = $('#your_name');
    const $descInput = $('#persona_description');
    
    if ($nameInput.length) {
        $nameInput.val(name).trigger('input').trigger('change');
    }
    if ($descInput.length) {
        $descInput.val(description).trigger('input').trigger('change');
    }

    // 强制更新主界面左侧/右侧边栏显示的 User 名字
    // ST 的 DOM 结构里，用户名字通常显示在 h5#your_name 或者 .persona_name
    const $h5Name = $('h5#your_name');
    if ($h5Name.length) $h5Name.text(name);

    await saveSettingsDebounced();
    console.log(`[PW] Persona "${name}" updated.`);
    return true;
}

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
    // 只有在打开角色卡时，才去尝试获取角色绑定的书
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
    // 兼容无角色卡情况
    const char = (context.characterId !== undefined && context.characters[context.characterId]) 
        ? context.characters[context.characterId] 
        : { name: "None", scenario: "Generic Context" };
    
    // 获取当前 User 名字 (只读)
    let currentName = $('h5#your_name').text().trim();
    if (!currentName) currentName = context.powerUserSettings?.persona_selected || "User";

    let wiText = "";
    if (data.wiContext && data.wiContext.length > 0) {
        wiText = `\n[Context from World Info]:\n${data.wiContext.join('\n\n')}\n`;
    }

    let systemPrompt = "";
    
    if (data.mode === 'refine') {
        systemPrompt = `You are a creative writing assistant optimizing a User Persona.
Target Character (for context): ${char.name}
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
3. Maintain the format (Key: Value list).
4. User Name: "${currentName}" (Immutable).

[Response Format]:
Return ONLY the Key-Value list text. No Markdown blocks.
`;
    } else {
        const targetKeys = tagsCache.map(t => t.name).filter(n => n).join(', ');
        systemPrompt = `You are a creative writing assistant creating a User Persona.
Target Character (for context): ${char.name}
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

    return responseContent.replace(/```json/g, '').replace(/```/g, '').trim();
}

// [新] 显示对比弹窗
async function showDiffPopup(oldText, newText, onAccept) {
    const html = `
    <div class="pw-diff-container">
        <div class="pw-diff-col">
            <div class="pw-diff-header" style="color:#aaa;">修改前</div>
            <textarea class="pw-diff-text" readonly>${oldText}</textarea>
        </div>
        <div class="pw-diff-col">
            <div class="pw-diff-header" style="color:#e0af68;">修改后 (可微调)</div>
            <textarea id="pw-diff-new-input" class="pw-diff-text">${newText}</textarea>
        </div>
    </div>
    <div class="pw-diff-actions">
        <div style="font-size:0.9em; opacity:0.7; align-self:center; margin-right:auto;">请确认修改内容，您可以直接在右侧编辑。</div>
        <div class="pw-btn danger" id="pw-diff-cancel" style="width:auto;">放弃修改</div>
        <div class="pw-btn save" id="pw-diff-accept" style="width:auto;">确认并应用</div>
    </div>
    `;

    await callPopup(html, 'text', '', { wide: true, large: true, okButton: false, cancelButton: false });

    const cleanup = () => { $(document).off('click.pw_diff'); };

    $(document).on('click.pw_diff', '#pw-diff-cancel', function() {
        $(this).closest('.ji-popup, .popup').find('.popup_close').click(); 
        cleanup();
    });

    $(document).on('click.pw_diff', '#pw-diff-accept', function() {
        const finalVal = $('#pw-diff-new-input').val();
        onAccept(finalVal);
        $(this).closest('.ji-popup, .popup').find('.popup_close').click();
        cleanup();
    });
}

// ============================================================================
// 3. UI 渲染
// ============================================================================

async function openCreatorPopup() {
    const context = getContext();
    // [修复] 即使没有角色卡也能打开
    
    loadData();
    await loadAvailableWorldBooks();
    const savedState = loadState();
    const config = { ...defaultSettings, ...extension_settings[extensionName], ...savedState.localConfig };
    
    // 获取当前 User 名字 (只读)
    let currentName = $('h5#your_name').text().trim();
    if (!currentName) currentName = context.powerUserSettings?.persona_selected || "User";

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
                <div class="pw-info-display">
                    <div class="pw-info-item"><i class="fa-solid fa-user"></i><span id="pw-display-name">${currentName}</span></div>
                </div>

                <!-- 结果展示区域 (优先) -->
                <div id="pw-result-area" class="pw-result-container">
                    <div class="pw-result-tools-bar">
                        <div style="margin-right:auto; font-weight:bold; color:#5b8db8; padding:5px;"><i class="fa-solid fa-file-alt"></i> 设定文本</div>
                        <i class="fa-solid fa-eraser" id="pw-clear" title="清空所有"></i>
                        <i class="fa-solid fa-expand" id="pw-btn-expand" title="全屏编辑"></i>
                    </div>
                    
                    <textarea id="pw-result-text" class="pw-result-textarea" placeholder="在此输入初始设定，或者点击下方生成...">${savedState.resultText || ''}</textarea>

                    <!-- 底部润色栏 (Sticky Style) -->
                    <div class="pw-refine-area">
                        <div class="pw-refine-input-row">
                            <textarea id="pw-refine-input" class="pw-refine-textarea" rows="1" placeholder="输入修改意见 (选中文字点击'引用'可定向修改)..."></textarea>
                            <div class="pw-refine-btns">
                                <button class="pw-btn" id="pw-insert-selection" title="引用选中文字"><i class="fa-solid fa-quote-left"></i> 引用</button>
                                <button class="pw-btn primary" id="pw-btn-refine"><i class="fa-solid fa-magic"></i> 润色</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 初始生成触发器 -->
                <div style="margin-top:15px; border-top:1px dashed var(--SmartThemeBorderColor); padding-top:10px;">
                    <div class="pw-tags-header">
                        <span class="pw-tags-label">点击标签生成初始设定</span>
                        <span class="pw-tags-edit-toggle" id="pw-toggle-edit-tags">编辑标签</span>
                    </div>
                    <div class="pw-tags-container" id="pw-tags-list"></div>
                    <button id="pw-btn-gen" class="pw-btn gen"><i class="fa-solid fa-bolt"></i> 基于标签/文本 生成新设定</button>
                </div>

                <!-- 底部动作栏 -->
                <div class="pw-bottom-actions">
                    <div class="pw-bottom-left">
                        <div class="pw-btn" id="pw-snapshot" style="opacity:0.8;"><i class="fa-solid fa-save"></i> 存入历史</div>
                        <div class="pw-btn danger" id="pw-clear-history-btn" style="display:none;"><i class="fa-solid fa-trash"></i></div>
                    </div>
                    <div class="pw-bottom-right">
                        <div class="pw-wi-check-container"><input type="checkbox" id="pw-wi-toggle" checked><span>同步进世界书</span></div>
                        <button id="pw-btn-apply" class="pw-btn save"><i class="fa-solid fa-check"></i> 保存并覆盖当前设定</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 其他视图 (World Info / API / History) -->
        <div id="pw-view-context" class="pw-view"><div class="pw-scroll-area"><div class="pw-card-section"><div class="pw-wi-controls"><select id="pw-wi-select" class="pw-input pw-wi-select"><option value="">-- 添加参考/目标世界书 --</option>${wiOptions}</select><button id="pw-wi-add" class="pw-btn primary pw-wi-add-btn"><i class="fa-solid fa-plus"></i></button></div></div><div id="pw-wi-container"></div></div></div>
        
        <div id="pw-view-api" class="pw-view"><div class="pw-scroll-area"><div class="pw-card-section"><div class="pw-row"><label>API 来源</label><select id="pw-api-source" class="pw-input" style="flex:1;"><option value="main" ${config.apiSource === 'main'?'selected':''}>使用主 API</option><option value="independent" ${config.apiSource === 'independent'?'selected':''}>独立 API</option></select></div><div id="pw-indep-settings" style="display:${config.apiSource === 'independent' ? 'flex' : 'none'}; flex-direction:column; gap:15px;"><div class="pw-row"><label>URL</label><input type="text" id="pw-api-url" class="pw-input" value="${config.indepApiUrl}" style="flex:1;"></div><div class="pw-row"><label>Key</label><input type="password" id="pw-api-key" class="pw-input" value="${config.indepApiKey}" style="flex:1;"></div><div class="pw-row pw-api-model-row"><label>Model</label><div style="flex:1; display:flex; gap:5px; width:100%;"><input type="text" id="pw-api-model" class="pw-input" value="${config.indepApiModel}" list="pw-model-list" style="flex:1;"><datalist id="pw-model-list"></datalist><button id="pw-api-fetch" class="pw-btn primary pw-api-fetch-btn" title="获取模型" style="width:auto;"><i class="fa-solid fa-cloud-download-alt"></i></button></div></div></div><div style="text-align:right;"><button id="pw-api-save" class="pw-btn primary" style="width:auto;"><i class="fa-solid fa-save"></i> 保存设置</button></div></div></div></div>
        
        <div id="pw-view-history" class="pw-view"><div class="pw-scroll-area"><div class="pw-search-box"><input type="text" id="pw-history-search" class="pw-input pw-search-input" placeholder="🔍 搜索历史..."><i class="fa-solid fa-times pw-search-clear" id="pw-history-search-clear" title="清空搜索"></i></div><div id="pw-history-list" style="display:flex; flex-direction:column;"></div><button id="pw-history-clear-all" class="pw-btn danger"><i class="fa-solid fa-trash-alt"></i> 清空所有历史记录</button></div></div>
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

    const autoResize = (el) => {
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
    };
    $(document).on('input.pw', '.pw-refine-textarea', function() { autoResize(this); });

    const saveCurrentState = () => {
        saveState({
            resultText: $('#pw-result-text').val(),
            localConfig: {
                apiSource: $('#pw-api-source').val(),
                indepApiUrl: $('#pw-api-url').val(),
                indepApiKey: $('#pw-api-key').val(),
                indepApiModel: $('#pw-api-model').val(),
                extraBooks: window.pwExtraBooks || []
            }
        });
    };
    $(document).on('input.pw change.pw', '#pw-result-text, .pw-input', saveCurrentState);

    $(document).on('click.pw', '.pw-tab', function() {
        $('.pw-tab').removeClass('active');
        $(this).addClass('active');
        $('.pw-view').removeClass('active');
        const tab = $(this).data('tab');
        $(`#pw-view-${tab}`).addClass('active');
        if(tab === 'history') renderHistoryList(); 
    });

    // 引用 (换行追加)
    $(document).on('click.pw', '#pw-insert-selection', function() {
        const textarea = document.getElementById('pw-result-text');
        if (textarea) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const selectedText = textarea.value.substring(start, end).trim();
            if (selectedText) {
                const $input = $('#pw-refine-input');
                let current = $input.val();
                if (current) current += "\n"; 
                $input.val(current + `将 "${selectedText}" 修改为: `).focus();
                autoResize($input[0]);
            } else {
                toastr.info("请先在文本框中划选文字");
            }
        }
    });

    // 全屏编辑 (修复：保存后不关闭插件)
    $(document).on('click.pw', '#pw-btn-expand', async function() {
        const currentVal = $('#pw-result-text').val();
        const popupHtml = `<textarea id="pw-expanded-text" class="pw-textarea" style="width:100%; height:600px; font-size:1.1em;">${currentVal}</textarea>`;
        // 这里只是一个临时的全屏 popup，关闭它不应影响主界面
        await callPopup(popupHtml, 'text', '', { wide: true, large: true, okButton: "应用修改" });
        const newVal = $('#pw-expanded-text').val();
        if (newVal !== undefined) {
            $('#pw-result-text').val(newVal).trigger('input');
        }
    });

    // 清空
    $(document).on('click.pw', '#pw-clear', function() {
        if(confirm("清空输入内容？")) {
            $('#pw-result-text').val('');
            $('#pw-refine-input').val('');
            saveCurrentState();
        }
    });

    // 存入历史
    $(document).on('click.pw', '#pw-snapshot', function() {
        const curName = $('h5#your_name').text();
        const curText = $('#pw-result-text').val();
        if (!curText) return toastr.warning("内容为空");
        saveHistory({ 
            timestamp: new Date().toLocaleString(),
            targetChar: getContext().characters[getContext().characterId]?.name || "无角色",
            data: { name: curName, resultText: curText } 
        });
        toastr.success(TEXT.TOAST_SNAPSHOT);
    });

    // 生成
    $(document).on('click.pw', '#pw-btn-gen', async function() {
        const curText = $('#pw-result-text').val();
        // 即使没有文本，也可以直接点击生成，这时候把空文本传过去
        const request = curText ? `基于以下草稿优化:\n${curText}` : "生成一个新的设定";

        const $btn = $(this);
        const oldText = $btn.html();
        $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> 生成中...');

        try {
            const wiContext = [];
            $('.pw-wi-check:checked').each(function() { wiContext.push(decodeURIComponent($(this).data('content'))); });

            const config = {
                mode: curText ? 'refine' : 'initial',
                request: request,
                currentText: curText,
                wiContext: wiContext,
                apiSource: $('#pw-api-source').val(),
                indepApiUrl: $('#pw-api-url').val(),
                indepApiKey: $('#pw-api-key').val(),
                indepApiModel: $('#pw-api-model').val()
            };

            const responseText = await runGeneration(config, config);
            $('#pw-result-text').val(responseText);
            saveCurrentState();
        } catch (e) { toastr.error(`${TEXT.TOAST_GEN_FAIL}: ${e.message}`); } 
        finally { $btn.prop('disabled', false).html(oldText); }
    });

    // 润色 (带对比)
    $(document).on('click.pw', '#pw-btn-refine', async function() {
        const refineReq = $('#pw-refine-input').val();
        if (!refineReq) return toastr.warning("请输入润色意见");
        const currentRawText = $('#pw-result-text').val();
        const $btn = $(this);
        $btn.html('<i class="fas fa-spinner fa-spin"></i>');
        
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
            
            showDiffPopup(currentRawText, responseText, (finalText) => {
                $('#pw-result-text').val(finalText).trigger('input');
                $('#pw-refine-input').val('');
                saveCurrentState();
            });

        } catch (e) { toastr.error(`润色失败: ${e.message}`); }
        finally { $btn.html('<i class="fa-solid fa-magic"></i> 润色'); }
    });

    // 保存并覆盖
    $(document).on('click.pw', '#pw-btn-apply', async function() {
        const name = $('h5#your_name').text();
        const finalContent = $('#pw-result-text').val();
        if (!finalContent) return toastr.warning("内容为空");

        // 1. 保存 Persona
        try {
            await forceSavePersona(name, finalContent);
            toastr.success(TEXT.TOAST_SAVE_SUCCESS(name));
        } catch (e) { toastr.error(e.message); return; }

        // 2. 世界书保存 (修复逻辑：优先用手动选中的)
        if ($('#pw-wi-toggle').is(':checked')) {
            const context = getContext();
            
            // 查找逻辑：
            // A. 手动在插件下拉框里选了书 (window.pwExtraBooks) -> 优先写入这一本
            // B. 角色卡绑定的书 (boundBooks) -> 其次
            
            const boundBooks = await getContextWorldBooks();
            let targetBook = null;

            if (window.pwExtraBooks && window.pwExtraBooks.length > 0) {
                targetBook = window.pwExtraBooks[0]; // 取最近添加的
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
                        
                        const entryName = `User: ${name}`;
                        const entryKeys = [name, "User"];

                        // 查找已存在条目进行覆盖
                        let targetId = -1;
                        for (const [uid, entry] of Object.entries(d.entries)) {
                            // 匹配 Name 或 Key 包含 User+Name
                            if (entry.comment === entryName || (entry.key && entry.key.includes(name) && entry.key.includes("User"))) {
                                targetId = Number(uid);
                                break;
                            }
                        }
                        // 新建 ID
                        if (targetId === -1) {
                            const ids = Object.keys(d.entries).map(Number);
                            targetId = ids.length ? Math.max(...ids) + 1 : 0;
                        }

                        d.entries[targetId] = { 
                            uid: targetId, 
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

        $('.popup_close').click();
    });

    $(document).on('click.pw', '#pw-toggle-edit-tags', () => { isEditingTags = !isEditingTags; renderTagsList(); });
    // ... API & History handlers ... (同前)
    $(document).on('change.pw', '#pw-api-source', function() { $('#pw-indep-settings').toggle($(this).val() === 'independent'); });
    $(document).on('click.pw', '#pw-api-fetch', async function() { /*...*/ });
    $(document).on('click.pw', '#pw-api-save', () => { saveCurrentState(); toastr.success(TEXT.TOAST_SAVE_API); });
    $(document).on('input.pw', '#pw-history-search', renderHistoryList);
    $(document).on('click.pw', '#pw-history-search-clear', function() { $('#pw-history-search').val('').trigger('input'); });
    $(document).on('click.pw', '#pw-history-clear-all', function() { if(confirm("清空?")){historyCache=[];saveData();renderHistoryList();} });
    $(document).on('click.pw', '#pw-wi-add', () => { const val = $('#pw-wi-select').val(); if (val && !window.pwExtraBooks.includes(val)) { window.pwExtraBooks.push(val); renderWiBooks(); } });
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
            const $row = $(`<div class="pw-tag-edit-row"><input class="pw-tag-edit-input t-name" value="${tag.name}"><input class="pw-tag-edit-input t-val" value="${tag.value}"><div class="pw-tag-del-btn"><i class="fa-solid fa-trash"></i></div></div>`);
            $row.find('input').on('input', function() { tag.name = $row.find('.t-name').val(); tag.value = $row.find('.t-val').val(); saveData(); });
            $row.find('.pw-tag-del-btn').on('click', () => { if (confirm("删除?")) { tagsCache.splice(index, 1); saveData(); renderTagsList(); } });
            $container.append($row);
        } else {
            const $chip = $(`<div class="pw-tag-chip"><i class="fa-solid fa-tag" style="opacity:0.5; margin-right:4px;"></i><span>${tag.name}</span>${tag.value ? `<span class="pw-tag-val">${tag.value}</span>` : ''}</div>`);
            $chip.on('click', () => {
                const tagText = tag.value ? `${tag.name}: ${tag.value}` : `${tag.name}`;
                // 逻辑更新：点击标签现在插入到 润色框
                const $refine = $('#pw-refine-input');
                let current = $refine.val();
                if(current) current += "\n";
                $refine.val(current + ` 修改/添加 ${tagText} `).focus();
                $refine.trigger('input'); // 触发高度调整
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

// ... Wi Books 渲染同前，但为空时文案微调 ...
window.pwExtraBooks = [];
const renderWiBooks = async () => {
    const container = $('#pw-wi-container').empty();
    const baseBooks = await getContextWorldBooks();
    const allBooks = [...new Set([...baseBooks, ...(window.pwExtraBooks || [])])];

    if (allBooks.length === 0) {
        container.html('<div style="opacity:0.6; padding:10px; text-align:center;">暂无世界书。若要同步保存User设定到世界书，请在上方手动添加一本。</div>');
        return;
    }
    // ... 列表循环渲染保持原样 ...
    for (const book of allBooks) {
        const isBound = baseBooks.includes(book);
        const $el = $(`<div class="pw-wi-book"><div class="pw-wi-header"><span><i class="fa-solid fa-book"></i> ${book} ${isBound ? '<span style="color:#9ece6a;font-size:0.8em;">(绑)</span>' : ''}</span><div>${!isBound ? '<i class="fa-solid fa-times remove-book" style="color:#ff6b6b;margin-right:10px;"></i>' : ''}<i class="fa-solid fa-chevron-down arrow"></i></div></div><div class="pw-wi-list" data-book="${book}"></div></div>`);
        $el.find('.remove-book').on('click', (e) => { e.stopPropagation(); window.pwExtraBooks = window.pwExtraBooks.filter(b => b !== book); renderWiBooks(); });
        $el.find('.pw-wi-header').on('click', async function() {
            const $list = $el.find('.pw-wi-list');
            const $arrow = $(this).find('.arrow');
            if ($list.is(':visible')) { $list.slideUp(); $arrow.removeClass('fa-flip-vertical'); } else {
                $list.slideDown(); $arrow.addClass('fa-flip-vertical');
                if (!$list.data('loaded')) {
                    $list.html('<i class="fas fa-spinner fa-spin"></i>');
                    const entries = await getWorldBookEntries(book);
                    $list.empty();
                    entries.forEach(entry => {
                        const isChecked = entry.enabled ? 'checked' : '';
                        const $item = $(`<div class="pw-wi-item"><div class="pw-wi-item-row"><input type="checkbox" class="pw-wi-check" ${isChecked} data-content="${encodeURIComponent(entry.content)}"><div style="font-weight:bold; font-size:0.9em; flex:1;">${entry.displayName}</div><i class="fa-solid fa-eye pw-wi-toggle-icon"></i></div><div class="pw-wi-desc">${entry.content}</div></div>`);
                        $item.find('.pw-wi-toggle-icon').on('click', function(e) { e.stopPropagation(); const $d = $(this).closest('.pw-wi-item').find('.pw-wi-desc'); $d.slideToggle(); });
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
    if (filtered.length === 0) { $list.html('<div style="text-align:center; opacity:0.6; padding:20px;">暂无历史记录</div>'); return; }
    filtered.forEach((item, index) => {
        const displayTitle = item.data.name || "未命名";
        const previewText = item.data.resultText || '无内容';
        const $el = $(`<div class="pw-history-item"><div class="pw-hist-main"><div style="font-weight:bold; color:#e0af68;">${displayTitle}</div><div class="pw-hist-meta"><span>${item.timestamp || ''}</span></div><div class="pw-hist-desc">${previewText}</div></div><div class="pw-hist-del-btn"><i class="fa-solid fa-trash"></i></div></div>`);
        $el.on('click', function(e) {
            if ($(e.target).closest('.pw-hist-del-btn').length) return;
            $('#pw-result-text').val(previewText); 
            $('.pw-tab[data-tab="editor"]').click();
        });
        $el.find('.pw-hist-del-btn').on('click', function(e) { e.stopPropagation(); if(confirm("删除?")) { historyCache.splice(historyCache.indexOf(item), 1); saveData(); renderHistoryList(); } });
        $list.append($el);
    });
};

function addPersonaButton() {
    const container = $('.persona_controls_buttons_block');
    if (container.length === 0 || $(`#${BUTTON_ID}`).length > 0) return;
    const newButton = $(`<div id="${BUTTON_ID}" class="menu_button fa-solid fa-wand-magic-sparkles interactable" title="${TEXT.BTN_TITLE}" tabindex="0" role="button"></div>`);
    newButton.on('click', openCreatorPopup);
    container.prepend(newButton);
}

jQuery(async () => {
    injectStyles();
    addPersonaButton();
    const observer = new MutationObserver(() => { if ($(`#${BUTTON_ID}`).length === 0 && $('.persona_controls_buttons_block').length > 0) addPersonaButton(); });
    observer.observe(document.body, { childList: true, subtree: true });
    console.log(`${extensionName} v18 loaded.`);
});
