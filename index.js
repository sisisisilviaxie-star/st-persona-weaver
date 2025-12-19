import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, callPopup, getRequestHeaders } from "../../../../script.js";

// ============================================================================
// 1. 常量与配置
// ============================================================================

const extensionName = "st-persona-weaver";
const STORAGE_KEY_HISTORY = 'pw_history_v21'; // 更新版本号以清理旧数据
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
    TOAST_WI_SUCCESS: (book) => `已同步写入世界书: ${book}`,
    TOAST_WI_FAIL: "未找到有效的世界书，无法同步保存 (请先添加或绑定)"
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
    const styleId = 'persona-weaver-css-v21';
    if ($(`#${styleId}`).length) return;
    // 样式已在 style.css 中定义，这里仅做检查占位
}

// [核心] 暴力写入 Persona 到 SillyTavern
async function forceSavePersona(name, description) {
    const context = getContext();
    if (!context.powerUserSettings.personas) context.powerUserSettings.personas = {};
    context.powerUserSettings.personas[name] = description;

    // 强制选中
    context.powerUserSettings.persona_selected = name;

    // 尝试更新设置面板 UI (如果用户正打开着设置)
    const $nameInput = $('#your_name');
    const $descInput = $('#persona_description');
    
    if ($nameInput.length) {
        $nameInput.val(name).trigger('input').trigger('change');
    }
    if ($descInput.length) {
        $descInput.val(description).trigger('input').trigger('change');
    }

    // 强制更新左侧栏名字显示
    const $h5Name = $('h5#your_name');
    if ($h5Name.length) $h5Name.text(name);

    await saveSettingsDebounced();
    console.log(`[PW] Persona "${name}" updated.`);
    return true;
}

// [修复] 加载所有可用世界书 (兼容多种 API 返回格式)
async function loadAvailableWorldBooks() {
    availableWorldBooks = [];
    try {
        const response = await fetch('/api/worldinfo/get', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({}) });
        if (response.ok) {
            const data = await response.json();
            
            // 情况1: { world_names: ["book1", "book2"] }
            if (data.world_names && Array.isArray(data.world_names)) {
                availableWorldBooks = data.world_names;
            } 
            // 情况2: ["book1", "book2"] (旧版 API)
            else if (Array.isArray(data)) {
                availableWorldBooks = data.map(item => {
                    return typeof item === 'string' ? item : (item.name || "");
                });
            }
        }
    } catch (e) { console.error("[PW] Error loading WI list:", e); }
    
    // 去重并排序
    availableWorldBooks = [...new Set(availableWorldBooks)].filter(x => x).sort();
}

// [修复] 获取当前上下文绑定的世界书
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
    }
    
    // 检查聊天绑定的世界书
    if (context.chatMetadata?.world_info) {
        books.add(context.chatMetadata.world_info);
    }
    
    return Array.from(books).filter(Boolean);
}

// 获取世界书条目 (用于生成时的上下文参考)
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

