/* =========================================
   Theme: Native High Contrast (原生高对比)
   Logic: 放弃所有自定义色相，完全跟随酒馆字色
          通过 透明度 和 粗体 区分层级
========================================= */

.pw-wrapper {
    /* --- 核心变量：直接映射酒馆原生变量 --- */
    
    /* 1. 核心文字：强制使用酒馆当前主题的文字颜色 */
    --pw-text-main: var(--smart-theme-body-color); 
    
    /* 2. 次要文字：使用主文字色，但降低不透明度 (百搭方案) */
    --pw-text-muted: var(--smart-theme-body-color); 
    
    /* 3. 边框颜色：跟随酒馆设定 */
    --pw-border: var(--SmartThemeBorderColor);
    
    /* 4. 背景：使用半透明，让背景图透出来 */
    --pw-bg-color: transparent; 
    --pw-paper-bg: var(--smart-theme-input-bg, rgba(0, 0, 0, 0.05)); 
    
    /* 5. 重点色：不再用金/蓝，而是直接用酒馆的强调色(通常是链接色) */
    --pw-accent: var(--smart-theme-input-focus-border-color, var(--pw-text-main));
    
    --pw-danger: #ff6b6b;  /* 仅保留红色用于警告 */

    /* --- 布局属性 --- */
    display: flex; flex-direction: column; height: 100%; max-height: 90vh;
    font-size: 14px; 
    color: var(--pw-text-main);
    background-color: var(--pw-bg-color);
    position: relative;
    box-sizing: border-box; overflow: hidden;
    font-family: inherit; 
}

/* 滚动条 */
.pw-scroll-area {
    flex-grow: 1; overflow-y: auto; padding-right: 5px;
    display: flex; flex-direction: column; gap: 8px;
    padding-bottom: 10px; min-height: 0;
}
.pw-scroll-area::-webkit-scrollbar { width: 6px; }
.pw-scroll-area::-webkit-scrollbar-track { background: rgba(0,0,0,0.05); }
.pw-scroll-area::-webkit-scrollbar-thumb { 
    background: var(--pw-text-main); 
    opacity: 0.3; /* 滚动条半透明 */
    border-radius: 3px; 
}

/* =========================================
   2. 顶部 Header
========================================= */
.pw-header { 
    flex-shrink: 0; margin-bottom: 8px; 
    border-bottom: 1px solid var(--pw-border); 
    padding-bottom: 5px; 
}
.pw-top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.pw-title { 
    font-size: 1.2em; font-weight: bold; 
    display: flex; align-items: center; gap: 8px; 
    color: var(--pw-text-main); /* 强制跟随主题 */
}

.pw-tabs { display: flex; flex-direction: row; gap: 5px; overflow-x: auto; }
.pw-tab {
    padding: 6px 12px; cursor: pointer; border-radius: 6px 6px 0 0;
    opacity: 0.6; transition: all 0.2s; white-space: nowrap; 
    border: 1px solid transparent;
    display: flex; align-items: center; gap: 5px; font-size: 0.9em;
    color: var(--pw-text-main);
    background: rgba(128,128,128,0.1);
}
.pw-tab:hover { opacity: 0.9; background: rgba(128,128,128,0.2); }
.pw-tab.active { 
    opacity: 1; 
    background: var(--pw-paper-bg); 
    border-bottom: 2px solid var(--pw-text-main); /* 下划线跟随字色 */
    font-weight: bold; 
}

.pw-view { display: none; flex-grow: 1; overflow: hidden; flex-direction: column; height: 100%; width: 100%; }
.pw-view.active { display: flex; }

/* =========================================
   3. 组件样式 (解决这里看不清的问题)
========================================= */
.pw-info-display {
    display: flex; align-items: center; gap: 10px; 
    background: rgba(128,128,128,0.1); /* 万能半透明底 */
    padding: 8px; border-radius: 6px; 
    border: 1px solid var(--pw-border); 
    margin-bottom: 5px;
}
/* 解决：用户名颜色 */
.pw-info-item { 
    display: flex; align-items: center; gap: 6px; 
    font-weight: bold; 
    color: var(--pw-text-main); /* 强制主色 */
    font-size: 1.05em; 
}
#pw-display-name { 
    text-decoration: underline; 
    opacity: 0.9; 
}

