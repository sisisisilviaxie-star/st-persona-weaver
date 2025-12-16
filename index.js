/* ==========================================================================
   Style.css - v10 (Inline Tags)
   ========================================================================== */

/* 弹窗容器 */
.swal2-popup.pw-wide { 
    width: 95% !important; max-width: 800px !important;
    padding: 0 !important; display: flex !important; flex-direction: column;
    max-height: 90vh !important;
}
.swal2-html-container {
    margin: 0 !important; padding: 0 !important; overflow: hidden !important;
    display: flex; flex-direction: column; flex: 1; text-align: left !important;
}

/* 顶部与布局 */
.pw-header {
    padding: 15px; border-bottom: 1px solid var(--smart-theme-border-color-1);
    display: flex; justify-content: space-between; align-items: center;
    flex-shrink: 0; background: var(--smart-theme-bg);
}
.pw-title { font-weight: bold; font-size: 1.1em; color: var(--smart-theme-body-color); }
.pw-wrapper { display: flex; flex-direction: column; height: 100%; position: relative; overflow: hidden; }

/* 标签栏 (Tab) */
.pw-tabs { display: flex; background: rgba(0,0,0,0.2); user-select: none; border-top: 1px solid var(--smart-theme-border-color-1); }
.pw-tab { 
    flex: 1; text-align: center; padding: 10px; cursor: pointer; 
    border-bottom: 3px solid transparent; opacity: 0.7; font-size: 0.9em; 
    font-weight: bold; transition: 0.2s; 
}
.pw-tab:hover { background: rgba(255,255,255,0.05); opacity: 1; }
.pw-tab.active { border-bottom-color: #5b8db8; opacity: 1; color: #5b8db8; background: rgba(255,255,255,0.02); }

/* 视图区域 */
.pw-view { display: none; flex-direction: column; flex: 1; min-height: 0; }
.pw-view.active { display: flex; }
.pw-scroll-area { 
    flex: 1; overflow-y: auto; padding: 15px; 
    display: flex; flex-direction: column; gap: 15px; 
}

/* [核心修改] 标签系统 (Tag System) */
.pw-tags-wrapper { margin-bottom: 5px; }
.pw-tags-container { 
    display: flex; flex-wrap: wrap; gap: 8px; 
    padding: 10px; background: rgba(0,0,0,0.1); 
    border-radius: 8px; border: 1px solid var(--smart-theme-border-color-1); 
    min-height: 40px; align-items: center;
}

/* 浏览模式的标签 */
.pw-tag { 
    padding: 5px 10px; background: var(--smart-theme-bg); 
    border: 1px solid var(--smart-theme-border-color-1); 
    border-radius: 20px; cursor: pointer; font-size: 0.85em; 
    user-select: none; transition: 0.1s; display: flex; align-items: center;
}
.pw-tag:hover { border-color: #5b8db8; color: #5b8db8; transform: translateY(-1px); }
.pw-tag-val { opacity: 0.6; font-size: 0.9em; margin-left: 4px; padding-left: 4px; border-left: 1px solid rgba(128,128,128,0.3); }

/* 新增按钮 */
.pw-tag-add {
    padding: 5px 12px; border: 1px dashed var(--smart-theme-border-color-1);
    border-radius: 20px; cursor: pointer; font-size: 0.85em; opacity: 0.7;
}
.pw-tag-add:hover { border-color: #7a9a83; color: #7a9a83; opacity: 1; background: rgba(122, 154, 131, 0.1); }

/* 编辑模式的标签 */
.pw-tag.editing {
    background: rgba(0,0,0,0.2); border-radius: 6px; padding: 5px;
    cursor: default; transform: none; border-color: transparent;
}
.pw-tag.editing:hover { border-color: transparent; color: inherit; }
.pw-tag-input {
    background: transparent; border: none; border-bottom: 1px solid rgba(128,128,128,0.3);
    color: var(--smart-theme-body-color); font-size: 0.9em; width: 70px; text-align: center;
    padding: 2px;
}
.pw-tag-input:focus { outline: none; border-bottom-color: #5b8db8; }
.pw-tag-input.val { width: 90px; opacity: 0.8; font-size: 0.85em; }
.pw-tag-del {
    color: #ff6b6b; cursor: pointer; padding: 2px 6px; margin-left: 4px;
    opacity: 0.6; font-size: 0.9em;
}
.pw-tag-del:hover { opacity: 1; transform: scale(1.2); }

/* 顶部标签管理按钮状态 */
.pw-tags-edit-btn { cursor: pointer; opacity: 0.6; transition: 0.2s; font-size: 1.1em; }
.pw-tags-edit-btn:hover { opacity: 1; }
.pw-tags-edit-btn.active { color: #7a9a83; opacity: 1; transform: rotate(0deg); }


/* 通用控件 */
.pw-textarea {
    width: 100%; background: rgba(0,0,0,0.05);
    border: 1px solid var(--smart-theme-border-color-1);
    color: var(--smart-theme-body-color);
    border-radius: 8px; padding: 10px; resize: vertical;
    font-family: inherit; min-height: 80px; line-height: 1.5;
}
.pw-textarea:focus { border-color: #5b8db8; outline: none; }

.pw-input {
    width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.05);
    border: 1px solid var(--smart-theme-border-color-1);
    color: var(--smart-theme-body-color); padding: 8px; border-radius: 6px;
}

/* 按钮组 */
.pw-btn {
    border: none; padding: 10px; border-radius: 6px; font-weight: bold;
    cursor: pointer; color: white; display: flex; align-items: center; justify-content: center;
    gap: 6px; transition: 0.2s;
}
.pw-btn:hover { filter: brightness(1.1); }
.pw-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.pw-btn.gen { background: linear-gradient(90deg, #5b8db8, #4a7a9e); width: 100%; margin-top: 10px; }
.pw-btn.save { background: #7a9a83; margin-top: 10px; width: 100%; }
.pw-btn.normal { background: rgba(255,255,255,0.1); color: var(--smart-theme-body-color); padding: 5px 10px; font-size: 0.9em; }
.pw-btn.primary { background: #5b8db8; }

.pw-editor-controls { display: flex; justify-content: space-between; align-items: center; margin-top: 5px; }
.pw-mini-btn { font-size: 0.85em; cursor: pointer; opacity: 0.7; display: flex; align-items: center; gap: 4px; }
.pw-mini-btn:hover { opacity: 1; color: #5b8db8; }

/* 历史记录 */
.pw-history-item {
    background: rgba(0,0,0,0.1); border: 1px solid var(--smart-theme-border-color-1);
    padding: 12px; border-radius: 8px; display: flex; justify-content: space-between;
    gap: 10px; transition: 0.1s;
}
.pw-history-item:hover { background: rgba(255,255,255,0.05); border-color: #5b8db8; }
.pw-hist-content { flex: 1; cursor: pointer; min-width: 0; }
.pw-hist-header { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
.pw-hist-title { 
    font-weight: bold; color: #5b8db8; background: transparent; border: none; 
    border-bottom: 1px dashed transparent; width: auto; max-width: 200px;
}
.pw-hist-title.editing { border-bottom-color: currentColor; }
.pw-hist-meta { font-size: 0.8em; opacity: 0.6; display: flex; gap: 10px; }
.pw-hist-desc { font-size: 0.85em; opacity: 0.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 4px; }
.pw-hist-del { color: #ff6b6b; padding: 5px; cursor: pointer; opacity: 0.6; }
.pw-hist-del:hover { opacity: 1; transform: scale(1.1); }

/* 底部红色文字按钮 */
.pw-text-danger-btn {
    color: #ff6b6b; font-size: 0.85em; cursor: pointer; text-align: center;
    padding: 10px; margin-top: auto; opacity: 0.7; transition: 0.2s;
}
.pw-text-danger-btn:hover { opacity: 1; text-decoration: underline; }

/* API & WI */
.pw-api-card { padding: 15px; background: rgba(0,0,0,0.1); border-radius: 8px; display: flex; flex-direction: column; gap: 10px; }
.pw-wi-book { background: rgba(0,0,0,0.1); border-radius: 6px; overflow: hidden; margin-bottom: 5px; }
.pw-wi-header { padding: 8px 12px; cursor: pointer; display: flex; justify-content: space-between; font-weight: bold; font-size: 0.9em; background: rgba(0,0,0,0.2); }
.pw-wi-list { display: none; padding: 5px; }
.pw-wi-item { padding: 5px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid rgba(255,255,255,0.05); }
.pw-wi-content { display: none; padding: 5px; font-size: 0.85em; opacity: 0.8; background: rgba(0,0,0,0.2); margin-top: 2px; }

.pw-label { font-size: 0.85em; opacity: 0.8; font-weight: bold; margin-bottom: 5px; display: block; }
