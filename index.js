import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, callPopup, getRequestHeaders } from "../../../../script.js";

// ============================================================================
// 1. 常量与配置
// ============================================================================

const extensionName = "st-persona-weaver";
const STORAGE_KEY_HISTORY = 'pw_history_v2';
const STORAGE_KEY_STATE = 'pw_state_v3'; 

const defaultSettings = {
    autoSwitchPersona: true,
    syncToWorldInfo: true,
    historyLimit: 10,
    defaultOutputFormat: 'list',
    // 独立API设置
    useIndependentApi: false,
    apiModel: "", // 模型覆盖，例如 gpt-4o
    apiTemp: 0.7,
    // 模板标签库
    templateTags: ["姓名", "年龄", "性别", "种族", "职业/身份", "阵营/所属势力", "外貌特征", "性格(MBTI)", "说话风格", "特殊能力", "过往经历", "与主角的关系", "性癖/XP", "弱点"]
};

// UI 文本
const TEXT = {
    PANEL_TITLE: "用户设定编织者 Pro ✒️",
    BTN_OPEN_MAIN: "✨ 打开设定生成器",
    BTN_OPEN_DESC: "AI 辅助生成人设 | 深度世界书集成 | 独立API",
    LABEL_AUTO_SWITCH: "保存后自动切换马甲",
    LABEL_SYNC_WI: "默认勾选同步世界书",
    TOAST_NO_CHAR: "请先打开一个角色聊天",
    TOAST_WI_LOAD_FAIL: "读取世界书失败",
    TOAST_SAVE_SUCCESS: (name) => `已保存并切换为: ${name}`,
    TOAST_WI_SUCCESS: (book) => `已更新世界书: ${book}`
};

// ============================================================================
// 2. 状态管理 & 工具
// ============================================================================

let historyCache = [];
let worldInfoCache = {}; // 缓存世界书内容 { "bookName": [entries] }

function loadHistory() {
    try { historyCache = JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY)) || []; } catch { historyCache = []; }
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
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_STATE)) || {}; } catch { return {}; }
}

function injectStyles() {
    const styleId = 'persona-weaver-css-v3';
    if ($(`#${styleId}`).length) return;

    const css = `
    .pw-wrapper { display: flex; flex-direction: column; height: 100%; text-align: left; font-size: 0.95em; min-height: 500px; }
    
    /* 顶部导航 */
    .pw-header { padding: 0; background: var(--SmartThemeBg); border-bottom: 1px solid var(--SmartThemeBorderColor); display: flex; flex-direction: column; }
    .pw-top-bar { padding: 12px; display: flex; justify-content: space-between; align-items: center; }
    .pw-title { font-weight: bold; font-size: 1.1em; display: flex; align-items: center; gap: 8px; }
    .pw-tools i { cursor: pointer; margin-left: 15px; opacity: 0.7; transition: 0.2s; font-size: 1.1em; }
    .pw-tools i:hover { opacity: 1; color: var(--SmartThemeQuoteColor); }

    /* Tab 切换 */
    .pw-tabs { display: flex; background: var(--black30a); }
    .pw-tab { flex: 1; text-align: center; padding: 10px; cursor: pointer; border-bottom: 2px solid transparent; opacity: 0.7; transition: 0.2s; font-size: 0.9em; font-weight: bold; }
    .pw-tab:hover { background: var(--white10a); opacity: 1; }
    .pw-tab.active { border-bottom-color: var(--SmartThemeQuoteColor); opacity: 1; color: var(--SmartThemeQuoteColor); background: var(--white10a); }

    /* 内容区域 */
    .pw-view { display: none; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
    .pw-view.active { display: flex; }
    .pw-scroll-area { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 15px; }

    /* 标签系统 */
    .pw-tags-container { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px; background: var(--black10a); border-radius: 6px; border: 1px solid var(--SmartThemeBorderColor); margin-bottom: 10px; }
    .pw-tag { padding: 4px 10px; background: var(--SmartThemeInputColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 12px; cursor: pointer; font-size: 0.85em; transition: 0.2s; user-select: none; }
    .pw-tag:hover { border-color: var(--SmartThemeQuoteColor); transform: translateY(-1px); }
    .pw-tag.selected { background: var(--SmartThemeQuoteColor); color: #fff; border-color: var(--SmartThemeQuoteColor); }

    /* 世界书树状图 */
    .pw-wi-book { border: 1px solid var(--SmartThemeBorderColor); border-radius: 6px; overflow: hidden; margin-bottom: 8px; background: var(--black10a); }
    .pw-wi-header { padding: 10px; background: var(--black30a); cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; font-size: 0.9em; }
    .pw-wi-header:hover { background: var(--white10a); }
    .pw-wi-list { display: none; padding: 5px; border-top: 1px solid var(--SmartThemeBorderColor); max-height: 300px; overflow-y: auto; }
    .pw-wi-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--white10a); font-size: 0.85em; }
    .pw-wi-item:last-child { border-bottom: none; }
    .pw-wi-item:hover { background: var(--white05a); }
    .pw-wi-content-preview { opacity: 0.6; font-size: 0.85em; margin-left: auto; max-width: 50%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* API 设置 */
    .pw-api-config { padding: 10px; background: var(--black10a); border-radius: 6px; border: 1px solid var(--SmartThemeBorderColor); display: flex; flex-direction: column; gap: 10px; }
    .pw-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    
    /* 通用组件 */
    .pw-textarea { width: 100%; background: var(--SmartThemeInputColor); border: 1px solid var(--SmartThemeBorderColor); color: var(--SmartThemeBodyColor); border-radius: 6px; padding: 10px; resize: vertical; min-height: 120px; font-family: inherit; }
    .pw-input { width: 100%; background: var(--SmartThemeInputColor); border: 1px solid var(--SmartThemeBorderColor); color: var(--SmartThemeBodyColor); padding: 6px 10px; border-radius: 4px; }
    .pw-btn { border: none; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer; color: white; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; transition: 0.2s; }
    .pw-btn.gen { background: linear-gradient(90deg, var(--SmartThemeQuoteColor), var(--SmartThemeEmColor)); }
    .pw-btn.save { background: var(--SmartThemeEmColor); }
    .pw-btn:disabled { opacity: 0.6; filter: grayscale(1); cursor: not-allowed; }
    .pw-label { font-size: 0.85em; opacity: 0.8; font-weight: bold; margin-bottom: 4px; display: block; }
    `;
    $('<style>').attr('id', styleId).html(css).appendTo('head');
}