// [核心] 生成与润色请求
async function runGeneration(data, apiConfig) {
    const context = getContext();
    // 即使没打开角色，也要能运行
    const char = (context.characterId !== undefined) ? context.characters[context.characterId] : null;
    const charName = char ? char.name : "Unknown Character";
    const charScenario = (char && char.scenario) ? char.scenario : "Generic Scenario";
    
    // 获取当前 Persona 名字
    const currentName = $('h5#your_name').text().trim() || context.powerUserSettings?.persona_selected || "User";

    let wiText = "";
    if (data.wiContext && data.wiContext.length > 0) {
        wiText = `\n[Reference Context from World Info]:\n${data.wiContext.join('\n\n')}\n`;
    }

    let systemPrompt = "";
    
    if (data.mode === 'refine') {
        // === 润色模式 ===
        systemPrompt = `You are a creative writing assistant optimizing a User Persona.
Target Character: ${charName}
Scenario: ${charScenario}
${wiText}

[Current Persona Data]:
"""
${data.currentText}
"""

[Refinement Instruction]:
"${data.request}"

[Task]:
1. Modify the Persona Data according to the instruction.
2. If the user provided a specific text segment in quotes, focus on modifying that part.
3. Maintain the "Key: Value" list format (or paragraph format if used).
4. User Name: "${currentName}" (Immutable).

[Response Format]:
Return ONLY the updated body text. Do not wrap in JSON or Markdown blocks.
`;
    } else {
        // === 初次生成模式 ===
        const targetKeys = tagsCache.map(t => t.name).filter(n => n).join(', ');

        systemPrompt = `You are a creative writing assistant creating a User Persona.
Target Character: ${charName}
Scenario: ${charScenario}
${wiText}

[User Request]:
${data.request}

[Task]:
1. Create a detailed Persona for "${currentName}".
2. Use "Key: Value" format for traits (one per line).
3. Recommended Keys: ${targetKeys}.

[Response Format]:
Return ONLY the body text.
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

    // 清理 markdown
    return responseContent.replace(/```json/g, '').replace(/```/g, '').trim();
}

// ============================================================================
// 3. UI 渲染与 HTML 模板
// ============================================================================

async function openCreatorPopup() {
    const context = getContext();
    
    // 加载数据
    loadData();
    await loadAvailableWorldBooks();
    const savedState = loadState();
    const config = { ...defaultSettings, ...extension_settings[extensionName], ...savedState.localConfig };
    
    // 获取当前名字
    let currentName = $('h5#your_name').text().trim();
    if (!currentName) currentName = context.powerUserSettings?.persona_selected || "User";

    // 构建世界书下拉框
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
                        <span class="pw-tags-label">快速设定 (点击标签填入上方)</span>
                        <span class="pw-tags-edit-toggle" id="pw-toggle-edit-tags">编辑标签</span>
                    </div>
                    <div class="pw-tags-container" id="pw-tags-list"></div>
                </div>

                <textarea id="pw-request" class="pw-textarea" placeholder="在此输入初始设定要求..." style="min-height:80px;">${savedState.request || ''}</textarea>
                <button id="pw-btn-gen" class="pw-btn gen"><i class="fa-solid fa-bolt"></i> 生成设定</button>

                <!-- 3. 结果展示区域 (Flex 布局) -->
                <div id="pw-result-area" class="pw-result-container" style="display:none;">
                    <div style="font-weight:bold; color:#5b8db8; margin-bottom:5px;"><i class="fa-solid fa-list-ul"></i> 设定详情</div>
                    
                    <!-- 正常结果框 -->
                    <div class="pw-result-wrapper">
                        <textarea id="pw-result-text" class="pw-result-textarea" placeholder="生成的结果将显示在这里..."></textarea>
                        <div class="pw-expand-icon" id="pw-btn-expand" title="全屏编辑"><i class="fa-solid fa-expand"></i></div>
                    </div>

                    <!-- 润色栏 (在文本框下方，自动高度) -->
                    <div class="pw-refine-toolbar">
                        <textarea id="pw-refine-input" class="pw-refine-textarea" rows="1" placeholder="输入修改意见 (选中上方文字后点击右侧引用)..."></textarea>
                        <div class="pw-tool-icon" id="pw-insert-selection" title="引用：将选中的文字填入修改框"><i class="fa-solid fa-quote-left"></i> 引用</div>
                        <div class="pw-tool-icon" id="pw-btn-refine" title="执行润色"><i class="fa-solid fa-magic"></i> 润色</div>
                    </div>

                    <!-- Diff 对比区域 (默认隐藏) -->
                    <div id="pw-diff-area" class="pw-diff-container">
                        <div class="pw-diff-header">
                            <span>润色对比确认</span>
                            <i class="fa-solid fa-times" style="cursor:pointer;" onclick="$('#pw-diff-area').hide();$('.pw-result-wrapper').show();$('.pw-refine-toolbar').show();"></i>
                        </div>
                        <div class="pw-diff-body">
                            <div class="pw-diff-pane">
                                <div class="pw-diff-label">修改前</div>
                                <textarea id="pw-diff-old" class="pw-diff-text readonly" readonly></textarea>
                            </div>
                            <div class="pw-diff-pane">
                                <div class="pw-diff-label" style="color:#e0af68;">修改后 (可编辑)</div>
                                <textarea id="pw-diff-new" class="pw-diff-text editable"></textarea>
                            </div>
                        </div>
                        <div class="pw-diff-actions">
                            <button class="pw-btn danger" id="pw-diff-cancel" style="width:auto;">放弃</button>
                            <button class="pw-btn save" id="pw-diff-confirm" style="width:auto;">应用修改</button>
                        </div>
                    </div>

                    <!-- 底部动作栏 -->
                    <div class="pw-bottom-actions">
                        <div class="pw-bottom-left">
                            <div class="pw-mini-btn" id="pw-snapshot"><i class="fa-solid fa-save"></i> 存入历史</div>
                            <div class="pw-mini-btn" id="pw-clear"><i class="fa-solid fa-eraser"></i> 清空</div>
                        </div>
                        <div class="pw-bottom-right">
                            <div class="pw-wi-check-container">
                                <input type="checkbox" id="pw-wi-toggle" checked>
                                <span>同步进世界书</span>
                            </div>
                            <button id="pw-btn-apply" class="pw-btn save" style="width:auto;"><i class="fa-solid fa-check"></i> 保存并覆盖当前设定</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 其他页面 (Context, API, History) -->
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
                        <div class="pw-row"><label>URL</label><input type="text" id="pw-api-url" class="pw-input" value="${config.indepApiUrl}" style="flex:1;"></div>
                        <div class="pw-row"><label>Key</label><input type="password" id="pw-api-key" class="pw-input" value="${config.indepApiKey}" style="flex:1;"></div>
                        <div class="pw-row pw-api-model-row"><label>Model</label><div style="flex:1; display:flex; gap:5px; width:100%;"><input type="text" id="pw-api-model" class="pw-input" value="${config.indepApiModel}" list="pw-model-list" style="flex:1;"><datalist id="pw-model-list"></datalist><button id="pw-api-fetch" class="pw-btn primary pw-api-fetch-btn" title="获取模型" style="width:auto;"><i class="fa-solid fa-cloud-download-alt"></i></button></div></div>
                    </div>
                    <div style="text-align:right;">
                        <button id="pw-api-save" class="pw-btn primary" style="width:auto;"><i class="fa-solid fa-save"></i> 保存设置</button>
                    </div>
                </div>
            </div>
        </div>

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
    
    // 如果有上次的状态，恢复
    if (savedState.resultText) {
        $('#pw-result-text').val(savedState.resultText);
        $('#pw-result-area').show();
    }
}

// ============================================================================
// 4. 全屏编辑弹窗逻辑 (独立逻辑，类似主界面)
// ============================================================================

async function openExpandPopup() {
    const currentVal = $('#pw-result-text').val();
    
    const html = `
    <div style="display:flex; flex-direction:column; height:100%; gap:10px;">
        <textarea id="pw-expanded-textarea" class="pw-textarea" style="flex:1; width:100%; resize:none; font-family:inherit;">${currentVal}</textarea>
        
        <div class="pw-refine-toolbar" style="border-radius:6px; background:rgba(0,0,0,0.3);">
            <textarea id="pw-expanded-refine-input" class="pw-refine-textarea" rows="1" placeholder="输入修改意见 (选中文字后点击右侧引用)..."></textarea>
            <div class="pw-tool-icon" id="pw-expanded-quote" title="引用"><i class="fa-solid fa-quote-left"></i> 引用</div>
            <div class="pw-tool-icon" id="pw-expanded-run" title="润色"><i class="fa-solid fa-magic"></i> 润色</div>
        </div>
    </div>
    `;

    // 开启弹窗
    await callPopup(html, 'text', '', { wide: true, large: true, okButton: "应用并返回" });
    
    // 关闭后（即点击了应用并返回），手动同步数据
    const newVal = $('#pw-expanded-textarea').val();
    if (newVal !== undefined) {
        $('#pw-result-text').val(newVal).trigger('input');
    }
}

// 全屏弹窗的事件绑定需要在外部做委托，因为 callPopup 是异步的但 DOM 立即插入
$(document).on(`click.pw_expand`, '#pw-expanded-quote', function() {
    const ta = document.getElementById('pw-expanded-textarea');
    if (!ta) return;
    const start = ta.selectionStart; const end = ta.selectionEnd;
    const txt = ta.value.substring(start, end).trim();
    if(txt) {
        const $i = $('#pw-expanded-refine-input');
        const oldVal = $i.val();
        $i.val((oldVal ? oldVal + '\n' : '') + `引用: "${txt}"`).trigger('input').focus();
    } else {
        toastr.info("请先划选文字");
    }
});

$(document).on(`click.pw_expand`, '#pw-expanded-run', async function() {
    const req = $('#pw-expanded-refine-input').val(); 
    if(!req) return toastr.warning("请输入意见");
    
    const cur = $('#pw-expanded-textarea').val();
    const $btn = $(this); const oldH = $btn.html();
    $btn.html('<i class="fas fa-spinner fa-spin"></i>').css('pointer-events','none');
    
    try {
        const config = {
            mode: 'refine', request: req, currentText: cur,
            apiSource: $('#pw-api-source').val(),
            indepApiUrl: $('#pw-api-url').val(),
            indepApiKey: $('#pw-api-key').val(),
            indepApiModel: $('#pw-api-model').val()
        };
        const res = await runGeneration(config, config);
        $('#pw-expanded-textarea').val(res);
        $('#pw-expanded-refine-input').val('');
        toastr.success("润色完成 (全屏模式)");
    } catch(e){ toastr.error(e.message); } 
    finally { $btn.html(oldH).css('pointer-events','auto'); }
});

// ============================================================================
// 5. 事件绑定 (Main)
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

    // 自动高度 Textarea
    $(document).on('input.pw', '#pw-refine-input, #pw-expanded-refine-input', function() {
        this.style.height = 'auto'; 
        this.style.height = (this.scrollHeight) + 'px';
    });

    $(document).on('click.pw', '.pw-tab', function() {
        $('.pw-tab').removeClass('active'); $(this).addClass('active');
        $('.pw-view').removeClass('active'); $(`#pw-view-${$(this).data('tab')}`).addClass('active');
        if($(this).data('tab') === 'history') renderHistoryList(); 
    });

    // 引用 (追加模式)
    $(document).on('click.pw', '#pw-insert-selection', function() {
        const textarea = document.getElementById('pw-result-text');
        if (textarea) {
            const start = textarea.selectionStart; const end = textarea.selectionEnd;
            const selectedText = textarea.value.substring(start, end).trim();
            if (selectedText) {
                const $input = $('#pw-refine-input');
                const cur = $input.val();
                const newVal = cur ? `${cur}\n引用: "${selectedText}"` : `引用: "${selectedText}"`;
                $input.val(newVal).trigger('input').focus();
            } else { toastr.info("请先在上方文本框中划选文字"); }
        }
    });

    // 打开全屏
    $(document).on('click.pw', '#pw-btn-expand', openExpandPopup);

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
        const curName = $('h5#your_name').text();
        const curText = $('#pw-result-text').val();
        
        if (!req && !curText) return toastr.warning("内容为空");
        
        saveHistory({ 
            request: req || "无请求内容", 
            timestamp: new Date().toLocaleString(),
            targetChar: getContext().characters[getContext().characterId]?.name || "N/A",
            data: { name: curName, resultText: curText } 
        });
        toastr.success(TEXT.TOAST_SNAPSHOT);
    });

    // 生成
    $(document).on('click.pw', '#pw-btn-gen', async function() {
        const req = $('#pw-request').val();
        if (!req) return toastr.warning("请输入设定要求");

        const $btn = $(this); const oldText = $btn.html();
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
            
            // 重置可能存在的 Diff 界面
            $('#pw-diff-area').hide();
            $('.pw-result-wrapper').show();
            $('.pw-refine-toolbar').show();
            
            saveCurrentState();

        } catch (e) {
            toastr.error(`${TEXT.TOAST_GEN_FAIL}: ${e.message}`);
        } finally {
            $btn.prop('disabled', false).html(oldText);
        }
    });

    // 润色 (触发 Diff 模式)
    $(document).on('click.pw', '#pw-btn-refine', async function() {
        const refineReq = $('#pw-refine-input').val();
        if (!refineReq) return toastr.warning("请输入润色意见");

        const currentRawText = $('#pw-result-text').val();
        const $btn = $(this); const oldHtml = $btn.html();
        $btn.html('<i class="fas fa-spinner fa-spin"></i>').css('pointer-events','none');

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
            
            // 切换到 Diff 视图
            $('.pw-result-wrapper').hide();
            $('.pw-refine-toolbar').hide();
            
            $('#pw-diff-old').val(currentRawText);
            $('#pw-diff-new').val(responseText);
            $('#pw-diff-area').css('display', 'flex');
            
            $('#pw-refine-input').val(''); 
            
        } catch (e) {
            toastr.error(`润色失败: ${e.message}`);
        } finally {
            $btn.html(oldHtml).css('pointer-events','auto');
        }
    });

    // Diff 确认与取消
    $(document).on('click.pw', '#pw-diff-confirm', function() {
        const acceptedText = $('#pw-diff-new').val();
        $('#pw-result-text').val(acceptedText);
        
        $('#pw-diff-area').hide();
        $('.pw-result-wrapper').show();
        $('.pw-refine-toolbar').show();
        saveCurrentState();
    });

    $(document).on('click.pw', '#pw-diff-cancel', function() {
        $('#pw-diff-area').hide();
        $('.pw-result-wrapper').show();
        $('.pw-refine-toolbar').show();
    });

    // 保存并覆盖
    $(document).on('click.pw', '#pw-btn-apply', async function() {
        const name = $('h5#your_name').text() || "User";
        const finalContent = $('#pw-result-text').val();
        
        if (!finalContent) return toastr.warning("内容为空");

        // 1. 保存 Persona
        try {
            await forceSavePersona(name, finalContent);
            toastr.success(TEXT.TOAST_SAVE_SUCCESS(name));
        } catch (e) { toastr.error(e.message); return; }

        // 2. 世界书保存 (修复逻辑)
        if ($('#pw-wi-toggle').is(':checked')) {
            const context = getContext();
            
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
                    // 1. 先获取书的内容，为了得到最新的 uid 和 entries
                    const r = await fetch('/api/worldinfo/get', { method: 'POST', headers: h, body: JSON.stringify({ name: targetBook }) });
                    if (r.ok) {
                        const d = await r.json();
                        if (!d.entries) d.entries = {};
                        
                        const entryName = `User: ${name}`;
                        const entryKeys = [name, "User"];

                        // 查找是否存在
                        let targetId = -1;
                        for (const [uid, entry] of Object.entries(d.entries)) {
                            // 简单的匹配逻辑：注释相同，或者关键词包含名字+User
                            if (entry.comment === entryName || (entry.key && entry.key.includes(name) && entry.key.includes("User"))) {
                                targetId = Number(uid); break;
                            }
                        }

                        // 如果没找到，创建新 ID
                        if (targetId === -1) {
                            const ids = Object.keys(d.entries).map(Number);
                            targetId = ids.length > 0 ? Math.max(...ids) + 1 : 0;
                        }

                        // 构造 Entry
                        d.entries[targetId] = { 
                            uid: targetId, 
                            key: entryKeys, 
                            content: finalContent, 
                            comment: entryName, 
                            enabled: true, 
                            selective: true,
                            constant: false,
                            position: "before_char"
                        };
                        
                        // 2. 写回
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
    $(document).on('change.pw', '#pw-api-source', function() { $('#pw-indep-settings').toggle($(this).val() === 'independent'); });
    $(document).on('click.pw', '#pw-api-fetch', async function() { /* 省略重复代码 */ });
    $(document).on('click.pw', '#pw-api-save', () => { saveCurrentState(); toastr.success(TEXT.TOAST_SAVE_API); });
    
    $(document).on('input.pw', '#pw-history-search', renderHistoryList);
    $(document).on('click.pw', '#pw-history-search-clear', function() { $('#pw-history-search').val('').trigger('input'); });
    $(document).on('click.pw', '#pw-history-clear-all', function() { if(confirm("清空?")){historyCache=[];saveData();renderHistoryList();} });
    
    $(document).on('click.pw', '#pw-wi-add', () => {
        const val = $('#pw-wi-select').val();
        if (val && !window.pwExtraBooks.includes(val)) {
            window.pwExtraBooks.push(val);
            renderWiBooks();
        }
    });
}

// ============================================================================
// 6. 辅助渲染
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
                // 点击标签 -> 填入 Request 框 (不再填入润色框)
                const tagText = tag.value ? `${tag.name}: ${tag.value}` : `${tag.name}`;
                const $text = $('#pw-request');
                const cur = $text.val();
                const prefix = (cur && !cur.endsWith('\n')) ? '\n' : '';
                $text.val(cur + prefix + tagText).focus();
                $text[0].scrollTop = $text[0].scrollHeight;
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
        container.html('<div style="opacity:0.6; padding:10px; text-align:center;">暂无世界书。请确保您已打开扩展或在下方手动添加。</div>');
        return;
    }

    for (const book of allBooks) {
        const isBound = baseBooks.includes(book);
        const $el = $(`
            <div class="pw-wi-book">
                <div class="pw-wi-header">
                    <span><i class="fa-solid fa-book"></i> ${book} ${isBound ? '<span style="color:#9ece6a;font-size:0.8em;margin-left:5px;">(已绑定)</span>' : ''}</span>
                    <div>${!isBound ? '<i class="fa-solid fa-times remove-book" style="color:#ff6b6b;margin-right:10px;" title="移除"></i>' : ''}<i class="fa-solid fa-chevron-down arrow"></i></div>
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
                        const $item = $(`<div class="pw-wi-item"><div class="pw-wi-item-row"><input type="checkbox" class="pw-wi-check" ${isChecked} data-content="${encodeURIComponent(entry.content)}"><div style="font-weight:bold; font-size:0.9em; flex:1;">${entry.displayName}</div><i class="fa-solid fa-eye pw-wi-toggle-icon"></i></div><div class="pw-wi-desc">${entry.content}<div class="pw-wi-close-bar"><i class="fa-solid fa-angle-up"></i> 收起</div></div></div>`);
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
    if (filtered.length === 0) { $list.html('<div style="text-align:center; opacity:0.6; padding:20px;">暂无历史记录</div>'); return; }
    filtered.forEach((item, index) => {
        const displayTitle = item.data.name || "未命名";
        const previewText = item.data.resultText || '无内容';
        const $el = $(`<div class="pw-history-item"><div class="pw-hist-main"><div style="font-weight:bold; color:#e0af68;">${displayTitle}</div><div class="pw-hist-meta"><span>${item.timestamp || ''}</span></div><div class="pw-hist-desc">${previewText}</div></div><div class="pw-hist-del-btn"><i class="fa-solid fa-trash"></i></div></div>`);
        $el.on('click', function(e) {
            if ($(e.target).closest('.pw-hist-del-btn').length) return;
            $('#pw-request').val(item.request);
            $('#pw-result-text').val(previewText); $('#pw-result-area').show();
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
    console.log(`${extensionName} v21 loaded.`);
});