/* 解决：载入按钮颜色 */
.pw-load-btn {
    font-size: 0.85em;
    background: transparent;
    border: 1px solid currentColor; /* 边框色 = 文字色 */
    padding: 4px 12px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--pw-text-main); /* 强制主色 */
    opacity: 0.8;
    font-weight: bold;
    margin-left: auto;
    display: inline-flex; align-items: center; transition: all 0.2s;
}
.pw-load-btn:hover { 
    opacity: 1;
    background: rgba(128,128,128,0.2); 
}

.pw-tags-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.pw-tags-label { font-weight: bold; opacity: 0.8; font-size: 0.85em; color: var(--pw-text-main); }
.pw-tags-edit-toggle { cursor: pointer; font-size: 0.8em; opacity: 0.7; text-decoration: underline; }

.pw-tags-container { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.pw-tag-chip {
    display: inline-flex; align-items: center; 
    background: rgba(128, 128, 128, 0.15);
    border: 1px solid var(--pw-border); 
    padding: 4px 10px; border-radius: 6px;
    font-size: 0.9em; cursor: pointer; transition: all 0.2s;
    color: var(--pw-text-main);
}
.pw-tag-chip:hover { 
    background: rgba(128, 128, 128, 0.3); 
    transform: translateY(-1px); 
}

/* 模版编辑器 */
.pw-template-editor-area {
    display: none; flex-direction: column; gap: 0;
    background: var(--pw-paper-bg); border-radius: 6px; border: 1px solid var(--pw-border); overflow: hidden;
}
.pw-template-textarea {
    width: 100%; height: 200px; font-family: monospace; font-size: 0.85em;
    background: transparent;
    color: var(--pw-text-main);
    border: none; resize: vertical; padding: 8px; white-space: pre; outline: none; box-sizing: border-box;
}
.pw-template-footer {
    display: flex; justify-content: space-between; align-items: center;
    background: rgba(128,128,128,0.1); padding: 5px 10px;
    border-top: 1px solid var(--pw-border);
}
.pw-shortcut-bar { display: flex; gap: 5px; align-items: center; }
.pw-shortcut-btn {
    padding: 4px 8px; cursor: pointer; font-size: 0.85em;
    background: rgba(128,128,128,0.2); color: inherit; border-radius: 4px; border: 1px solid transparent;
    transition: all 0.2s; font-family: monospace; opacity: 0.8;
}
.pw-shortcut-btn:hover { opacity: 1; border-color: var(--pw-text-main); }

/* =========================================
   4. 输入框与按钮 (原生风格)
========================================= */
.pw-input, .pw-textarea, .pw-select {
    background-color: var(--pw-paper-bg);
    border: 1px solid var(--pw-border);
    color: var(--pw-text-main); 
    border-radius: 6px; padding: 8px;
    font-family: inherit; font-size: inherit; outline: none; box-sizing: border-box;
}
.pw-input:focus, .pw-textarea:focus, .pw-select:focus { 
    border-color: var(--pw-text-main); 
    box-shadow: 0 0 5px rgba(128,128,128,0.2);
}
.pw-textarea { resize: vertical; line-height: 1.5; }

#pw-request { min-height: 200px; transition: min-height 0.3s ease; }
#pw-request.minimized { min-height: 80px; height: 80px !important; }

/* 按钮通用 */
.pw-btn {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    padding: 6px 12px; border-radius: 6px; 
    border: 1px solid var(--pw-border);
    background: rgba(128,128,128,0.1);
    color: var(--pw-text-main);
    cursor: pointer; font-weight: bold; width: auto; transition: all 0.2s; font-size: 0.95em;
}
.pw-btn:hover { background: rgba(128,128,128,0.25); filter: brightness(1.1); }

/* 生成按钮 (实心，为了显眼) */
.pw-btn.gen { 
    background: var(--pw-text-main); 
    color: var(--smart-theme-bg, #000); /* 文字颜色反转，保证对比 */
    border: none;
    width: 100%; margin-top: 5px;
}
.pw-btn.gen:hover { opacity: 0.9; }

/* 覆盖当前人设 */
.pw-btn.save { 
    border-color: var(--pw-text-main);
    color: var(--pw-text-main);
}

/* 危险按钮 */
.pw-btn.danger { 
    border-color: var(--pw-danger); 
    color: var(--pw-danger); 
    background: transparent;
}
.pw-btn.danger:hover { background: rgba(255, 107, 107, 0.1); }

/* 保存至世界书 */
.pw-btn.wi { 
    border-color: var(--pw-text-main); 
    color: var(--pw-text-main); 
    opacity: 0.8;
}
.pw-btn.wi:hover { opacity: 1; }

.pw-mini-btn {
    font-size: 0.85em; opacity: 0.8; cursor: pointer; display: flex; align-items: center; gap: 4px;
    padding: 6px 10px; border-radius: 4px; border: 1px solid var(--pw-border);
    background: rgba(128,128,128,0.1); color: var(--pw-text-main);
}
.pw-mini-btn:hover { opacity: 1; border-color: var(--pw-text-main); }

/* =========================================
   5. 结果区域与润色栏
========================================= */
.pw-relative-container { position: relative; }

.pw-result-textarea {
    width: 100%; min-height: 450px;
    background: var(--pw-paper-bg);
    border: 1px solid var(--pw-border); border-bottom: none; border-radius: 6px 6px 0 0;
    color: var(--pw-text-main); 
    padding: 12px;
    font-family: inherit; font-size: 1.0em; line-height: 1.6;
    resize: vertical; outline: none; white-space: pre-wrap; margin-bottom: 0;
}

.pw-refine-toolbar {
    display: flex; flex-direction: row; gap: 0; align-items: stretch;
    background: rgba(128,128,128,0.1);
    border: 1px solid var(--pw-border); border-top: none;
    border-radius: 0 0 6px 6px; margin-bottom: 5px; overflow: hidden;
}

.pw-refine-input {
    flex: 1; border: none; background: transparent; padding: 10px;
    font-size: 0.95em; color: var(--pw-text-main);
    resize: none; overflow-y: auto; min-height: 80px; line-height: 1.5;
}
.pw-refine-input:focus { outline: none; background: rgba(128,128,128,0.05); }

.pw-refine-btn-vertical {
    width: 40px; cursor: pointer;
    background: rgba(128,128,128,0.15); 
    border-left: 1px solid var(--pw-border);
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;
    color: var(--pw-text-main); font-weight: bold; transition: all 0.2s; flex-shrink: 0;
}
.pw-refine-btn-vertical:hover { background: rgba(128,128,128,0.3); }
.pw-refine-btn-text { writing-mode: vertical-rl; text-orientation: upright; letter-spacing: 2px; }

/* 悬浮修改按钮 */
.pw-float-quote-btn {
    position: fixed; top: 20%; right: 0;
    background: var(--pw-paper-bg); 
    color: var(--pw-text-main);
    padding: 8px 12px; border-radius: 20px 0 0 20px;
    font-weight: bold; font-size: 0.85em;
    box-shadow: -2px 2px 8px rgba(0,0,0,0.4); cursor: pointer; z-index: 9999;
    display: none; align-items: center; gap: 4px;
    border: 1px solid var(--pw-border); border-right: none;
    backdrop-filter: blur(5px);
}
.pw-float-quote-btn:hover { padding-right: 18px; transform: translateX(-2px); }

/* =========================================
   6. Diff 对比视图
========================================= */
.pw-diff-container {
    display: flex; flex-direction: column; gap: 0;
    background: var(--smart-theme-bg, #222); /* 跟随主题背景 */
    padding: 0;
    position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 2000;
    box-sizing: border-box; color: var(--pw-text-main);
}

.pw-diff-tabs-bar {
    display: flex; border-bottom: 1px solid var(--pw-border); 
    background: rgba(0,0,0,0.1);
    padding: 5px 5px 0 5px; gap: 5px; flex-shrink: 0;
}
.pw-diff-tab {
    padding: 8px 15px; cursor: pointer; border-radius: 6px 6px 0 0;
    background: rgba(128,128,128,0.1); border: 1px solid transparent; border-bottom: none;
    opacity: 0.6; font-weight: bold; font-size: 0.95em; transition: all 0.2s;
    color: var(--pw-text-main);
}
.pw-diff-tab.active { 
    opacity: 1; 
    background: transparent;
    color: var(--pw-text-main); 
    border-color: var(--pw-border); 
    border-bottom: 2px solid var(--pw-text-main); 
    margin-bottom: -1px; 
}

.pw-diff-content-area { flex: 1; overflow: hidden; position: relative; padding: 10px; display: flex; flex-direction: column; }
.pw-diff-list-view { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; padding-right: 5px; height: 100%; }
.pw-diff-raw-view { display: none; flex-direction: column; height: 100%; }
.pw-diff-raw-textarea {
    flex: 1; width: 100%; 
    background: rgba(0,0,0,0.1); 
    color: var(--pw-text-main);
    border: 1px solid var(--pw-border); border-radius: 6px; padding: 10px;
    font-family: monospace; resize: none; outline: none; font-size: 0.9em; line-height: 1.5;
    box-sizing: border-box; min-height: 350px;
}

.pw-diff-row { 
    background: rgba(128,128,128,0.05); 
    border: 1px solid var(--pw-border); 
    border-radius: 8px; padding: 10px; 
    display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; 
}
.pw-diff-attr-name { 
    font-weight: bold; color: var(--pw-text-main); 
    font-size: 1em; padding-bottom: 5px; 
    border-bottom: 1px solid var(--pw-border); margin-bottom: 5px; 
}
.pw-diff-cards { display: flex; gap: 10px; }
.pw-diff-card { flex: 1; display: flex; flex-direction: column; border: 2px solid transparent; border-radius: 6px; background: rgba(128,128,128,0.1); overflow: hidden; transition: all 0.2s; cursor: pointer; opacity: 0.6; position: relative; }
.pw-diff-card.selected { border-color: var(--pw-text-main); opacity: 1; background: rgba(128,128,128,0.2); }
.pw-diff-card:not(.selected):hover { opacity: 0.8; }
.pw-diff-label { font-size: 0.75em; padding: 4px 8px; background: rgba(0,0,0,0.2); color: inherit; text-transform: uppercase; font-weight: bold; }
.pw-diff-card.selected .pw-diff-label { color: var(--pw-text-main); background: rgba(128,128,128,0.3); }
.pw-diff-textarea { flex: 1; width: 100%; background: transparent; border: none; color: var(--pw-text-main); padding: 8px; font-family: inherit; font-size: 0.95em; resize: none; outline: none; line-height: 1.5; min-height: 80px; box-sizing: border-box; }
.pw-diff-card:not(.selected) .pw-diff-textarea { opacity: 0.5; pointer-events: none; }
.pw-diff-actions { display: flex; justify-content: flex-end; gap: 10px; padding: 10px; border-top: 1px solid var(--pw-border); flex-shrink: 0; background: var(--smart-theme-bg, #222); }

@media screen and (max-width: 600px) {
    .pw-diff-cards { flex-direction: column; }
    .pw-footer { flex-wrap: wrap; }
}

/* =========================================
   7. 底部动作栏
========================================= */
.pw-footer {
    margin-top: auto; padding-top: 8px; 
    border-top: 1px solid var(--pw-border);
    display: flex; justify-content: space-between; align-items: center; gap: 8px;
    flex-shrink: 0; background: rgba(128,128,128,0.1); padding: 8px; border-radius: 0 0 6px 6px;
}
.pw-footer-group { display: flex; gap: 5px; align-items: center; }
.pw-compact-btn { 
    width: 32px; height: 32px; border-radius: 4px; 
    border: 1px solid var(--pw-border); 
    background: transparent; color: var(--pw-text-main); 
    display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 1em; opacity: 0.7; transition: all 0.2s; 
}
.pw-compact-btn:hover { opacity: 1; background: rgba(128,128,128,0.2); border-color: var(--pw-text-main); }
.pw-compact-btn.danger:hover { border-color: var(--pw-danger); color: var(--pw-danger); }

.pw-tab-sub { display: block; font-size: 0.75em; opacity: 0.6; font-weight: normal; margin-top: 2px; text-align: center; }
.pw-diff-tab { display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.1; }
.pw-header-subtitle { font-size: 0.65em; opacity: 0.6; font-weight: normal; margin-left: 10px; color: var(--pw-text-main); }

/* =========================================
   8. API & Prompt & History
========================================= */
.pw-prompt-editor-block { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--pw-border); }
.pw-prompt-label { font-weight: bold; margin-bottom: 5px; display: block; color: var(--pw-text-main); }
.pw-var-btns { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 5px; }
.pw-var-btn { font-size: 0.8em; padding: 2px 6px; border: 1px solid var(--pw-border); border-radius: 4px; cursor: pointer; opacity: 0.7; color: var(--pw-text-main); }
.pw-var-btn:hover { opacity: 1; border-color: var(--pw-text-main); background: rgba(128,128,128,0.2); }

/* History Section */
.pw-hist-header { display: flex; align-items: center; justify-content: space-between; gap: 5px; }

/* 解决：历史记录标题颜色 */
.pw-hist-title-display { 
    font-weight: bold; 
    color: var(--pw-text-main); /* 强制主色 */
    font-size: 1.0em; 
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; 
}

.pw-hist-title-input { background: rgba(0,0,0,0.1); border: 1px solid var(--pw-text-main); color: inherit; font-size: 1.0em; padding: 2px 4px; border-radius: 3px; width: 100%; }
.pw-hist-action-btn { opacity: 0.5; cursor: pointer; padding: 2px 5px; font-size: 0.85em; color: var(--pw-text-main); }
.pw-hist-action-btn:hover { opacity: 1; color: var(--pw-text-main); font-weight: bold; }
.pw-hist-action-btn.del:hover { color: var(--pw-danger); }

.pw-card-section { 
    background: rgba(128, 128, 128, 0.1); 
    border: 1px solid var(--pw-border); 
    border-radius: 8px; padding: 10px; 
    display: flex; flex-direction: column; gap: 8px; 
}
.pw-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; flex-wrap: wrap; }
.pw-wi-controls { display: flex; gap: 6px; width: 100%; align-items: center; }
.pw-wi-select { flex-grow: 1; width: auto; min-width: 0; }
.pw-wi-refresh-btn { flex-shrink: 0; padding: 6px; width: auto; }
.pw-wi-book { border: 1px solid var(--pw-border); border-radius: 6px; margin-bottom: 6px; overflow: hidden; }
.pw-wi-header { padding: 8px; background: rgba(128,128,128,0.1); cursor: pointer; display: flex; justify-content: space-between; align-items: center; color: var(--pw-text-main); }
.pw-wi-list { display: none; padding: 8px; border-top: 1px solid var(--pw-border); }
.pw-wi-item { background: rgba(128,128,128,0.05); padding: 6px 10px; border-radius: 4px; margin-bottom: 4px; }
.pw-wi-item-row { display: flex; align-items: center; gap: 8px; }
.pw-wi-check { transform: scale(1.1); cursor: pointer; }
.pw-wi-close-bar { text-align: center; font-size: 0.8em; opacity: 0.6; cursor: pointer; margin-top: 3px; color: var(--pw-text-main); }

.pw-search-box { position: relative; display: flex; align-items: center; margin-bottom: 10px; background: rgba(128,128,128,0.1); border-radius: 6px; border: 1px solid var(--pw-border); }
.pw-search-icon { position: absolute; left: 10px; opacity: 0.5; pointer-events: none; color: var(--pw-text-main); }
.pw-search-input { width: 100%; padding-left: 32px !important; padding-right: 30px; border: none; background: transparent; color: var(--pw-text-main); }
.pw-search-clear { position: absolute; right: 10px; opacity: 0.5; cursor: pointer; z-index: 2; color: var(--pw-text-main); }

.pw-history-item { background: rgba(128,128,128,0.1); border: 1px solid var(--pw-border); border-radius: 6px; padding: 8px; margin-bottom: 6px; display: flex; gap: 8px; cursor: pointer; transition: background 0.2s; }
.pw-history-item:hover { background: rgba(128,128,128,0.2); }
.pw-hist-main { flex: 1; display: flex; flex-direction: column; gap: 3px; overflow: hidden; }
.pw-hist-meta { display: flex; gap: 8px; font-size: 0.75em; opacity: 0.6; color: var(--pw-text-main); }
.pw-hist-desc { font-size: 0.85em; opacity: 0.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--pw-text-main); }

#pw_persona_tool_btn {
    color: var(--smart-theme-body-color); cursor: pointer; display: flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; margin-right: 5px; font-size: 1.1em; opacity: 0.7; transition: opacity 0.2s;
}
#pw_persona_tool_btn:hover { opacity: 1; color: var(--pw-text-main); }

#pw-api-model-select { flex: 1; width: 0; min-width: 0; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }
#pw-api-url { background-color: var(--pw-paper-bg) !important; border: 1px solid var(--pw-border) !important; color: var(--pw-text-main) !important; }

/* 折叠标题样式 */
.pw-context-header { padding: 10px; background: rgba(128,128,128,0.1); cursor: pointer; display: flex; justify-content: space-between; align-items: center; border-radius: 6px; user-select: none; }
.pw-context-header:hover { background: rgba(128,128,128,0.2); }

/* 标签样式 (解决：金色蓝色看不清) */
.pw-section-label { font-weight: bold; font-size: 1em; padding: 2px 4px; }
.pw-label-gold { 
    color: var(--pw-text-main) !important; /* 强制主色 */
    opacity: 0.9;
}
.pw-label-blue { 
    color: var(--pw-text-main) !important; /* 强制主色 */
    opacity: 0.7;
}

/* 预览展开按钮/条 */
.pw-preview-toggle-bar {
    background: rgba(128,128,128,0.1); 
    color: var(--pw-text-main);
    font-size: 0.85em;
    text-align: center;
    padding: 6px;
    margin-top: 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.2s;
    border: 1px solid var(--pw-border);
    user-select: none;
    font-weight: bold;
}
.pw-preview-toggle-bar:hover { background: rgba(128,128,128,0.2); }

/* 文字预览框 */
.pw-wi-desc, #pw-greetings-preview {
    display: none;
    background: rgba(128,128,128,0.1) !important; 
    color: var(--pw-text-main) !important; 
    border: 1px solid var(--pw-border);
    border-radius: 4px;
    padding: 8px;
    font-size: 0.9em;
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    line-height: 1.5;
    margin-top: 5px;
}