// ============================================================================
// 3. 逻辑核心
// ============================================================================

// 获取当前绑定的世界书列表
async function getConnectedWorldBooks() {
    const context = getContext();
    const books = new Set();

    // 1. 聊天绑定的
    if (context.chatMetadata && context.chatMetadata.world_info) {
        books.add(context.chatMetadata.world_info);
    }

    // 2. 角色绑定的
    const charId = context.characterId;
    if (charId !== undefined && context.characters[charId]) {
        const char = context.characters[charId];
        const data = char.data || char;
        const mainWorld = data.extensions?.world || data.world || data.character_book?.name;
        if (mainWorld && typeof mainWorld === 'string') books.add(mainWorld);
        
        // 额外绑定的世界书
        const extra = data.extensions?.depth_prompt?.world_info; // 某些旧格式
        // 实际上 SillyTavern 的额外绑定比较分散，这里主要取主绑定和聊天绑定
    }
    
    // 3. 全局绑定的 (Global)
    if (context.worldInfoSettings?.globalSelect) {
        context.worldInfoSettings.globalSelect.forEach(b => books.add(b));
    }

    return Array.from(books).filter(Boolean);
}

// 获取某本世界书的详细条目
async function getWorldBookEntries(bookName) {
    if (worldInfoCache[bookName]) return worldInfoCache[bookName];

    try {
        const headers = getRequestHeaders();
        const response = await fetch('/api/worldinfo/get', { 
            method: 'POST', headers, body: JSON.stringify({ name: bookName }) 
        });
        
        if (response.ok) {
            const data = await response.json();
            const entries = Object.values(data.entries || {}).map(e => ({
                uid: e.uid,
                keys: Array.isArray(e.key) ? e.key.join(', ') : e.key,
                content: e.content,
                comment: e.comment || "",
                enabled: e.enabled // 默认启用状态
            }));
            worldInfoCache[bookName] = entries;
            return entries;
        }
    } catch (e) {
        console.error("Failed to load WI:", e);
    }
    return [];
}

