import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, callPopup, getRequestHeaders } from "../../../../script.js";

// ============================================================================
// 1. 常量与配置
// ============================================================================

const extensionName = "st-persona-weaver";
const STORAGE_KEY_HISTORY = 'pw_history_v18'; // 版本升级
const STORAGE_KEY_STATE = 'pw_state_v18'; 
const STORAGE_KEY_TAGS = 'pw_tags_v12';

// 默认标签库
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
    outputFormat: 'yaml', 
    apiSource: 'main', 
    indepApiUrl: 'https://api.openai.com/v1',
    indepApiKey: '',
    indepApiModel: 'gpt-3.5-turbo'
};

const TEXT = {
    PANEL_TITLE: "用户设定编织者 Pro",
    BTN_OPEN_MAIN: "打开设定生成器",
    TOAST_NO_CHAR: "请先打开一个角色聊天",
    TOAST_API_OK: "API 连接成功",
    TOAST_API_ERR: "API 连接失败",
    TOAST_SAVE_API: "API 设置已保存",
    TOAST_SNAPSHOT: "已存入历史记录",
    TOAST_GEN_FAIL: "生成失败，请检查 API 设置",
    TOAST_SAVE_SUCCESS: (name) => `Persona "${name}" 已强制写入并绑定！`
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

// ============================================================================
// 3. 业务逻辑 (核心功能)
// ============================================================================

// [核心] 暴力写入 Persona (参考了用户的 F12 方案)
async function forceSavePersona(name, description, title) {
    const context = getContext();
    
    // 1. 直接修改内存中的数据源 (SillyTavern 的核心数据)
    if (!context.powerUserSettings.personas) context.powerUserSettings.personas = {};
    context.powerUserSettings.personas[name] = description;

    if (!context.powerUserSettings.persona_titles) context.powerUserSettings.persona_titles = {};
    context.powerUserSettings.persona_titles[name] = title || "";

    // 2. 切换当前选中的 Persona
    context.powerUserSettings.persona_selected = name;

    // 3. 尝试暴力更新 UI (如果用户正打开着设置面板)
    // 这是为了防止 UI 显示旧数据
    const $nameInput = $('#your_name'); // ST 的用户名称输入框 ID
    const $descInput = $('#persona_description'); // ST 的用户描述输入框 ID
    
    if ($nameInput.length) {
        $nameInput.val(name).trigger('input').trigger('change');
    }
    if ($descInput.length) {
        $descInput.val(description).trigger('input').trigger('change');
    }

    // 4. 调用系统保存 (最关键的一步)
    await saveSettingsDebounced();
    
    console.log(`[PW] Persona "${name}" created/updated via direct memory injection.`);
    return true;
}

// [核心] 执行 Slash 命令 (用于绑定)
async function executeSlash(command) {
    const { executeSlashCommandsWithOptions } = SillyTavern;
    if (executeSlashCommandsWithOptions) {
        await executeSlashCommandsWithOptions(command, { quiet: true });
    } else {
        console.warn("[PW] Slash command API not found!");
    }
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
        
        const main = v2Book || extWorld || legacyWorld;
        if (main) books.add(main);
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
    } catch (e) {
        console.error(e);
        return [];
    }
}