#pw-greetings-preview {
    border-top: none;
    border-radius: 0 0 4px 4px;
    margin-top: -1px;
    min-height: 60px;
}

/* =========================================
   9. JS 动态元素的样式类 (替换 JS 内联样式)
========================================= */

/* 1. 世界书 - (已绑定) 文字 (解决：颜色问题) */
.pw-bound-status {
    color: var(--pw-text-main) !important; /* 强制主色 */
    opacity: 0.6; /* 降低不透明度来区分 */
    font-size: 0.8em;
    margin-left: 5px;
    font-weight: bold;
}

/* 2. 世界书 - 移除图标 (X) */
.pw-remove-book-icon {
    color: var(--pw-danger); 
    margin-right: 10px;
    cursor: pointer;
    transition: transform 0.2s;
}
.pw-remove-book-icon:hover {
    transform: scale(1.1);
}

/* 3. 顶部标题的魔杖图标 */
.pw-title-icon {
    color: var(--pw-text-main);
    margin-right: 5px;
}

/* 4. 模版编辑状态 (用于替换 JS 里的 .css('color', ...)) */
.pw-tags-edit-toggle.editing {
    color: var(--pw-danger) !important;
}

/* 5. 世界书条目展开图标 (眼睛) */
.pw-wi-toggle-icon {
    color: var(--pw-text-main);
    opacity: 0.5;
    cursor: pointer;
    margin-left: 8px;
}
.pw-wi-toggle-icon.active {
    color: var(--pw-text-main);
    opacity: 1;
}