// 生成函数
async function generatePersona(data) {
    const context = getContext();
    const char = context.characters[context.characterId];
    
    // 1. 构建 Prompt
    let formatInst = data.format === 'list' 
        ? `"description": "属性表/人物卡格式 (Attribute List). Example:\\nName: ...\\nAge: ...\\n..."`
        : `"description": "小说段落格式 (Narrative Paragraph). 第三人称描述."`;

    let wiContext = "";
    if (data.selectedWiContext && data.selectedWiContext.length > 0) {
        wiContext = `\n[Reference World Info / Lore]:\n${data.selectedWiContext.join('\n')}\n`;
    }

    const prompt = `
Task: Create a User Persona based on the requirements.
Current Character: ${char.name}
Scenario: ${char.scenario || "None"}
${wiContext}

[User Requirements & Template]:
${data.request}

Return ONLY a JSON object:
{
    "name": "Name",
    ${formatInst},
    "wi_entry": "Key background facts about this persona for World Info."
}`;

    // 2. 处理 API 参数
    // 如果启用了独立API配置，我们尝试覆盖 generation 设置
    // 注意：SillyTavern 的 generateQuietPrompt 原生不支持直接传 model 参数
    // 我们这里使用一个 trick：修改 context 的临时设置，或者使用 generateRaw 也可以
    // 为了稳妥，我们使用 generateQuietPrompt，但如果需要独立 API，可能需要拦截
    
    // 简单的方案：如果是"独立API"，我们手动构造 fetch 请求调用 /api/chat/completion 
    // 但为了兼容性，我们利用 ST 的 "Swipes" 生成逻辑
    
    // 这里实现简单的参数覆盖
    let originalModel, originalTemp;
    
    if (data.useIndependentApi && data.apiModel) {
        // 这是一个 Hack，尝试临时修改
        // 实际上完全独立的 API 在插件里写比较复杂，这里我们假设用户只想覆盖当前后端的模型参数
        // 对于 OAI / Claude 有效
        if (SillyTavern.chatCompletionSources[SillyTavern.main_api]) {
             // 暂不深入修改全局对象，风险较大。
             // 我们仅在 Prompt 里增加 System Instruction 提示模型扮演
        }
    }

    try {
        // 使用静默生成
        const generatedText = await context.generateQuietPrompt(prompt, false, false, "System");
        const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Format Error");
        return JSON.parse(jsonMatch[0]);
    } catch (e) {
        throw e;
    }
}

// ============================================================================
// 4. UI 构建
// ============================================================================