async function runGeneration(data, apiConfig) {
    const context = getContext();
    const char = context.characters[context.characterId];
    
    const formatInst = data.format === 'yaml' 
        ? `"description": "Use YAML format key-value pairs."`
        : `"description": "Narrative paragraph style."`;

    let wiText = "";
    if (data.wiContext && data.wiContext.length > 0) {
        wiText = `\n[Context]:\n${data.wiContext.join('\n\n')}\n`;
    }

    const specifiedName = $('#pw-res-name').val() || "";
    const specifiedTitle = $('#pw-res-title').val() || "";

    const systemPrompt = `You are a creative writing assistant.
Task: Create a User Persona based on Request.
${wiText}
Target Character: ${char.name}
Scenario: ${char.scenario || "None"}

[User Request]:
${data.request}

[Instructions]:
${specifiedName ? `1. Use the Name: "${specifiedName}".` : "1. Generate a fitting Name."}
${specifiedTitle ? `2. Use the Title: "${specifiedTitle}".` : "2. Generate a short Title (e.g. Detective, Shy Student)."}

[Response Format]:
Return ONLY a JSON object:
{
    "name": "${specifiedName || "Name"}",
    "title": "${specifiedTitle || "Short Title"}",
    "description": ${formatInst},
    "wi_entry": "Concise facts."
}`;

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
        const content = json.choices[0].message.content;
        return JSON.parse(content.match(/\{[\s\S]*\}/)[0]);
    } else {
        const generatedText = await context.generateQuietPrompt(systemPrompt, false, false, "System");
        return JSON.parse(generatedText.match(/\{[\s\S]*\}/)[0]);
    }
}

