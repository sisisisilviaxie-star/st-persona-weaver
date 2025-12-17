import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, callPopup, getRequestHeaders } from "../../../../script.js";

// ============================================================================
// 1. 配置与常量
// ============================================================================

const extensionName = "st-persona-weaver";
const STORAGE_KEY_HISTORY = 'pw_history_v11'; // 升级版本号
const STORAGE_KEY_STATE = 'pw_state_v11'; 
const STORAGE_KEY_TAGS = 'pw_tags_v4';

const defaultTags = [
    { name: "姓名", value: "" },
    { name: "性别", value: "" },
    { name: "年龄", value: "" },
    { name: "职业", value: "" },
    { name: "性格", value: "" },
    { name: "外貌", value: "" },
    { name: "关系", value: "" },
    { name: "秘密", value: "" }
];

const defaultSettings = {
    autoSwitchPersona: true,
    historyLimit: 50,
    outputFormat: 'yaml', 
    apiSource: 'main', 
    indepApiUrl: 'https://api.openai.com/v1',
    indepApiKey: '',
    indepApiModel: 'gpt-3.5-turbo'
};

const TEXT = {
    PANEL_TITLE: "用户设定编织者",
    BTN_OPEN_MAIN: "打开设定生成器",
    TOAST_NO_CHAR: "请先打开一个角色聊天",
    TOAST_SNAPSHOT: "已存入历史记录",
    TOAST_SAVE_SUCCESS: (name) => `设定已保存并切换为: ${name}`
};

// ============================================================================
// 2. 数据管理
// ============================================================================

let historyCache = [];
let tagsCache = [];
let isEditingTags = false; 
let availableWorldBooks = []; 

function loadData() {
    try { historyCache = JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY)) || []; } catch { historyCache = []; }
    try { tagsCache = JSON.parse(localStorage.getItem(STORAGE_KEY_TAGS)) || defaultTags; } catch { tagsCache = defaultTags; }
}

function saveData() {
    localStorage.setItem(STORAGE_KEY_TAGS, JSON.stringify(tagsCache));
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(historyCache));
}

function saveHistory(payload) {
    const limit = extension_settings[extensionName]?.historyLimit || 50;
    const context = getContext();
    const charName = context.characters[context.characterId]?.name || "Unknown";
    const timestamp = new Date().toLocaleString();

    const historyItem = {
        timestamp: timestamp,
        targetChar: charName, 
        request: payload.request || "",
        data: {
            ...payload.data,
            // 默认标题格式：User设定名 @ 目标角色名
            customTitle: payload.data.customTitle || `${payload.data.name || 'User'} @ ${charName}`
        }
    };

    historyCache.unshift(historyItem);
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

// ============================================================================
// 3. 核心功能 (生成与API)
// ============================================================================

async function loadAvailableWorldBooks() {
    availableWorldBooks = [];
    const context = getContext();
    if (window.TavernHelper && typeof window.TavernHelper.getWorldbookNames === 'function') {
        try { availableWorldBooks = window.TavernHelper.getWorldbookNames(); } catch {}
    }
    if (!availableWorldBooks || !availableWorldBooks.length) {
        try {
            const r = await fetch('/api/worldinfo/get', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({}) });
            if (r.ok) {
                const d = await r.json();
                availableWorldBooks = (Array.isArray(d) ? d.map(i=>i.name||i) : d.world_names) || [];
            }
        } catch {}
    }
    availableWorldBooks = [...new Set(availableWorldBooks)].filter(x=>x).sort();
}

async function getContextWorldBooks() {
    const context = getContext();
    const books = new Set();
    const char = context.characters[context.characterId];
    if(char) {
        const d = char.data || char;
        const main = d.extensions?.world || d.world || d.character_book?.name;
        if(main) books.add(main);
    }
    if(context.worldInfoSettings?.globalSelect) context.worldInfoSettings.globalSelect.forEach(b=>books.add(b));
    return Array.from(books);
}

