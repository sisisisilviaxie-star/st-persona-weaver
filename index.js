import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, callPopup, getRequestHeaders } from "../../../../script.js";

// ============================================================================
// 1. 常量与配置
// ============================================================================

const extensionName = "st-persona-weaver";
const STORAGE_KEY_HISTORY = 'pw_history_v19'; 
const STORAGE_KEY_TAGS = 'pw_tags_v13';

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
    historyLimit: 50,
    outputFormat: 'yaml', 
    // 已移除独立 API 配置
};

const TEXT = {
    PANEL_TITLE: "设定编织者 Pro",
    TOAST_NO_CHAR: "请先打开一个角色聊天",
    TOAST_SNAPSHOT: "已存入历史记录",
    TOAST_GEN_FAIL: "生成失败，请检查网络",
    TOAST_SAVE_SUCCESS: (name) => `Persona "${name}" 描述已更新！`
};

// ============================================================================
// 2. 状态与存储
// ============================================================================

let historyCache = [];
let tagsCache = [];
let worldInfoCache = {}; 
let availableWorldBooks = []; 
let isEditingTags = false; 

// 临时存储生成前的上下文，用于回填
let currentContextData = { name: "", title: "" };

function loadData() {
    try { historyCache = JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY)) || []; } catch { historyCache = []; }
    try { tagsCache = JSON.parse(localStorage.getItem(STORAGE_KEY_TAGS)) || defaultTags; } catch { tagsCache = defaultTags; }
}

function saveData() {
    localStorage.setItem(STORAGE_KEY_TAGS, JSON.stringify(tagsCache));
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(historyCache));
}

function saveHistory(item) {
    const limit = 50;
    historyCache.unshift(item);
    if (historyCache.length > limit) historyCache = historyCache.slice(0, limit);
    saveData();
}

function injectStyles() {
    const styleId = 'persona-weaver-css-v19';
    if ($(`#${styleId}`).length) return;
}

// ============================================================================
// 3. 业务逻辑
// ============================================================================

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

async function runGeneration(data) {
    const context = getContext();
    const char = context.characters[context.characterId] || { name: "Unknown", scenario: "" };
    
    const formatInst = data.format === 'yaml' 
        ? `"description": "Use YAML format key-value pairs."`
        : `"description": "Narrative paragraph style."`;

    let wiText = "";
    if (data.wiContext && data.wiContext.length > 0) {
        wiText = `\n[Context]:\n${data.wiContext.join('\n\n')}\n`;
    }

    // 我们不让 AI 生成名字和标题，因为我们要修改当前的人设
    const currentName = currentContextData.name;
    const currentTitle = currentContextData.title;

    const systemPrompt = `You are a creative writing assistant.
Task: Refine the description for the User Persona "${currentName}"${currentTitle ? ` (${currentTitle})` : ""}.
${wiText}
Target Character: ${char.name}
Scenario: ${char.scenario || "None"}

[User Request]:
${data.request}

[Response Format]:
Return ONLY a JSON object:
{
    "description": ${formatInst},
    "wi_entry": "Concise facts."
}`;

    // 只使用主 API
    const generatedText = await context.generateQuietPrompt(systemPrompt, false, false, "System");
    return JSON.parse(generatedText.match(/\{[\s\S]*\}/)[0]);
}

// ============================================================================
// 4. UI 渲染与交互
// ============================================================================