// ============================================================================
// 4. UI 渲染与交互
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
                <div>
                    <div class="pw-tags-header">
                        <span class="pw-tags-label">快速标签</span>
                        <span class="pw-tags-edit-toggle" id="pw-toggle-edit-tags">编辑标签</span>
                    </div>
                    <div class="pw-tags-container" id="pw-tags-list"></div>
                </div>

                <div style="flex:1; display:flex; flex-direction:column; gap:8px;">
                    <div style="display:flex; gap:10px;">
                        <input type="text" id="pw-res-name" class="pw-input" placeholder="姓名" value="${savedState.name || ''}" style="flex:1;">
                        <input type="text" id="pw-res-title" class="pw-input" placeholder="Title (选填)" value="${savedState.title || ''}" style="flex:1;">
                    </div>

                    <textarea id="pw-request" class="pw-textarea" placeholder="在此输入设定要求，或点击上方标签..." style="min-height:100px;">${savedState.request || ''}</textarea>
                    
                    <div class="pw-editor-tools">
                        <div class="pw-mini-btn" id="pw-clear"><i class="fa-solid fa-eraser"></i> 清空</div>
                        <div class="pw-mini-btn" id="pw-snapshot"><i class="fa-solid fa-save"></i> 存入历史</div>
                        <select id="pw-fmt-select" class="pw-input" style="width:auto; padding:2px 8px; font-size:0.85em;">
                            <option value="yaml" ${config.outputFormat === 'yaml' ? 'selected' : ''}>YAML 属性</option>
                            <option value="paragraph" ${config.outputFormat === 'paragraph' ? 'selected' : ''}>小说段落</option>
                        </select>
                    </div>
                </div>

                <button id="pw-btn-gen" class="pw-btn gen"><i class="fa-solid fa-bolt"></i> 生成 / 润色</button>

                <div id="pw-result-area" style="display: ${savedState.hasResult ? 'block' : 'none'}; border-top: 1px dashed var(--SmartThemeBorderColor); padding-top: 15px; margin-top:5px;">
                    <div style="font-weight:bold; margin-bottom:10px; color:#5b8db8;"><i class="fa-solid fa-check-circle"></i> 生成结果</div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        <textarea id="pw-res-desc" class="pw-textarea" rows="6" placeholder="用户设定描述">${savedState.desc || ''}</textarea>
                        
                        <div style="background:rgba(0,0,0,0.1); padding:10px; border-radius:8px; border:1px solid var(--SmartThemeBorderColor);">
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

    // ========================================================================
    // 逻辑绑定
    // ========================================================================
    
    // --- 1. 状态保存 ---
    const saveCurrentState = () => {
        saveState({
            request: $('#pw-request').val(),
            name: $('#pw-res-name').val(),
            title: $('#pw-res-title').val(),
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
    $(document).on('input.pw change.pw', '#pw-request, #pw-res-name, #pw-res-title, #pw-res-desc, #pw-res-wi, .pw-input', saveCurrentState);

    // --- 2. Tab 切换 ---
    $(document).on('click.pw', '.pw-tab', function() {
        $('.pw-tab').removeClass('active');
        $(this).addClass('active');
        $('.pw-view').removeClass('active');
        const tab = $(this).data('tab');
        $(`#pw-view-${tab}`).addClass('active');
        if(tab === 'history') renderHistoryList(); 
    });

    // --- 3. 标签系统 ---
    isEditingTags = false; 

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
                
                $row.find('input').on('input', function() {
                    tag.name = $row.find('.t-name').val();
                    tag.value = $row.find('.t-val').val();
                    saveData();
                });

                $row.find('.pw-tag-del-btn').on('click', () => {
                    if (confirm(`删除标签 "${tag.name}"?`)) {
                        tagsCache.splice(index, 1);
                        saveData();
                        renderTagsList();
                    }
                });
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
                    const $text = $('#pw-request');
                    const cur = $text.val();
                    const insert = tag.value ? `${tag.name}: ${tag.value}` : `${tag.name}: `;
                    const prefix = (cur && !cur.endsWith('\n')) ? '\n' : '';
                    $text.val(cur + prefix + insert).focus();
                    $text[0].scrollTop = $text[0].scrollHeight;
                    saveCurrentState();
                });
                $container.append($chip);
            }
        });

        const $addBtn = $(`<div class="pw-tag-add-btn"><i class="fa-solid fa-plus"></i> ${isEditingTags ? '新增' : '标签'}</div>`);
        $addBtn.on('click', () => {
            tagsCache.push({ name: "", value: "" });
            saveData();
            if (!isEditingTags) isEditingTags = true; 
            renderTagsList();
            setTimeout(() => { $('#pw-tags-list .t-name').last().focus(); }, 50);
        });
        $container.append($addBtn);

        if (isEditingTags) {
            const $finishBtn = $(`<div class="pw-tags-finish-bar"><i class="fa-solid fa-check"></i> 完成编辑</div>`);
            $finishBtn.on('click', () => {
                isEditingTags = false;
                renderTagsList();
            });
            $container.append($finishBtn);
        }
    };

    $('#pw-toggle-edit-tags').on('click', () => {
        isEditingTags = !isEditingTags;
        renderTagsList();
    });

    renderTagsList(); 

    // --- 4. 世界书逻辑 ---
    window.pwExtraBooks = savedState.localConfig?.extraBooks || [];
    
    const renderWiBooks = async () => {
        const container = $('#pw-wi-container').empty();
        const baseBooks = await getContextWorldBooks();
        const allBooks = [...new Set([...baseBooks, ...window.pwExtraBooks])];

        if (allBooks.length === 0) {
            container.html('<div style="opacity:0.6; padding:10px; text-align:center;">暂无参考世界书</div>');
            return;
        }

        for (const book of allBooks) {
            const isBound = baseBooks.includes(book);
            const $el = $(`
                <div class="pw-wi-book">
                    <div class="pw-wi-header">
                        <span><i class="fa-solid fa-book"></i> ${book} ${isBound ? '<span style="opacity:0.5;font-weight:normal;font-size:0.8em;">(绑定)</span>' : ''}</span>
                        <div>
                            ${!isBound ? '<i class="fa-solid fa-times remove-book" style="color:#ff6b6b;margin-right:10px;" title="移除"></i>' : ''}
                            <i class="fa-solid fa-chevron-down arrow"></i>
                        </div>
                    </div>
                    <div class="pw-wi-list" data-book="${book}"></div>
                </div>
            `);
            
            $el.find('.remove-book').on('click', (e) => {
                e.stopPropagation();
                window.pwExtraBooks = window.pwExtraBooks.filter(b => b !== book);
                renderWiBooks();
            });

            $el.find('.pw-wi-header').on('click', async function() {
                const $list = $el.find('.pw-wi-list');
                const $arrow = $(this).find('.arrow');
                
                if ($list.is(':visible')) {
                    $list.slideUp();
                    $arrow.removeClass('fa-flip-vertical');
                } else {
                    $list.slideDown();
                    $arrow.addClass('fa-flip-vertical');
                    
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
                                    <div class="pw-wi-desc">
                                        ${entry.content}
                                        <div class="pw-wi-close-bar"><i class="fa-solid fa-angle-up"></i> 收起</div>
                                    </div>
                                </div>
                            `);
                            
                            $item.find('.pw-wi-toggle-icon').on('click', function(e) {
                                e.stopPropagation();
                                const $desc = $(this).closest('.pw-wi-item').find('.pw-wi-desc');
                                if($desc.is(':visible')) {
                                    $desc.slideUp();
                                    $(this).css('color', '');
                                } else {
                                    $desc.slideDown();
                                    $(this).css('color', '#5b8db8');
                                }
                            });

                            $item.find('.pw-wi-close-bar').on('click', function() {
                                $(this).parent().slideUp();
                                $item.find('.pw-wi-toggle-icon').css('color', '');
                            });
                            
                            $list.append($item);
                        });
                        $list.data('loaded', true);
                    }
                }
            });
            container.append($el);
        }
    };
    renderWiBooks();

    $('#pw-wi-add').on('click', () => {
        const val = $('#pw-wi-select').val();
        if (val && !window.pwExtraBooks.includes(val)) {
            window.pwExtraBooks.push(val);
            renderWiBooks();
        }
    });

    // --- 5. API 设置 ---
    $('#pw-api-source').on('change', function() {
        $('#pw-indep-settings').toggle($(this).val() === 'independent');
    });

    $('#pw-api-fetch').on('click', async function() {
        const btn = $(this);
        btn.html('<i class="fas fa-spinner fa-spin"></i>');
        const models = await fetchModels($('#pw-api-url').val(), $('#pw-api-key').val());
        btn.html('<i class="fa-solid fa-cloud-download-alt"></i>');
        
        if (models.length) {
            const list = $('#pw-model-list').empty();
            models.forEach(m => list.append(`<option value="${m}">`));
            toastr.success(TEXT.TOAST_API_OK);
        } else {
            toastr.error(TEXT.TOAST_API_ERR);
        }
    });

    $('#pw-api-save').on('click', () => {
        saveCurrentState();
        toastr.success(TEXT.TOAST_SAVE_API);
    });

    // --- 6. 工具栏 ---
    $('#pw-clear').on('click', () => {
        if(confirm("清空输入内容？")) {
            $('#pw-request').val('');
            $('#pw-result-area').hide();
            saveCurrentState();
        }
    });

    $('#pw-snapshot').on('click', () => {
        const req = $('#pw-request').val();
        const curName = $('#pw-res-name').val();
        const curTitle = $('#pw-res-title').val();
        const curDesc = $('#pw-res-desc').val();
        
        if (!req && !curName) return;
        
        const userName = curName || "User"; 
        const userTitle = curTitle || "";
        const finalTitle = userTitle ? `${userName} ${userTitle}` : userName;
        
        saveHistory({ 
            request: req || "无请求内容", 
            timestamp: new Date().toLocaleString(),
            targetChar: getContext().characters[getContext().characterId]?.name || "未知",
            data: { 
                name: userName, 
                title: userTitle,
                description: curDesc || "", 
                wi_entry: $('#pw-res-wi').val(),
                customTitle: finalTitle
            } 
        });
        toastr.success(TEXT.TOAST_SNAPSHOT);
    });

    // --- 7. 生成 ---
    $('#pw-btn-gen').on('click', async function() {
        const req = $('#pw-request').val();
        const curName = $('#pw-res-name').val();
        const curDesc = $('#pw-res-desc').val();
        
        let fullReq = req;
        if (curName || curDesc) fullReq += `\n\n[Previous Draft]:\nName: ${curName}\nDesc: ${curDesc}`;

        const $btn = $(this);
        const oldText = $btn.html();
        $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> 处理中...');

        const wiContext = [];
        $('.pw-wi-check:checked').each(function() {
            wiContext.push(decodeURIComponent($(this).data('content')));
        });

        const config = {
            request: fullReq,
            format: $('#pw-fmt-select').val(),
            wiContext: wiContext,
            apiSource: $('#pw-api-source').val(),
            indepApiUrl: $('#pw-api-url').val(),
            indepApiKey: $('#pw-api-key').val(),
            indepApiModel: $('#pw-api-model').val()
        };

        try {
            const data = await runGeneration(config, config);
            
            const finalName = data.name || $('#pw-res-name').val() || "User";
            const finalTitle = data.title || $('#pw-res-title').val() || "";

            $('#pw-res-name').val(finalName);
            $('#pw-res-title').val(finalTitle);
            $('#pw-res-desc').val(data.description);
            $('#pw-res-wi').val(data.wi_entry || data.description);
            $('#pw-result-area').fadeIn();
            
            const finalTitleStr = finalTitle ? `${finalName} ${finalTitle}` : finalName;
            
            saveHistory({ 
                request: req, 
                timestamp: new Date().toLocaleString(),
                targetChar: getContext().characters[getContext().characterId]?.name || "未知", 
                data: {
                    name: finalName,
                    title: finalTitle,
                    description: data.description,
                    wi_entry: data.wi_entry || data.description,
                    customTitle: finalTitleStr
                }
            });
            saveCurrentState();
        } catch (e) {
            console.error(e);
            toastr.error(`${TEXT.TOAST_GEN_FAIL}: ${e.message}`);
        } finally {
            $btn.prop('disabled', false).html(oldText);
        }
    });

    // --- 8. 应用 (核心修复：暴力写入 + 强制同步) ---
    $('#pw-btn-apply').on('click', async function() {
        const name = $('#pw-res-name').val();
        const title = $('#pw-res-title').val();
        const desc = $('#pw-res-desc').val();
        const wiContent = $('#pw-res-wi').val();
        
        if (!name) return toastr.warning("名字不能为空");
        
        const context = getContext();
        
        // 1. 暴力保存 Persona (内存劫持 + UI更新 + 强制存盘)
        try {
            await forceSavePersona(name, desc, title);
        } catch (e) {
            toastr.error("保存失败: " + e.message);
            return;
        }

        // 2. 绑定到聊天
        try {
            // 这里双保险：先切，再锁
            await executeSlash(`/persona-set "${name}"`);
            await executeSlash(`/persona-lock type=chat`);
        } catch (e) {
            console.warn("Slash command execution failed", e);
        }

        // 3. 写入世界书
        if ($('#pw-wi-toggle').is(':checked') && wiContent) {
            const char = context.characters[context.characterId];
            const data = char.data || char;
            let targetBook = data.character_book?.name || data.extensions?.world || data.world;
            
            if (!targetBook) {
                const books = await getContextWorldBooks();
                if (books.length > 0) targetBook = books[0];
            }

            if (targetBook) {
                try {
                    const headers = getRequestHeaders();
                    const r = await fetch('/api/worldinfo/get', { method: 'POST', headers, body: JSON.stringify({ name: targetBook }) });
                    if (r.ok) {
                        const d = await r.json();
                        if (!d.entries) d.entries = {};
                        const ids = Object.keys(d.entries).map(Number);
                        const newId = ids.length ? Math.max(...ids) + 1 : 0;
                        
                        const keys = [name, "User"];
                        if (title) keys.push(title);

                        d.entries[newId] = { 
                            uid: newId, 
                            key: keys, 
                            content: wiContent, 
                            comment: `User: ${name}`, 
                            enabled: true, 
                            selective: true 
                        };
                        
                        await fetch('/api/worldinfo/edit', { method: 'POST', headers, body: JSON.stringify({ name: targetBook, data: d }) });
                        toastr.success(`已写入世界书: ${targetBook}`);
                        if (context.updateWorldInfoList) context.updateWorldInfoList();
                    }
                } catch(e) { console.error("WI Update Failed", e); }
            } else {
                toastr.warning("未找到可用的世界书，跳过写入。");
            }
        }

        toastr.success(TEXT.TOAST_SAVE_SUCCESS(name));
        $('.popup_close').click();
    });

    // --- 9. 历史管理 ---
    const renderHistoryList = () => {
        loadData();
        const $list = $('#pw-history-list').empty();
        const search = $('#pw-history-search').val().toLowerCase();

        const filtered = historyCache.filter(item => {
            if (!search) return true;
            const title = (item.data.customTitle || item.data.name || "").toLowerCase();
            const content = (item.data.description || "").toLowerCase();
            return title.includes(search) || content.includes(search);
        });

        if (filtered.length === 0) {
            $list.html('<div style="text-align:center; opacity:0.6; padding:20px;">暂无历史记录</div>');
            return;
        }

        filtered.forEach((item, index) => {
            const displayTitle = item.data.customTitle || item.data.name || "未命名";
            const targetChar = item.targetChar || "未知";

            const $el = $(`
                <div class="pw-history-item">
                    <div class="pw-hist-main">
                        <input class="pw-hist-title-input" value="${displayTitle}" readonly>
                        <div class="pw-hist-meta">
                            <span><i class="fa-solid fa-user-tag"></i> 目标: ${targetChar}</span>
                            <span><i class="fa-regular fa-clock"></i> ${item.timestamp || ''}</span>
                        </div>
                        <div class="pw-hist-desc">${item.data.description || item.request || '无描述'}</div>
                    </div>
                    <div class="pw-hist-del-btn"><i class="fa-solid fa-trash"></i></div>
                </div>
            `);

            $el.on('click', function(e) {
                if ($(e.target).closest('.pw-hist-del-btn, .pw-hist-title-input').length) return;
                $('#pw-request').val(item.request);
                $('#pw-res-name').val(item.data.name);
                $('#pw-res-title').val(item.data.title || "");
                $('#pw-res-desc').val(item.data.description);
                $('#pw-res-wi').val(item.data.wi_entry);
                $('#pw-result-area').show();
                $('.pw-tab[data-tab="editor"]').click();
            });

            const $titleInput = $el.find('.pw-hist-title-input');
            $titleInput.on('click', function(e) {
                e.stopPropagation();
                if ($(this).attr('readonly')) $(this).removeAttr('readonly').focus().select();
            });
            $titleInput.on('blur keydown', function(e) {
                if (e.type === 'keydown' && e.key !== 'Enter') return;
                if (!$(this).attr('readonly')) {
                    $(this).attr('readonly', true);
                    const realIndex = historyCache.indexOf(item);
                    if (realIndex > -1) {
                        historyCache[realIndex].data.customTitle = $(this).val();
                        saveData();
                    }
                }
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

    $(document).on('input.pw', '#pw-history-search', renderHistoryList);
    
    $(document).on('click.pw', '#pw-history-search-clear', function() {
        $('#pw-history-search').val('').trigger('input');
    });
    
    $(document).on('click.pw', '#pw-history-clear-all', function() {
        if (historyCache.length === 0) return;
        if(confirm("确定要清空所有历史记录吗？")) {
            historyCache = [];
            saveData();
            renderHistoryList();
        }
    });
}

// ============================================================================
// 初始化
// ============================================================================

jQuery(async () => {
    injectStyles();
    
    $("#extensions_settings2").append(`
        <div class="world-info-cleanup-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header"><b>${TEXT.PANEL_TITLE}</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
                <div class="inline-drawer-content">
                    <div style="margin:10px 0;"><input id="pw_open_btn" class="menu_button" type="button" value="${TEXT.BTN_OPEN_MAIN}" style="width:100%;font-weight:bold;background:var(--SmartThemeQuoteColor);color:#fff;" /></div>
                </div>
            </div>
        </div>
    `);
    $("#pw_open_btn").on("click", openCreatorPopup);
    console.log(`${extensionName} v18 loaded.`);
});