async function runGeneration(data, apiConfig) {
    const context = getContext();
    const char = context.characters[context.characterId];
    
    const formatInst = data.format === 'yaml' 
        ? `"description": "Use YAML format key-value pairs inside this string."`
        : `"description": "Narrative paragraph style (Novel style, 3rd person). Approx 200 words."`;

    let wiText = data.wiContext && data.wiContext.length > 0 ? `\n[Context/World Info]:\n${data.wiContext.join('\n\n')}\n` : "";

    const systemPrompt = `You are a creative writing assistant.
Task: Create a detailed User Persona based on the Request.
${wiText}
Target Character: ${char.name}
Scenario: ${char.scenario || "None"}

[User Request]:
${data.request}

[Response Format]:
Return ONLY a JSON object:
{
    "name": "Name",
    "description": ${formatInst},
    "wi_entry": "Concise facts for World Info."
}`;

    if (apiConfig.apiSource === 'independent') {
        const res = await fetch(`${apiConfig.indepApiUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.indepApiKey}` },
            body: JSON.stringify({
                model: apiConfig.indepApiModel,
                messages: [{ role: 'system', content: systemPrompt }],
                temperature: 0.7
            })
        });
        if (!res.ok) throw new Error("API Error");
        const json = await res.json();
        return JSON.parse(json.choices[0].message.content.match(/\{[\s\S]*\}/)[0]);
    } else {
        const txt = await context.generateQuietPrompt(systemPrompt, false, false, "System");
        return JSON.parse(txt.match(/\{[\s\S]*\}/)[0]);
    }
}

// ============================================================================
// 4. UI 渲染
// ============================================================================

