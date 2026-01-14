// ========================================
// スクリーンショット注釈ツール - メインアプリケーション
// ========================================

class AnnotationApp {
    constructor() {
        // Canvas要素
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        
        // アプリケーション状態
        this.image = null;
        this.objects = []; // 描画オブジェクトの配列
        this.selectedObject = null;
        this.currentTool = 'select'; // 'select', 'rect', 'text'
        
        // 操作履歴（Undo/Redo用）
        this.history = [];
        this.historyIndex = -1;
        this.maxHistory = 50;
        
        // ドラッグ状態
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragObject = null;
        this.resizeHandle = null; // 'tl', 'tr', 'bl', 'br' or null
        
        // テキスト編集
        this.editingText = null;
        this.textInput = document.getElementById('text-input');
        
        // オブジェクトIDカウンター
        this.nextId = 1;
        
        // UI要素
        this.guide = document.getElementById('guide');
        this.infoText = document.getElementById('info-text');
        
        // 初期化
        this.initCanvas();
        this.bindEvents();
        this.updateUI();
        
        console.log('📸 スクリーンショット注釈ツール起動');
    }
    
    // ========================================
    // 初期化
    // ========================================
    
    initCanvas() {
        // 初期サイズ設定
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }
    
    resizeCanvas() {
        const container = document.getElementById('canvas-container');
        const rect = container.getBoundingClientRect();
        
        // キャンバスサイズをコンテナに合わせる（後で画像サイズに調整）
        if (!this.image) {
            this.canvas.width = Math.min(800, rect.width - 40);
            this.canvas.height = Math.min(600, rect.height - 40);
            this.render();
        }
    }
    
    // ========================================
    // イベントバインディング
    // ========================================
    