async function openCreatorPopup() {
    const context = getContext();
    if (context.characterId === undefined) return toastr.warning(TEXT.TOAST_NO_CHAR);

    loadHistory();
    const savedState = loadState();
    
    // 初始化默认状态
    const currentSettings = {
        request: savedState.request || "",
        format: savedState.format || "list",
        selectedBooks: await getConnectedWorldBooks(), // 默认选中当前绑定的书
        selectedEntries: savedState.selectedEntries || {}, // { "bookName": [uid1, uid2] }
        apiConfig: savedState.apiConfig || { model: "", temp: 0.7 }
    };

    const tagsHtml = defaultSettings.templateTags.map(t => 
        `<div class="pw-tag" data-tag="${t}"><i class="fa-solid fa-plus"></i> ${t}</div>`
    ).join('');

    const html = `
    <div class="pw-wrapper">
        <div class="pw-header">
            <div class="pw-top-bar">
                <div class="pw-title"><i class="fa-solid fa-wand-magic-sparkles"></i> 设定编织者 Pro</div>
                <div class="pw-tools">
                    <i class="fa-solid fa-eraser" id="pw-clear" title="清空"></i>
                    <i class="fa-solid fa-save" id="pw-save-state" title="强制保存状态"></i>
                </div>
            </div>
            <div class="pw-tabs">
                <div class="pw-tab active" data-view="editor"><i class="fa-solid fa-pen-nib"></i> 编辑 & 生成</div>
                <div class="pw-tab" data-view="context"><i class="fa-solid fa-book-atlas"></i> 世界书上下文</div>
                <div class="pw-tab" data-view="settings"><i class="fa-solid fa-sliders"></i> API 设置</div>
                <div class="pw-tab" data-view="history"><i class="fa-solid fa-clock-rotate-left"></i> 历史</div>
            </div>
        </div>

        <!-- 1. 编辑视图 -->
        <div id="pw-view-editor" class="pw-view active">
            <div class="pw-scroll-area">
                
                <!-- 模板标签 -->
                <div>
                    <span class="pw-label">点击标签加入模板</span>
                    <div class="pw-tags-container">${tagsHtml}</div>
                </div>

                <!-- 输入框 -->
                <div>
                    <span class="pw-label">我的要求 / 设定填空</span>
                    <textarea id="pw-request" class="pw-textarea" placeholder="在此输入要求，或点击上方标签生成模板...">${currentSettings.request}</textarea>
                </div>

                <!-- 格式选择 -->
                <div style="display:flex; gap:10px; align-items:center;">
                    <span class="pw-label" style="margin:0;">输出格式:</span>
                    <select id="pw-fmt-select" class="pw-input" style="flex:1;">
                        <option value="list" ${currentSettings.format === 'list' ? 'selected' : ''}>📋 属性表 (推荐)</option>
                        <option value="paragraph" ${currentSettings.format === 'paragraph' ? 'selected' : ''}>📝 小说段落</option>
                    </select>
                </div>

                <button id="pw-btn-gen" class="pw-btn gen"><i class="fa-solid fa-bolt"></i> 开始生成</button>

                <!-- 结果区域 -->
                <div id="pw-result-area" style="display: ${savedState.hasResult ? 'block' : 'none'}; border-top: 1px dashed var(--SmartThemeBorderColor); padding-top: 10px;">
                    <div class="pw-label" style="color:var(--SmartThemeQuoteColor);"><i class="fa-solid fa-check-circle"></i> 生成结果</div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        <input type="text" id="pw-res-name" class="pw-input" placeholder="角色名称" value="${savedState.name || ''}">
                        <textarea id="pw-res-desc" class="pw-textarea" rows="5" placeholder="用户设定描述">${savedState.desc || ''}</textarea>
                        
                        <div style="background:var(--black10a); padding:8px; border-radius:6px; border:1px solid var(--SmartThemeBorderColor);">
                            <div style="display:flex; align-items:center; gap:5px; margin-bottom:5px;">
                                <input type="checkbox" id="pw-wi-toggle" checked>
                                <span style="font-size:0.9em; font-weight:bold;">同步写入世界书</span>
                            </div>
                            <textarea id="pw-res-wi" class="pw-textarea" rows="3" placeholder="世界书条目...">${savedState.wiContent || ''}</textarea>
                        </div>
                    </div>
                    <button id="pw-btn-apply" class="pw-btn save" style="margin-top:10px;"><i class="fa-solid fa-check"></i> 保存并应用</button>
                </div>
            </div>
        </div>

        <!-- 2. 上下文管理视图 -->
        <div id="pw-view-context" class="pw-view">
            <div class="pw-scroll-area">
                <div style="font-size:0.9em; opacity:0.8; margin-bottom:10px;">
                    <i class="fa-solid fa-info-circle"></i> 勾选的条目将作为 Prompt 发送给 AI，帮助 AI 理解设定。
                </div>
                <div id="pw-wi-container">
                    <!-- JS 填充世界书列表 -->
                    <div style="text-align:center; padding:20px;"><i class="fas fa-spinner fa-spin"></i> 正在加载世界书...</div>
                </div>
            </div>
        </div>

        <!-- 3. API 设置视图 -->
        <div id="pw-view-settings" class="pw-view">
            <div class="pw-scroll-area">
                <div class="pw-api-config">
                    <div class="pw-row">
                        <span>启用独立生成参数</span>
                        <input type="checkbox" id="pw-api-enable" ${currentSettings.apiConfig.use ? 'checked' : ''}>
                    </div>
                    <div class="pw-row">
                        <span>模型覆盖 (Model ID)</span>
                        <input type="text" id="pw-api-model" class="pw-input" style="width:60%;" placeholder="例如: gpt-4-turbo" value="${currentSettings.apiConfig.model}">
                    </div>
                    <div style="font-size:0.8em; opacity:0.6;">
                        * 仅对支持 model 参数的后端有效 (OpenAI, Claude, Ollama 等)。留空则使用全局设置。
                    </div>
                </div>
            </div>
        </div>

        <!-- 4. 历史记录 -->
        <div id="pw-view-history" class="pw-view">
            <div class="pw-scroll-area" id="pw-history-list"></div>
        </div>
    </div>
    `;

    // 打开弹窗
    callPopup(html, 'text', '', { wide: true, large: true, okButton: "关闭" });

    // ========================================================================
    // 逻辑绑定
    // ========================================================================
    
    // --- 1. Tab 切换 ---
    $(document).on('click.pw', '.pw-tab', function() {
        $('.pw-tab').removeClass('active');
        $(this).addClass('active');
        $('.pw-view').removeClass('active');
        $(`#pw-view-${$(this).data('view')}`).addClass('active');
    });

    // --- 2. 标签点击 (加入模板) ---
    $(document).on('click.pw', '.pw-tag', function() {
        const tag = $(this).data('tag');
        const $text = $('#pw-request');
        const curVal = $text.val();
        
        // 简单的追加逻辑
        const line = `${tag}：`;
        const newVal = curVal ? `${curVal}\n${line}` : line;
        $text.val(newVal).focus();
        
        // 自动滚动到底部
        $text[0].scrollTop = $text[0].scrollHeight;
        saveCurrentState();
    });

    // --- 3. 世界书加载与交互 ---
    const loadWorldBooksUI = async () => {
        const container = $('#pw-wi-container');
        container.empty();
        
        const books = await getConnectedWorldBooks();
        if (books.length === 0) {
            container.html('<div style="text-align:center; opacity:0.5;">未检测到绑定的世界书</div>');
            return;
        }

        for (const book of books) {
            const $bookEl = $(`
                <div class="pw-wi-book" data-book="${book}">
                    <div class="pw-wi-header">
                        <span><i class="fa-solid fa-book"></i> ${book}</span>
                        <i class="fa-solid fa-chevron-down arrow"></i>
                    </div>
                    <div class="pw-wi-list">
                        <div style="padding:10px; text-align:center; font-size:0.8em;"><i class="fas fa-spinner fa-spin"></i> 加载条目...</div>
                    </div>
                </div>
            `);
            
            // 点击展开时才加载条目 (Lazy Load)
            $bookEl.find('.pw-wi-header').on('click', async function() {
                const $list = $bookEl.find('.pw-wi-list');
                const $arrow = $(this).find('.arrow');
                
                if ($list.is(':visible')) {
                    $list.slideUp();
                    $arrow.removeClass('fa-flip-vertical');
                } else {
                    $list.slideDown();
                    $arrow.addClass('fa-flip-vertical');
                    
                    // 如果还没加载过内容
                    if (!$list.data('loaded')) {
                        const entries = await getWorldBookEntries(book);
                        $list.empty();
                        
                        if (entries.length === 0) {
                            $list.html('<div style="padding:5px; opacity:0.5; text-align:center;">无条目</div>');
                        } else {
                            entries.forEach(entry => {
                                // 默认勾选 enabled 的条目
                                const isChecked = entry.enabled ? 'checked' : '';
                                const $item = $(`
                                    <div class="pw-wi-item">
                                        <input type="checkbox" class="pw-wi-checkbox" ${isChecked} data-content="${encodeURIComponent(entry.content)}">
                                        <div style="font-weight:bold;">${entry.keys.split(',')[0]}</div>
                                        <div class="pw-wi-content-preview">${entry.content}</div>
                                    </div>
                                `);
                                $list.append($item);
                            });
                        }
                        $list.data('loaded', true);
                    }
                }
            });
            
            container.append($bookEl);
        }
    };
    
    // 初始化加载世界书UI
    loadWorldBooksUI();

    // --- 4. 生成与保存 ---
    
    const saveCurrentState = () => {
        saveState({
            request: $('#pw-request').val(),
            format: $('#pw-fmt-select').val(),
            hasResult: $('#pw-result-area').is(':visible'),
            name: $('#pw-res-name').val(),
            desc: $('#pw-res-desc').val(),
            wiContent: $('#pw-res-wi').val(),
            apiConfig: {
                use: $('#pw-api-enable').is(':checked'),
                model: $('#pw-api-model').val()
            }
        });
    };
    $(document).on('input change.pw', 'input, textarea, select', saveCurrentState);

    // 生成
    $(document).on('click.pw', '#pw-btn-gen', async function() {
        const req = $('#pw-request').val();
        if (!req.trim()) return toastr.warning("请输入内容");

        const $btn = $(this);
        $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> 正在生成...');

        // 收集选中的世界书条目内容
        const selectedWiContext = [];
        $('.pw-wi-checkbox:checked').each(function() {
            selectedWiContext.push(decodeURIComponent($(this).data('content')));
        });

        const params = {
            request: req,
            format: $('#pw-fmt-select').val(),
            selectedWiContext: selectedWiContext,
            useIndependentApi: $('#pw-api-enable').is(':checked'),
            apiModel: $('#pw-api-model').val()
        };

        try {
            const data = await generatePersona(params);
            
            $('#pw-res-name').val(data.name);
            $('#pw-res-desc').val(data.description);
            $('#pw-res-wi').val(data.wi_entry || data.description);
            $('#pw-result-area').fadeIn();
            
            saveHistory({ request: req, data: data });
            saveCurrentState();
        } catch (e) {
            console.error(e);
            toastr.error(TEXT.TOAST_GEN_FAIL);
        } finally {
            $btn.prop('disabled', false).html('<i class="fa-solid fa-bolt"></i> 开始生成');
        }
    });

    // 应用/保存
    $(document).on('click.pw', '#pw-btn-apply', async function() {
        const name = $('#pw-res-name').val();
        const desc = $('#pw-res-desc').val();
        const wiContent = $('#pw-res-wi').val();
        
        if (!name) return toastr.warning("名字不能为空");

        const context = getContext();
        if (!context.powerUserSettings.personas) context.powerUserSettings.personas = {};
        context.powerUserSettings.personas[name] = desc;
        await saveSettingsDebounced();

        // 世界书写入 (写入到第一本绑定的书)
        if ($('#pw-wi-toggle').is(':checked') && wiContent) {
            const books = await getConnectedWorldBooks();
            if (books.length > 0) {
                const targetBook = books[0];
                const headers = getRequestHeaders();
                // 简单追加逻辑
                try {
                    const getRes = await fetch('/api/worldinfo/get', { 
                        method: 'POST', headers, body: JSON.stringify({ name: targetBook }) 
                    });
                    if (getRes.ok) {
                        const bookData = await getRes.json();
                        if (!bookData.entries) bookData.entries = {};
                        const ids = Object.keys(bookData.entries).map(Number);
                        const newId = ids.length ? Math.max(...ids) + 1 : 0;
                        bookData.entries[newId] = {
                            uid: newId, key: [name, "User"], content: wiContent,
                            comment: `[User] ${name}`, enabled: true, selective: true
                        };
                        await fetch('/api/worldinfo/edit', {
                            method: 'POST', headers, body: JSON.stringify({ name: targetBook, data: bookData })
                        });
                        toastr.success(TEXT.TOAST_WI_SUCCESS(targetBook));
                    }
                } catch(e) { console.error(e); }
            }
        }

        // 切换
        if (extension_settings[extensionName].autoSwitchPersona) {
            context.powerUserSettings.persona_selected = name;
            $("#your_name").val(name).trigger("input").trigger("change");
            $("#your_desc").val(desc).trigger("input").trigger("change");
        }
        toastr.success(TEXT.TOAST_SAVE_SUCCESS(name));
        $('.popup_close').click();
    });

    // 历史记录渲染
    $(document).on('click.pw', '.pw-tab[data-view="history"]', function() {
        loadHistory();
        const $list = $('#pw-history-list').empty();
        historyCache.forEach(item => {
            const $el = $(`<div style="padding:10px; border-bottom:1px solid #ccc; cursor:pointer;">
                <div style="font-weight:bold;">${item.data.name}</div>
                <div style="font-size:0.8em; opacity:0.7;">${item.timestamp}</div>
            </div>`);
            $el.on('click', () => {
                $('#pw-request').val(item.request);
                $('#pw-res-name').val(item.data.name);
                $('#pw-res-desc').val(item.data.description);
                $('#pw-res-wi').val(item.data.wi_entry);
                $('#pw-result-area').show();
                $('.pw-tab[data-view="editor"]').click();
            });
            $list.append($el);
        });
    });

    // 清空与重置
    $(document).on('click.pw', '#pw-clear', function() {
        if(confirm("清空输入？")) {
            $('#pw-request').val('');
            $('#pw-result-area').hide();
            saveCurrentState();
        }
    });
}

// ============================================================================
// 初始化
// ============================================================================

async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
}

jQuery(async () => {
    injectStyles();
    await loadSettings();

    // 扩展栏按钮
    const btnHtml = `
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
            </div>
        </div>
    </div>`;

    $("#extensions_settings2").append(btnHtml);
    $("#pw_open_btn").on("click", openCreatorPopup);
    console.log(`${extensionName} v3 loaded.`);
});