async function openCreatorPopup() {
    const context = getContext();
    if (context.characterId === undefined) return toastr.warning(TEXT.TOAST_NO_CHAR);

    loadData();
    await loadAvailableWorldBooks();
    const savedState = loadState();
    const config = { ...defaultSettings, ...extension_settings[extensionName], ...savedState.localConfig };

    // --- 标签渲染逻辑 ---
    const renderTags = () => {
        const $container = $('#pw-tags-list');
        $container.removeClass('view-mode edit-mode');
        
        if (isEditingTags) {
            // [编辑模式]：垂直列表
            $container.addClass('edit-mode');
            let html = '';
            tagsCache.forEach((t, i) => {
                html += `
                <div class="pw-tag-edit-row">
                    <input class="pw-input t-name" data-idx="${i}" value="${t.name}" placeholder="标签名" style="flex:1;">
                    <input class="pw-input t-val" data-idx="${i}" value="${t.value}" placeholder="默认值 (选填)" style="flex:1;">
                    <button class="pw-btn danger-icon t-del" data-idx="${i}"><i class="fa-solid fa-trash"></i></button>
                </div>`;
            });
            $container.html(html);
            
            $container.find('input').on('input', function() {
                const idx = $(this).data('idx');
                const field = $(this).hasClass('t-name') ? 'name' : 'value';
                tagsCache[idx][field] = $(this).val();
                saveData();
            });
            $container.find('.t-del').on('click', function() {
                const idx = $(this).data('idx');
                tagsCache.splice(idx, 1);
                saveData();
                renderTags();
            });
        } else {
            // [正常模式]：药丸标签 + 添加按钮
            $container.addClass('view-mode');
            let html = tagsCache.map((t, i) => `
                <div class="pw-tag" data-idx="${i}">
                    ${t.name}
                    ${t.value ? `<span class="pw-tag-val">${t.value}</span>` : ''}
                </div>
            `).join('');
            html += `<div class="pw-tag-add-btn" id="pw-tags-quick-add"><i class="fa-solid fa-plus"></i></div>`;
            $container.html(html);
        }

        const $toggle = $('#pw-tags-toggle-edit');
        if (isEditingTags) {
            $toggle.addClass('active').html('<i class="fa-solid fa-check"></i> 完成');
        } else {
            $toggle.removeClass('active').html('<i class="fa-solid fa-gear"></i> 管理');
        }
    };

    const html = `
    <div class="pw-wrapper">
        <div class="pw-header">
            <div class="pw-title"><i class="fa-solid fa-wand-magic-sparkles"></i> 设定编织者</div>
            <div class="pw-tabs">
                <div class="pw-tab active" data-tab="editor">编辑</div>
                <div class="pw-tab" data-tab="context">世界书</div>
                <div class="pw-tab" data-tab="api">API</div>
                <div class="pw-tab" data-tab="history">历史</div>
            </div>
        </div>

        <!-- 1. 编辑视图 -->
        <div id="pw-view-editor" class="pw-view active">
            <div class="pw-scroll-area">
                <div>
                    <div class="pw-label-row">
                        <span class="pw-label">快捷标签 (点击插入)</span>
                        <div id="pw-tags-toggle-edit" class="pw-toggle-edit"><i class="fa-solid fa-gear"></i> 管理</div>
                    </div>
                    <div id="pw-tags-list" class="pw-tags-container view-mode"></div>
                </div>

                <div style="flex:1; display:flex; flex-direction:column;">
                    <textarea id="pw-request" class="pw-textarea" placeholder="输入你的要求，或点击上方标签组合描述...">${savedState.request || ''}</textarea>
                    
                    <div class="pw-editor-controls">
                        <div style="display:flex; gap:10px;">
                            <div class="pw-mini-btn" id="pw-clear"><i class="fa-solid fa-eraser"></i> 清空</div>
                            <div class="pw-mini-btn" id="pw-snapshot"><i class="fa-solid fa-save"></i> 存历史</div>
                        </div>
                        <select id="pw-fmt-select" class="pw-input" style="width:auto; padding:2px 6px; font-size:0.85em;">
                            <option value="yaml" ${config.outputFormat === 'yaml' ? 'selected' : ''}>YAML 格式</option>
                            <option value="paragraph" ${config.outputFormat === 'paragraph' ? 'selected' : ''}>小说段落</option>
                        </select>
                    </div>
                </div>

                <button id="pw-btn-gen" class="pw-btn gen"><i class="fa-solid fa-bolt"></i> 生成 / 润色</button>

                <div id="pw-result-area" style="display: ${savedState.hasResult ? 'block' : 'none'};">
                    <div class="pw-label" style="color:var(--smart-theme-quote-color); margin-bottom:8px;">
                        <i class="fa-solid fa-check-circle"></i> 生成结果
                    </div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        <input type="text" id="pw-res-name" class="pw-input" placeholder="角色名称" value="${savedState.name || ''}">
                        <textarea id="pw-res-desc" class="pw-textarea" style="min-height:150px;" placeholder="设定描述">${savedState.desc || ''}</textarea>
                        
                        <div style="background:rgba(0,0,0,0.1); padding:8px; border-radius:6px;">
                            <div style="display:flex; align-items:center; gap:5px; margin-bottom:5px;">
                                <input type="checkbox" id="pw-wi-toggle" checked>
                                <span style="font-size:0.9em;">写入世界书</span>
                            </div>
                            <textarea id="pw-res-wi" class="pw-textarea" style="min-height:60px;" placeholder="世界书条目内容...">${savedState.wiContent || ''}</textarea>
                        </div>
                    </div>
                    <button id="pw-btn-apply" class="pw-btn save"><i class="fa-solid fa-check"></i> 应用并切换</button>
                </div>
            </div>
        </div>

        <!-- 2. 世界书视图 -->
        <div id="pw-view-context" class="pw-view">
            <div class="pw-scroll-area">
                <div class="pw-wi-controls">
                    <select id="pw-wi-select" class="pw-input" style="flex:1;">
                        <option value="">-- 添加参考世界书 --</option>
                        ${availableWorldBooks.map(b => `<option value="${b}">${b}</option>`).join('')}
                    </select>
                    <button id="pw-wi-add" class="pw-btn normal"><i class="fa-solid fa-plus"></i></button>
                </div>
                <div id="pw-wi-container"></div>
            </div>
        </div>

        <!-- 3. API 设置 -->
        <div id="pw-view-api" class="pw-view">
            <div class="pw-scroll-area">
                <div class="pw-api-card">
                    <div class="pw-row">
                        <label style="font-weight:bold;">API 来源</label>
                        <select id="pw-api-source" class="pw-input" style="flex:1;">
                            <option value="main" ${config.apiSource === 'main' ? 'selected' : ''}>主 API</option>
                            <option value="independent" ${config.apiSource === 'independent' ? 'selected' : ''}>独立 API</option>
                        </select>
                    </div>
                    <div id="pw-indep-settings" style="display:${config.apiSource === 'independent' ? 'flex' : 'none'}; flex-direction:column; gap:10px;">
                        <input type="text" id="pw-api-url" class="pw-input" value="${config.indepApiUrl}" placeholder="API URL">
                        <input type="password" id="pw-api-key" class="pw-input" value="${config.indepApiKey}" placeholder="API Key">
                        <input type="text" id="pw-api-model" class="pw-input" value="${config.indepApiModel}" placeholder="Model ID">
                    </div>
                    <button id="pw-api-save" class="pw-btn primary" style="margin-top:10px;">保存设置</button>
                </div>
            </div>
        </div>

        <!-- 4. 历史记录 -->
        <div id="pw-view-history" class="pw-view">
            <div class="pw-scroll-area">
                <div class="pw-history-toolbar">
                    <input type="text" id="pw-history-search" class="pw-history-search" placeholder="搜索历史...">
                    <i class="fa-solid fa-times" id="pw-search-clear" style="cursor:pointer; opacity:0.6; padding:5px;"></i>
                </div>
                <div id="pw-history-list"></div>
                <div id="pw-history-clear-all" class="pw-text-danger-btn"><i class="fa-solid fa-trash-alt"></i> 清空所有历史</div>
            </div>
        </div>
    </div>`;

    callPopup(html, 'text', '', { wide: true, large: true, okButton: "关闭" });

    // --- 事件绑定 ---
    renderTags();
    $('#pw-tags-toggle-edit').on('click', () => { isEditingTags = !isEditingTags; renderTags(); });
    $(document).on('click', '#pw-tags-quick-add', () => { tagsCache.push({ name: "", value: "" }); saveData(); isEditingTags = true; renderTags(); setTimeout(() => $('#pw-tags-list .t-name').last().focus(), 50); });
    $(document).on('click', '.pw-tag', function() {
        if (isEditingTags) return;
        const idx = $(this).data('idx');
        const t = tagsCache[idx];
        const $txt = $('#pw-request');
        const val = $txt.val();
        const insert = t.value ? `${t.name}: ${t.value}` : `${t.name}: `;
        $txt.val(val + (val && !val.endsWith('\n') ? '\n' : '') + insert).focus();
        $txt[0].scrollTop = $txt[0].scrollHeight;
        saveCurrentState();
    });

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
    $(document).on('input change', '#pw-request, #pw-res-name, #pw-res-desc, #pw-res-wi, .pw-input', saveCurrentState);
    
    $('.pw-tab').on('click', function() {
        $('.pw-tab').removeClass('active');
        $(this).addClass('active');
        $('.pw-view').removeClass('active');
        const tab = $(this).data('tab');
        $(`#pw-view-${tab}`).addClass('active');
        if(tab === 'history') renderHistory();
    });

    $('#pw-snapshot').on('click', () => {
        const req = $('#pw-request').val();
        const name = $('#pw-res-name').val();
        if (!req && !name) return;
        saveHistory({ 
            request: req, 
            data: { 
                name: name || "User", 
                description: $('#pw-res-desc').val(), 
                wi_entry: $('#pw-res-wi').val() 
            } 
        });
        toastr.success(TEXT.TOAST_SNAPSHOT);
    });

    const renderHistory = () => {
        const $list = $('#pw-history-list').empty();
        const search = $('#pw-history-search').val().toLowerCase();
        const filtered = historyCache.filter(item => {
            if(!search) return true;
            return JSON.stringify(item).toLowerCase().includes(search);
        });

        if (!filtered.length) return $list.html('<div style="text-align:center;opacity:0.5;padding:20px;">无记录</div>');

        filtered.forEach((item, idx) => {
            const title = item.data.customTitle || "未命名记录";
            const target = item.targetChar || "Unknown"; 

            const $el = $(`
                <div class="pw-history-item">
                    <div class="pw-hist-content">
                        <div class="pw-hist-header">
                            <input class="pw-hist-title" value="${title}" readonly>
                            <i class="fa-solid fa-pencil" style="opacity:0.4;font-size:0.8em;cursor:pointer;"></i>
                        </div>
                        <div class="pw-hist-meta">
                            <span><i class="fa-regular fa-clock"></i> ${item.timestamp || ''}</span>
                            <span><i class="fa-solid fa-user-tag"></i> 目标: ${target}</span>
                        </div>
                        <div class="pw-hist-desc">${item.data.description || item.request}</div>
                    </div>
                    <i class="fa-solid fa-trash pw-hist-del"></i>
                </div>
            `);

            $el.find('.pw-hist-content').on('click', (e) => {
                if($(e.target).is('input') || $(e.target).hasClass('fa-pencil')) return;
                $('#pw-request').val(item.request);
                $('#pw-res-name').val(item.data.name);
                $('#pw-res-desc').val(item.data.description);
                $('#pw-res-wi').val(item.data.wi_entry);
                $('#pw-result-area').show();
                $('.pw-tab[data-tab="editor"]').click();
            });

            const $inp = $el.find('.pw-hist-title');
            $el.find('.fa-pencil').on('click', () => {
                if($inp.prop('readonly')) { $inp.prop('readonly',false).addClass('editing').focus(); }
                else { saveTitle(); }
            });
            const saveTitle = () => {
                $inp.prop('readonly',true).removeClass('editing');
                updateHistoryTitle(historyCache.indexOf(item), $inp.val());
            };
            $inp.on('blur keydown', (e) => {
                if(e.type === 'blur' || e.key === 'Enter') saveTitle();
            });

            $el.find('.pw-hist-del').on('click', () => {
                if(confirm("删除此记录？")) {
                    historyCache.splice(historyCache.indexOf(item), 1);
                    saveData();
                    renderHistory();
                }
            });

            $list.append($el);
        });
    };
    
    $('#pw-history-search').on('input', renderHistory);
    $('#pw-search-clear').on('click', () => $('#pw-history-search').val('').trigger('input'));
    $('#pw-history-clear-all').on('click', () => {
        if(confirm("确定清空所有？")) { historyCache = []; saveData(); renderHistory(); }
    });

    $('#pw-btn-gen').on('click', async function() {
        const req = $('#pw-request').val();
        const $btn = $(this);
        $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> 处理中...');
        
        try {
            const wiContext = [];
            $('.pw-wi-check:checked').each(function(){ wiContext.push(decodeURIComponent($(this).data('content'))); });
            
            const config = {
                request: req,
                format: $('#pw-fmt-select').val(),
                wiContext: wiContext,
                apiSource: $('#pw-api-source').val(),
                indepApiUrl: $('#pw-api-url').val(),
                indepApiKey: $('#pw-api-key').val(),
                indepApiModel: $('#pw-api-model').val()
            };

            const data = await runGeneration(config, config);
            
            $('#pw-res-name').val(data.name);
            $('#pw-res-desc').val(data.description);
            $('#pw-res-wi').val(data.wi_entry || data.description);
            $('#pw-result-area').fadeIn();
            saveHistory({ request: req, data: data });
            saveCurrentState();

        } catch (e) {
            console.error(e);
            toastr.error("生成失败: " + e.message);
        } finally {
            $btn.prop('disabled', false).html('<i class="fa-solid fa-bolt"></i> 生成 / 润色');
        }
    });

    $('#pw-btn-apply').on('click', async () => {
        const name = $('#pw-res-name').val();
        const desc = $('#pw-res-desc').val();
        const context = getContext();
        if(!context.powerUserSettings.personas) context.powerUserSettings.personas = {};
        context.powerUserSettings.personas[name] = desc;
        await saveSettingsDebounced();
        
        if (defaultSettings.autoSwitchPersona) {
            context.powerUserSettings.persona_selected = name;
            $("#your_name").val(name).trigger("input").trigger("change");
            $("#your_desc").val(desc).trigger("input").trigger("change");
        }
        toastr.success(TEXT.TOAST_SAVE_SUCCESS(name));
        $('.popup_close').click();
    });
    
    $('#pw-api-source').on('change', function() { $('#pw-indep-settings').toggle($(this).val() === 'independent'); });
    $('#pw-api-save').on('click', () => { saveCurrentState(); toastr.success("设置已保存"); });
    
    const renderWiBooks = async () => {
        const container = $('#pw-wi-container').empty();
        const baseBooks = await getContextWorldBooks();
        const allBooks = [...new Set([...baseBooks, ...window.pwExtraBooks])];
        if(!allBooks.length) return container.html('<div style="opacity:0.6;padding:10px;text-align:center;">无参考书</div>');
        
        for (const book of allBooks) {
            const isBound = baseBooks.includes(book);
            const $el = $(`
                <div class="pw-wi-book">
                    <div class="pw-wi-header">
                        <span><i class="fa-solid fa-book"></i> ${book}</span>
                        <div>${!isBound?'<i class="fa-solid fa-times rm" style="color:#ff6b6b;margin-right:8px;"></i>':''}<i class="fa-solid fa-chevron-down arrow"></i></div>
                    </div>
                    <div class="pw-wi-list"></div>
                </div>
            `);
            $el.find('.rm').on('click', (e)=>{ e.stopPropagation(); window.pwExtraBooks = window.pwExtraBooks.filter(b=>b!==book); renderWiBooks(); });
            $el.find('.pw-wi-header').on('click', async function() {
                const $lst = $el.find('.pw-wi-list');
                if($lst.is(':visible')) { $lst.slideUp(); } 
                else {
                    $lst.slideDown();
                    if(!$lst.data('loaded')) {
                        $lst.html('<div style="padding:10px;text-align:center;"><i class="fas fa-spinner fa-spin"></i></div>');
                        const entries = await getWorldBookEntries(book);
                        $lst.empty();
                        entries.forEach(e => {
                            $lst.append(`<div class="pw-wi-item">
                                <input type="checkbox" class="pw-wi-check" ${e.enabled?'checked':''} data-content="${encodeURIComponent(e.content)}">
                                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${e.displayName}</span>
                            </div>`);
                        });
                        $lst.data('loaded',true);
                    }
                }
            });
            container.append($el);
        }
    };
    renderWiBooks();
    $('#pw-wi-add').on('click', () => {
        const val = $('#pw-wi-select').val();
        if(val && !window.pwExtraBooks.includes(val)) { window.pwExtraBooks.push(val); renderWiBooks(); }
    });

    $('#pw-clear').on('click', () => {
        if(confirm("清空输入？")) { $('#pw-request').val(''); $('#pw-result-area').hide(); saveCurrentState(); }
    });
}

// 初始化
jQuery(() => {
    $("#extensions_settings2").append(`
        <div class="world-info-cleanup-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header"><b>${TEXT.PANEL_TITLE}</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
                <div class="inline-drawer-content">
                    <div style="margin:10px 0;"><input id="pw_open_btn" class="menu_button" type="button" value="${TEXT.BTN_OPEN_MAIN}" style="width:100%;font-weight:bold;background:var(--smart-theme-quote-color);color:#fff;" /></div>
                </div>
            </div>
        </div>
    `);
    $("#pw_open_btn").on("click", openCreatorPopup);
});