    bindEvents() {
        // ツールボタン
        document.getElementById('btn-load').addEventListener('click', () => this.openFileDialog());
        document.getElementById('btn-select').addEventListener('click', () => this.setTool('select'));
        document.getElementById('btn-rect').addEventListener('click', () => this.setTool('rect'));
        document.getElementById('btn-text').addEventListener('click', () => this.setTool('text'));
        document.getElementById('btn-undo').addEventListener('click', () => this.undo());
        document.getElementById('btn-redo').addEventListener('click', () => this.redo());
        document.getElementById('btn-delete').addEventListener('click', () => this.deleteSelected());
        document.getElementById('btn-export').addEventListener('click', () => this.exportPNG());
        
        // ファイル入力
        document.getElementById('file-input').addEventListener('change', (e) => this.handleFileSelect(e));
        
        // クリップボード貼り付け
        document.addEventListener('paste', (e) => this.handlePaste(e));
        
        // ドラッグ&ドロップ
        this.canvas.parentElement.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        this.canvas.parentElement.addEventListener('drop', (e) => this.handleDrop(e));
        
        // キャンバスマウスイベント
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('dblclick', (e) => this.handleDoubleClick(e));
        
        // キーボードショートカット
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        
        // テキスト入力
        this.textInput.addEventListener('blur', () => this.finishTextEdit());
        this.textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.finishTextEdit();
            }
            if (e.key === 'Escape') {
                this.cancelTextEdit();
            }
        });
    }
    
    // ========================================
    // ツール切り替え
    // ========================================
    
    setTool(tool) {
        this.currentTool = tool;
        
        // ボタンのactive状態を更新
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        if (tool === 'select') {
            document.getElementById('btn-select').classList.add('active');
            this.canvas.style.cursor = 'default';
        } else if (tool === 'rect') {
            document.getElementById('btn-rect').classList.add('active');
            this.canvas.style.cursor = 'crosshair';
        } else if (tool === 'text') {
            document.getElementById('btn-text').classList.add('active');
            this.canvas.style.cursor = 'text';
        }
        
        // 選択解除
        this.selectedObject = null;
        this.render();
    }
    
    // ========================================
    // 画像読み込み
    // ========================================
    
    openFileDialog() {
        document.getElementById('file-input').click();
    }
    
    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
            this.loadImageFromFile(file);
        }
    }
    
    handlePaste(e) {
        const items = e.clipboardData?.items;
        if (!items) return;
        
        for (let item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                this.loadImageFromFile(file);
                break;
            }
        }
    }
    
    handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const file = e.dataTransfer?.files[0];
        if (file && file.type.startsWith('image/')) {
            this.loadImageFromFile(file);
        }
    }
    
    loadImageFromFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                this.loadImage(img);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
    
    loadImage(img) {
        this.image = img;
        
        // キャンバスサイズを画像に合わせる（コンテナ内に収まるように）
        const container = document.getElementById('canvas-container');
        const rect = container.getBoundingClientRect();
        const maxWidth = rect.width - 40;
        const maxHeight = rect.height - 40;
        
        let width = img.width;
        let height = img.height;
        
        // アスペクト比を保ってリサイズ
        if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = width * ratio;
            height = height * ratio;
        }
        
        this.canvas.width = width;
        this.canvas.height = height;
        
        // 状態をリセット
        this.objects = [];
        this.selectedObject = null;
        this.history = [];
        this.historyIndex = -1;
        
        // ガイドを非表示
        this.guide.classList.add('hidden');
        
        // 描画
        this.render();
        this.updateUI();
        
        console.log(`✅ 画像読み込み完了: ${img.width}x${img.height} → ${width}x${height}`);
    }
    
    // ========================================
    // マウスイベント処理
    // ========================================
    
    handleMouseDown(e) {
        if (!this.image) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        this.dragStartX = x;
        this.dragStartY = y;
        this.isDragging = true;
        
        if (this.currentTool === 'select') {
            // リサイズハンドルのチェック
            if (this.selectedObject) {
                this.resizeHandle = this.getResizeHandle(this.selectedObject, x, y);
                if (this.resizeHandle) {
                    this.dragObject = this.selectedObject;
                    return;
                }
            }
            
            // オブジェクト選択
            const obj = this.getObjectAt(x, y);
            if (obj) {
                this.selectedObject = obj;
                this.dragObject = obj;
                this.render();
            } else {
                this.selectedObject = null;
                this.render();
            }
            
        } else if (this.currentTool === 'rect') {
            // 新しい矩形を作成開始
            const newRect = {
                id: this.nextId++,
                type: 'rect',
                x: x,
                y: y,
                width: 0,
                height: 0,
                strokeStyle: '#ff3b30',
                lineWidth: 3
            };
            this.objects.push(newRect);
            this.dragObject = newRect;
            this.selectedObject = newRect;
            
        } else if (this.currentTool === 'text') {
            // テキスト配置
            this.placeText(x, y);
        }
    }
    
    handleMouseMove(e) {
        if (!this.image) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // カーソル更新
        this.updateCursor(x, y);
        
        if (!this.isDragging) return;
        
        const dx = x - this.dragStartX;
        const dy = y - this.dragStartY;
        
        if (this.currentTool === 'select' && this.dragObject) {
            if (this.resizeHandle) {
                // リサイズ
                this.resizeObject(this.dragObject, this.resizeHandle, dx, dy);
            } else {
                // 移動
                this.dragObject.x += dx;
                this.dragObject.y += dy;
            }
            this.dragStartX = x;
            this.dragStartY = y;
            this.render();
            
        } else if (this.currentTool === 'rect' && this.dragObject) {
            // 矩形のサイズ変更
            const obj = this.dragObject;
            obj.width = x - obj.x;
            obj.height = y - obj.y;
            this.render();
        }
    }
    
    handleMouseUp(e) {
        if (!this.image) return;
        
        if (this.isDragging && this.dragObject) {
            // 矩形が作成された場合、履歴に追加
            if (this.currentTool === 'rect') {
                const obj = this.dragObject;
                // サイズが小さすぎる場合は削除
                if (Math.abs(obj.width) < 5 && Math.abs(obj.height) < 5) {
                    this.objects = this.objects.filter(o => o.id !== obj.id);
                    this.selectedObject = null;
                } else {
                    // 負のサイズを正規化
                    if (obj.width < 0) {
                        obj.x += obj.width;
                        obj.width = -obj.width;
                    }
                    if (obj.height < 0) {
                        obj.y += obj.height;
                        obj.height = -obj.height;
                    }
                    this.saveHistory();
                }
            } else if (this.currentTool === 'select') {
                // 移動・リサイズ完了
                this.saveHistory();
            }
        }
        
        this.isDragging = false;
        this.dragObject = null;
        this.resizeHandle = null;
        this.render();
    }
    
    handleDoubleClick(e) {
        if (!this.image || this.currentTool !== 'select') return;
        
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const obj = this.getObjectAt(x, y);
        if (obj && obj.type === 'text') {
            this.editText(obj);
        }
    }
    
    // ========================================
    // テキスト処理
    // ========================================
    
    placeText(x, y) {
        const newText = {
            id: this.nextId++,
            type: 'text',
            x: x,
            y: y,
            width: 200,
            height: 40,
            text: 'テキストを入力',
            fontSize: 18,
            fontFamily: 'Noto Sans JP, sans-serif',
            fillStyle: '#000',
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            padding: 8
        };
        
        this.objects.push(newText);
        this.selectedObject = newText;
        this.render();
        this.saveHistory();
        
        // テキスト編集を開始
        this.editText(newText);
    }
    
    editText(textObj) {
        this.editingText = textObj;
        this.textInput.value = textObj.text;
        
        // 入力欄を配置
        const rect = this.canvas.getBoundingClientRect();
        this.textInput.style.left = (rect.left + textObj.x) + 'px';
        this.textInput.style.top = (rect.top + textObj.y) + 'px';
        this.textInput.style.width = Math.max(200, textObj.width) + 'px';
        this.textInput.style.fontSize = textObj.fontSize + 'px';
        this.textInput.style.display = 'block';
        
        this.textInput.focus();
        this.textInput.select();
    }
    
    finishTextEdit() {
        if (!this.editingText) return;
        
        const text = this.textInput.value.trim();
        if (text) {
            this.editingText.text = text;
            
            // テキストの幅を計算して調整
            this.ctx.font = `${this.editingText.fontSize}px ${this.editingText.fontFamily}`;
            const metrics = this.ctx.measureText(text);
            this.editingText.width = metrics.width + this.editingText.padding * 2;
            
            this.saveHistory();
        } else {
            // 空の場合は削除
            this.objects = this.objects.filter(o => o.id !== this.editingText.id);
            if (this.selectedObject === this.editingText) {
                this.selectedObject = null;
            }
        }
        
        this.textInput.style.display = 'none';
        this.editingText = null;
        this.render();
    }
    
    cancelTextEdit() {
        if (!this.editingText) return;
        
        // 新規作成の場合は削除
        if (this.editingText.text === 'テキストを入力') {
            this.objects = this.objects.filter(o => o.id !== this.editingText.id);
            if (this.selectedObject === this.editingText) {
                this.selectedObject = null;
            }
        }
        
        this.textInput.style.display = 'none';
        this.editingText = null;
        this.render();
    }
    
    // ========================================
    // オブジェクト操作
    // ========================================
    
    getObjectAt(x, y) {
        // 後ろから（上のレイヤーから）チェック
        for (let i = this.objects.length - 1; i >= 0; i--) {
            const obj = this.objects[i];
            if (this.isPointInObject(obj, x, y)) {
                return obj;
            }
        }
        return null;
    }
    
    isPointInObject(obj, x, y) {
        if (obj.type === 'rect') {
            return x >= obj.x && x <= obj.x + obj.width &&
                   y >= obj.y && y <= obj.y + obj.height;
        } else if (obj.type === 'text') {
            return x >= obj.x && x <= obj.x + obj.width &&
                   y >= obj.y && y <= obj.y + obj.height;
        }
        return false;
    }
    
    getResizeHandle(obj, x, y) {
        const handleSize = 10;
        const corners = [
            { name: 'tl', x: obj.x, y: obj.y },
            { name: 'tr', x: obj.x + obj.width, y: obj.y },
            { name: 'bl', x: obj.x, y: obj.y + obj.height },
            { name: 'br', x: obj.x + obj.width, y: obj.y + obj.height }
        ];
        
        for (let corner of corners) {
            if (Math.abs(x - corner.x) < handleSize && Math.abs(y - corner.y) < handleSize) {
                return corner.name;
            }
        }
        return null;
    }
    
    resizeObject(obj, handle, dx, dy) {
        if (handle === 'tl') {
            obj.x += dx;
            obj.y += dy;
            obj.width -= dx;
            obj.height -= dy;
        } else if (handle === 'tr') {
            obj.y += dy;
            obj.width += dx;
            obj.height -= dy;
        } else if (handle === 'bl') {
            obj.x += dx;
            obj.width -= dx;
            obj.height += dy;
        } else if (handle === 'br') {
            obj.width += dx;
            obj.height += dy;
        }
        
        // 最小サイズ制限
        if (obj.width < 20) obj.width = 20;
        if (obj.height < 20) obj.height = 20;
    }
    
    updateCursor(x, y) {
        if (this.currentTool === 'select' && this.selectedObject) {
            const handle = this.getResizeHandle(this.selectedObject, x, y);
            if (handle) {
                if (handle === 'tl' || handle === 'br') {
                    this.canvas.style.cursor = 'nwse-resize';
                } else {
                    this.canvas.style.cursor = 'nesw-resize';
                }
                return;
            }
        }
        
        if (this.currentTool === 'select') {
            const obj = this.getObjectAt(x, y);
            this.canvas.style.cursor = obj ? 'move' : 'default';
        } else if (this.currentTool === 'rect') {
            this.canvas.style.cursor = 'crosshair';
        } else if (this.currentTool === 'text') {
            this.canvas.style.cursor = 'text';
        }
    }
    
    deleteSelected() {
        if (!this.selectedObject) return;
        
        this.objects = this.objects.filter(o => o.id !== this.selectedObject.id);
        this.selectedObject = null;
        this.render();
        this.saveHistory();
    }
    
    // ========================================
    // 履歴管理（Undo/Redo）
    // ========================================
    
    saveHistory() {
        // 現在の状態をJSON化して保存
        const state = JSON.stringify(this.objects);
        
        // 現在位置より後ろの履歴を削除
        this.history = this.history.slice(0, this.historyIndex + 1);
        
        // 新しい状態を追加
        this.history.push(state);
        this.historyIndex++;
        
        // 履歴数制限
        if (this.history.length > this.maxHistory) {
            this.history.shift();
            this.historyIndex--;
        }
        
        this.updateUI();
    }
    
    undo() {
        if (this.historyIndex <= 0) return;
        
        this.historyIndex--;
        this.objects = JSON.parse(this.history[this.historyIndex]);
        this.selectedObject = null;
        this.render();
        this.updateUI();
    }
    
    redo() {
        if (this.historyIndex >= this.history.length - 1) return;
        
        this.historyIndex++;
        this.objects = JSON.parse(this.history[this.historyIndex]);
        this.selectedObject = null;
        this.render();
        this.updateUI();
    }
    
    // ========================================
    // 描画
    // ========================================
    
    render() {
        // キャンバスをクリア
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // 画像を描画
        if (this.image) {
            this.ctx.drawImage(this.image, 0, 0, this.canvas.width, this.canvas.height);
        }
        
        // オブジェクトを描画
        for (let obj of this.objects) {
            this.drawObject(obj);
        }
        
        // 選択オブジェクトのハンドルを描画
        if (this.selectedObject && this.currentTool === 'select') {
            this.drawSelectionHandles(this.selectedObject);
        }
    }
    
    drawObject(obj) {
        if (obj.type === 'rect') {
            this.ctx.strokeStyle = obj.strokeStyle;
            this.ctx.lineWidth = obj.lineWidth;
            this.ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
            
        } else if (obj.type === 'text') {
            // 背景
            this.ctx.fillStyle = obj.backgroundColor;
            this.ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
            
            // テキスト
            this.ctx.fillStyle = obj.fillStyle;
            this.ctx.font = `${obj.fontSize}px ${obj.fontFamily}`;
            this.ctx.textBaseline = 'top';
            this.ctx.fillText(obj.text, obj.x + obj.padding, obj.y + obj.padding);
        }
    }
    
    drawSelectionHandles(obj) {
        const handleSize = 8;
        this.ctx.fillStyle = '#3498db';
        this.ctx.strokeStyle = '#fff';
        this.ctx.lineWidth = 2;
        
        const corners = [
            { x: obj.x, y: obj.y },
            { x: obj.x + obj.width, y: obj.y },
            { x: obj.x, y: obj.y + obj.height },
            { x: obj.x + obj.width, y: obj.y + obj.height }
        ];
        
        for (let corner of corners) {
            this.ctx.fillRect(corner.x - handleSize / 2, corner.y - handleSize / 2, handleSize, handleSize);
            this.ctx.strokeRect(corner.x - handleSize / 2, corner.y - handleSize / 2, handleSize, handleSize);
        }
    }
    
    // ========================================
    // PNG出力
    // ========================================
    
    exportPNG() {
        if (!this.image) return;
        
        // 選択状態を一時的に解除して描画
        const prevSelected = this.selectedObject;
        this.selectedObject = null;
        this.render();
        
        // PNG出力
        const dataURL = this.canvas.toDataURL('image/png');
        const link = document.createElement('a');
        const now = new Date();
        const filename = `annotated_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}.png`;
        
        link.download = filename;
        link.href = dataURL;
        link.click();
        
        // 選択状態を復元
        this.selectedObject = prevSelected;
        this.render();
        
        console.log(`💾 PNG出力: ${filename}`);
    }
    
    // ========================================
    // キーボードショートカット
    // ========================================
    
    handleKeyDown(e) {
        // テキスト入力中は無視
        if (this.editingText) return;
        
        // Ctrl/Cmd判定
        const isMod = e.ctrlKey || e.metaKey;
        
        if (isMod && e.key === 'z') {
            e.preventDefault();
            if (e.shiftKey) {
                this.redo();
            } else {
                this.undo();
            }
        } else if (isMod && e.key === 'y') {
            e.preventDefault();
            this.redo();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            this.deleteSelected();
        } else if (e.key === 'v' || e.key === 'V') {
            if (!isMod) {
                this.setTool('select');
            }
        } else if (e.key === 'r' || e.key === 'R') {
            if (!isMod) {
                this.setTool('rect');
            }
        } else if (e.key === 't' || e.key === 'T') {
            if (!isMod) {
                this.setTool('text');
            }
        }
    }
    
    // ========================================
    // UI更新
    // ========================================
    
    updateUI() {
        // Undo/Redoボタン
        document.getElementById('btn-undo').disabled = this.historyIndex <= 0;
        document.getElementById('btn-redo').disabled = this.historyIndex >= this.history.length - 1;
        
        // 削除ボタン
        document.getElementById('btn-delete').disabled = !this.selectedObject;
        
        // 出力ボタン
        document.getElementById('btn-export').disabled = !this.image;
        
        // 情報テキスト
        if (this.image) {
            this.infoText.textContent = `オブジェクト: ${this.objects.length}個 | 履歴: ${this.historyIndex + 1}/${this.history.length}`;
        } else {
            this.infoText.textContent = 'Ctrl/⌘+V で画像を貼り付け、または画像をドロップ';
        }
    }
}

// ========================================
// アプリケーション起動
// ========================================

window.addEventListener('DOMContentLoaded', () => {
    new AnnotationApp();
});