async function openCreatorPopup() {
    const context = getContext();
    
    // 获取当前 Persona 信息
    const currentPersonaName = context.powerUserSettings.persona_selected || "User";
    const currentPersonaTitle = (context.powerUserSettings.persona_titles && context.powerUserSettings.persona_titles[currentPersonaName]) || "";
    // 获取当前描述 (用于回显，或者作为参考)
    const currentDesc = (context.powerUserSettings.personas && context.powerUserSettings.personas[currentPersonaName]) || "";

    // 保存到全局供生成函数使用
    currentContextData.name = currentPersonaName;
    currentContextData.title = currentPersonaTitle;

    loadData();
    await loadAvailableWorldBooks();
    
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
                    <!-- 只读的当前信息展示 -->
                    <div style="display:flex; gap:10px; opacity: 0.8;">
                        <input type="text" class="pw-input" value="${currentPersonaName}" disabled title="当前 Persona 名字 (不可修改)" style="flex:1;">
                        <input type="text" class="pw-input" value="${currentPersonaTitle}" disabled title="当前 Persona 标题 (不可修改)" style="flex:1;" placeholder="无标题">
                    </div>

                    <textarea id="pw-request" class="pw-textarea" placeholder="在此输入设定要求，或点击上方标签..." style="min-height:100px;"></textarea>
                    
                    <div class="pw-editor-tools">
                        <div class="pw-mini-btn" id="pw-clear"><i class="fa-solid fa-eraser"></i> 清空</div>
                        <div class="pw-mini-btn" id="pw-snapshot"><i class="fa-solid fa-save"></i> 存入历史</div>
                        <select id="pw-fmt-select" class="pw-input" style="width:auto; padding:2px 8px; font-size:0.85em;">
                            <option value="yaml" selected>YAML 属性</option>
                            <option value="paragraph">小说段落</option>
                        </select>
                    </div>
                </div>

                <button id="pw-btn-gen" class="pw-btn gen"><i class="fa-solid fa-bolt"></i> 生成 / 润色</button>

                <div id="pw-result-area" style="display: block; border-top: 1px dashed var(--SmartThemeBorderColor); padding-top: 15px; margin-top:5px;">
                    <div style="font-weight:bold; margin-bottom:10px; color:#5b8db8;"><i class="fa-solid fa-check-circle"></i> 结果 (当前描述)</div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        <textarea id="pw-res-desc" class="pw-textarea" rows="6" placeholder="等待生成...">${currentDesc}</textarea>
                        
                        <div style="background:rgba(0,0,0,0.1); padding:10px; border-radius:8px; border:1px solid var(--SmartThemeBorderColor);">
                            <div style="display:flex; align-items:center; gap:5px; margin-bottom:5px;">
                                <input type="checkbox" id="pw-wi-toggle" checked>
                                <span style="font-size:0.9em; font-weight:bold;">同步写入世界书</span>
                            </div>
                            <textarea id="pw-res-wi" class="pw-textarea" rows="3" placeholder="世界书条目内容..."></textarea>
                        </div>
                    </div>
                    <button id="pw-btn-apply" class="pw-btn save"><i class="fa-solid fa-floppy-disk"></i> 保存修改</button>
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
    window.pwExtraBooks = []; // Reset local
    
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

    // --- 6. 工具栏 ---
    $('#pw-clear').on('click', () => {
        if(confirm("清空输入内容？")) {
            $('#pw-request').val('');
        }
    });

    $('#pw-snapshot').on('click', () => {
        const req = $('#pw-request').val();
        const desc = $('#pw-res-desc').val();
        if (!req && !desc) return;
        
        const { name, title } = currentContextData;
        const finalTitle = title ? `${name} ${title}` : name;
        
        saveHistory({ 
            request: req || "无请求内容", 
            timestamp: new Date().toLocaleString(),
            targetChar: getContext().characters[getContext().characterId]?.name || "未知",
            data: { 
                name: name, title: title, description: desc, wi_entry: $('#pw-res-wi').val(), customTitle: finalTitle
            } 
        });
        toastr.success(TEXT.TOAST_SNAPSHOT);
    });

    // --- 7. 生成 ---
    $('#pw-btn-gen').on('click', async function() {
        const req = $('#pw-request').val();
        if (!req) return toastr.warning("请输入要求");

        const $btn = $(this);
        const oldText = $btn.html();
        $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> 处理中...');

        const wiContext = [];
        $('.pw-wi-check:checked').each(function() {
            wiContext.push(decodeURIComponent($(this).data('content')));
        });

        try {
            const data = await runGeneration({
                request: req,
                format: $('#pw-fmt-select').val(),
                wiContext: wiContext
            });
            
            $('#pw-res-desc').val(data.description);
            $('#pw-res-wi').val(data.wi_entry || data.description);
            
            const { name, title } = currentContextData;
            const finalTitle = title ? `${name} ${title}` : name;
            
            saveHistory({ 
                request: req, 
                timestamp: new Date().toLocaleString(),
                targetChar: getContext().characters[getContext().characterId]?.name || "未知", 
                data: {
                    name: name, title: title, description: data.description, wi_entry: data.wi_entry, customTitle: finalTitle
                }
            });
        } catch (e) {
            console.error(e);
            toastr.error(`${TEXT.TOAST_GEN_FAIL}: ${e.message}`);
        } finally {
            $btn.prop('disabled', false).html(oldText);
        }
    });

    // --- 8. 应用 (核心逻辑：修改当前设置并保存) ---
    $('#pw-btn-apply').on('click', async function() {
        const desc = $('#pw-res-desc').val();
        const wiContent = $('#pw-res-wi').val();
        const { name, title } = currentContextData;
        
        const context = getContext();
        
        // 1. 修改内存配置 (这是真正的数据源)
        if (context.powerUserSettings.personas) {
            context.powerUserSettings.personas[name] = desc;
        } else {
            // 防御性编程，如果对象不存在（极少见）
            context.powerUserSettings.personas = { [name]: desc };
        }

        // 2. 暴力刷新 UI (如果用户已经打开了 Persona 面板，确保他看到的是新的)
        const $descInput = $('#persona_description');
        if ($descInput.length && $descInput.is(':visible')) {
            $descInput.val(desc).trigger('input').trigger('change');
        }

        // 3. 写入磁盘
        await saveSettingsDebounced();

        // 4. 写入世界书 (如果勾选)
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
            }
        }

        toastr.success(TEXT.TOAST_SAVE_SUCCESS(name));
        $('.popup_close').click(); // 关闭我们的弹窗
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
// 初始化 (按钮注入逻辑)
// ============================================================================

jQuery(async () => {
    injectStyles();
    
    console.log(`${extensionName} v19 loaded. Waiting for Persona panel...`);

    // 核心注入逻辑：轮询检测 Persona 管理面板中的操作区
    setInterval(() => {
        // 寻找 Persona 面板中的操作按钮区域
        // 通常位于 #persona_management 面板内，人设名称旁边或下方
        // 选择器定位到那一排图标按钮 (Edit, Refresh, etc.)
        const $actionContainer = $('#persona_header_buttons'); 

        if ($actionContainer.length > 0 && $('#pw-trigger-btn').length === 0) {
            // 创建魔法棒按钮
            const $btn = $(`
                <div id="pw-trigger-btn" class="pw-inject-btn" title="✨ 设定编织者 Pro">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                </div>
            `);
            
            $btn.on('click', openCreatorPopup);
            
            // 插入到容器最前面
            $actionContainer.prepend($btn);
        }
    }, 1000); // 每秒检查一次
});
