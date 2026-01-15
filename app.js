// ========================================
// スクリーンショット注釈ツール - メインアプリケーション v3
// 複数画像対応版
// ========================================

class AnnotationApp {
    constructor() {
        // Canvas要素
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        
        // アプリケーション状態
        this.objects = []; // すべてのオブジェクト（画像含む）
        this.selectedObject = null;
        this.currentTool = 'select'; // 'select', 'rect', 'arrow', 'text', 'number', 'mosaic'
        
        // 現在のスタイル設定
        this.currentColor = '#ff3b30';
        this.currentLineWidth = 3;
        this.numberCounter = 1; // 番号スタンプのカウンター
        
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
        this.textInputBlurTimeout = null;
        
        // オブジェクトIDカウンター
        this.nextId = 1;
        
        // UI要素
        this.guide = document.getElementById('guide');
        this.infoText = document.getElementById('info-text');
        
        // 初期化
        this.initCanvas();
        this.bindEvents();
        this.updateUI();
        
        console.log('📸 スクリーンショット注釈ツール v3 起動 - 複数画像対応');
    }
    
    // ========================================
    // 初期化
    // ========================================
    
    initCanvas() {
        // 初期サイズ設定（大きめのキャンバス + Retina対応）
        const container = document.getElementById('canvas-container');
        const rect = container.getBoundingClientRect();
        
        // デバイスピクセル比を取得（Retina対応）
        this.dpr = window.devicePixelRatio || 1;
        console.log(`📱 デバイスピクセル比: ${this.dpr}x`);
        
        // デフォルトで大きめのキャンバスを用意
        const logicalWidth = Math.max(1920, rect.width - 40);
        const logicalHeight = Math.max(1080, rect.height - 40);
        
        // 物理ピクセルサイズを設定（高解像度）
        this.canvas.width = logicalWidth * this.dpr;
        this.canvas.height = logicalHeight * this.dpr;
        
        // CSS表示サイズを設定
        this.canvas.style.width = logicalWidth + 'px';
        this.canvas.style.height = logicalHeight + 'px';
        
        // 論理サイズを保存（座標計算用）
        this.logicalWidth = logicalWidth;
        this.logicalHeight = logicalHeight;
        
        // コンテキストをスケーリング
        this.ctx.scale(this.dpr, this.dpr);
        
        // 高品質レンダリング設定
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
        
        this.render();
        
        window.addEventListener('resize', () => {
            // ウィンドウリサイズ時は何もしない（既存のオブジェクトを保持）
        });
    }
    
    // ========================================
    // イベントバインディング
    // ========================================
    
    bindEvents() {
        // ツールボタン
        document.getElementById('btn-load').addEventListener('click', () => this.openFileDialog());
        document.getElementById('btn-select').addEventListener('click', () => this.setTool('select'));
        document.getElementById('btn-rect').addEventListener('click', () => this.setTool('rect'));
        document.getElementById('btn-arrow').addEventListener('click', () => this.setTool('arrow'));
        document.getElementById('btn-text').addEventListener('click', () => this.setTool('text'));
        document.getElementById('btn-number').addEventListener('click', () => this.setTool('number'));
        document.getElementById('btn-mosaic').addEventListener('click', () => this.setTool('mosaic'));
        document.getElementById('btn-undo').addEventListener('click', () => this.undo());
        document.getElementById('btn-redo').addEventListener('click', () => this.redo());
        document.getElementById('btn-delete').addEventListener('click', () => this.deleteSelected());
        document.getElementById('btn-export').addEventListener('click', () => this.exportPNG());
        
        // カラーピッカーとスライダー
        const colorPicker = document.getElementById('color-picker');
        const lineWidth = document.getElementById('line-width');
        const lineWidthValue = document.getElementById('line-width-value');
        
        document.querySelector('.color-label').addEventListener('click', () => {
            colorPicker.click();
        });
        
        colorPicker.addEventListener('input', (e) => {
            this.currentColor = e.target.value;
            console.log('色変更:', this.currentColor);
        });
        
        lineWidth.addEventListener('input', (e) => {
            this.currentLineWidth = parseInt(e.target.value);
            lineWidthValue.textContent = this.currentLineWidth + 'px';
        });
        
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
        
        // テキスト入力（blurのタイミングを遅延）
        this.textInput.addEventListener('blur', () => {
            this.textInputBlurTimeout = setTimeout(() => {
                if (this.editingText) {
                    this.finishTextEdit();
                }
            }, 100);
        });
        
        this.textInput.addEventListener('focus', () => {
            if (this.textInputBlurTimeout) {
                clearTimeout(this.textInputBlurTimeout);
                this.textInputBlurTimeout = null;
            }
        });
        
        this.textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (this.textInputBlurTimeout) {
                    clearTimeout(this.textInputBlurTimeout);
                    this.textInputBlurTimeout = null;
                }
                this.finishTextEdit();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                if (this.textInputBlurTimeout) {
                    clearTimeout(this.textInputBlurTimeout);
                    this.textInputBlurTimeout = null;
                }
                this.cancelTextEdit();
            }
            e.stopPropagation();
        });
    }
    
    // ========================================
    // ツール切り替え
    // ========================================
    
    setTool(tool) {
        console.log('🔧 ツール切り替え:', tool);
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
        } else if (tool === 'arrow') {
            document.getElementById('btn-arrow').classList.add('active');
            this.canvas.style.cursor = 'crosshair';
        } else if (tool === 'text') {
            document.getElementById('btn-text').classList.add('active');
            this.canvas.style.cursor = 'text';
        } else if (tool === 'number') {
            document.getElementById('btn-number').classList.add('active');
            this.canvas.style.cursor = 'crosshair';
        } else if (tool === 'mosaic') {
            document.getElementById('btn-mosaic').classList.add('active');
            this.canvas.style.cursor = 'crosshair';
        }
        
        // 選択解除
        this.selectedObject = null;
        this.render();
    }
    
    // ========================================
    // 画像読み込み（複数画像対応）
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
                this.addImageObject(img);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
    
    addImageObject(img) {
        // 画像を中央に配置（少しずつずらす）
        const offsetX = (this.objects.filter(o => o.type === 'image').length * 20) % 200;
        const offsetY = (this.objects.filter(o => o.type === 'image').length * 20) % 200;
        
        // 画像サイズの初期値（元サイズの50%または最大800px）
        let width = img.width;
        let height = img.height;
        const maxSize = 800;
        
        if (width > maxSize || height > maxSize) {
            const ratio = Math.min(maxSize / width, maxSize / height);
            width = width * ratio;
            height = height * ratio;
        } else {
            // 元サイズが小さい場合は50%に縮小
            width = width * 0.5;
            height = height * 0.5;
        }
        
        const newImage = {
            id: this.nextId++,
            type: 'image',
            x: 100 + offsetX,
            y: 100 + offsetY,
            width: width,
            height: height,
            image: img,
            originalWidth: img.width,
            originalHeight: img.height
        };
        
        // 画像は最背面に配置（配列の先頭に追加）
        this.objects.unshift(newImage);
        this.selectedObject = newImage;
        
        // ガイドを非表示
        this.guide.classList.add('hidden');
        
        // キャンバスサイズを拡張（必要に応じて）
        this.expandCanvasIfNeeded(newImage.x + newImage.width, newImage.y + newImage.height);
        
        this.render();
        this.saveHistory();
        this.updateUI();
        
        console.log(`✅ 画像追加: ${img.width}x${img.height} → ${width}x${height}`);
    }
    
    expandCanvasIfNeeded(requiredWidth, requiredHeight) {
        let needExpand = false;
        
        // 論理サイズで比較
        if (requiredWidth > this.logicalWidth) {
            this.logicalWidth = Math.max(requiredWidth + 200, this.logicalWidth);
            needExpand = true;
        }
        
        if (requiredHeight > this.logicalHeight) {
            this.logicalHeight = Math.max(requiredHeight + 200, this.logicalHeight);
            needExpand = true;
        }
        
        if (needExpand) {
            // 物理ピクセルサイズを更新
            this.canvas.width = this.logicalWidth * this.dpr;
            this.canvas.height = this.logicalHeight * this.dpr;
            
            // CSS表示サイズを更新
            this.canvas.style.width = this.logicalWidth + 'px';
            this.canvas.style.height = this.logicalHeight + 'px';
            
            // スケーリングを再適用
            this.ctx.scale(this.dpr, this.dpr);
            
            // 高品質レンダリング設定を再適用
            this.ctx.imageSmoothingEnabled = true;
            this.ctx.imageSmoothingQuality = 'high';
            
            console.log(`📐 キャンバス拡張: ${this.logicalWidth}x${this.logicalHeight} (物理: ${this.canvas.width}x${this.canvas.height})`);
        }
    }
    
    // ========================================
    // マウスイベント処理
    // ========================================
    
    handleMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        console.log(`🖱️ マウスダウン: (${Math.floor(x)}, ${Math.floor(y)}), ツール: ${this.currentTool}`);
        
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
            
            // オブジェクト選択（後ろから=上から）
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
            console.log('🔲 矩形作成開始');
            const newRect = {
                id: this.nextId++,
                type: 'rect',
                x: x,
                y: y,
                width: 0,
                height: 0,
                strokeStyle: this.currentColor,
                lineWidth: this.currentLineWidth
            };
            this.objects.push(newRect);
            this.dragObject = newRect;
            this.selectedObject = newRect;
            
        } else if (this.currentTool === 'arrow') {
            // 新しい矢印を作成開始
            console.log('➡️ 矢印作成開始');
            const newArrow = {
                id: this.nextId++,
                type: 'arrow',
                x1: x,
                y1: y,
                x2: x,
                y2: y,
                strokeStyle: this.currentColor,
                lineWidth: this.currentLineWidth
            };
            this.objects.push(newArrow);
            this.dragObject = newArrow;
            this.selectedObject = newArrow;
            
        } else if (this.currentTool === 'text') {
            // テキスト配置
            this.placeText(x, y);
            
        } else if (this.currentTool === 'number') {
            // 番号スタンプ配置
            console.log('🔢 番号スタンプ配置');
            this.placeNumber(x, y);
            
        } else if (this.currentTool === 'mosaic') {
            // モザイク領域を作成開始
            console.log('🔳 モザイク作成開始');
            const newMosaic = {
                id: this.nextId++,
                type: 'mosaic',
                x: x,
                y: y,
                width: 0,
                height: 0,
                pixelSize: 10,  // モザイクの粗さ
                imageData: null // 後で描画時にキャプチャ
            };
            this.objects.push(newMosaic);
            this.dragObject = newMosaic;
            this.selectedObject = newMosaic;
        }
    }
    
    handleMouseMove(e) {
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
                if (this.dragObject.type === 'arrow') {
                    this.dragObject.x1 += dx;
                    this.dragObject.y1 += dy;
                    this.dragObject.x2 += dx;
                    this.dragObject.y2 += dy;
                } else {
                    this.dragObject.x += dx;
                    this.dragObject.y += dy;
                }
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
            
        } else if (this.currentTool === 'arrow' && this.dragObject) {
            // 矢印の終点更新
            const obj = this.dragObject;
            obj.x2 = x;
            obj.y2 = y;
            this.render();
            
        } else if (this.currentTool === 'mosaic' && this.dragObject) {
            // モザイク領域のサイズ変更
            const obj = this.dragObject;
            obj.width = x - obj.x;
            obj.height = y - obj.y;
            this.render();
        }
    }
    
    handleMouseUp(e) {
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
            } else if (this.currentTool === 'arrow') {
                const obj = this.dragObject;
                // 矢印が短すぎる場合は削除
                const length = Math.sqrt((obj.x2 - obj.x1)**2 + (obj.y2 - obj.y1)**2);
                if (length < 10) {
                    this.objects = this.objects.filter(o => o.id !== obj.id);
                    this.selectedObject = null;
                } else {
                    this.saveHistory();
                }
            } else if (this.currentTool === 'mosaic') {
                const obj = this.dragObject;
                // サイズが小さすぎる場合は削除
                if (Math.abs(obj.width) < 10 && Math.abs(obj.height) < 10) {
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
                    // モザイク処理を実行してキャプチャ
                    this.captureMosaicArea(obj);
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
        if (this.currentTool !== 'select') return;
        
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
        
        // テキスト編集を開始（少し遅延させる）
        setTimeout(() => {
            this.editText(newText);
        }, 50);
    }
    
    editText(textObj) {
        this.editingText = textObj;
        this.textInput.value = textObj.text === 'テキストを入力' ? '' : textObj.text;
        
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
        this.updateUI();
    }
    
    cancelTextEdit() {
        if (!this.editingText) return;
        
        // 新規作成の場合は削除
        if (this.editingText.text === 'テキストを入力' || this.textInput.value.trim() === '') {
            this.objects = this.objects.filter(o => o.id !== this.editingText.id);
            if (this.selectedObject === this.editingText) {
                this.selectedObject = null;
            }
        }
        
        this.textInput.style.display = 'none';
        this.editingText = null;
        this.render();
        this.updateUI();
    }
    
    // ========================================
    // 番号スタンプ処理
    // ========================================
    
    placeNumber(x, y) {
        const newNumber = {
            id: this.nextId++,
            type: 'number',
            x: x - 20,  // 中心に配置
            y: y - 20,
            number: this.numberCounter++,
            radius: 20,
            fillStyle: this.currentColor,
            textColor: '#fff',
            fontSize: 18,
            fontWeight: 'bold'
        };
        
        this.objects.push(newNumber);
        this.selectedObject = newNumber;
        this.render();
        this.saveHistory();
    }
    
    // ========================================
    // モザイク処理
    // ========================================
    
    captureMosaicArea(mosaicObj) {
        // 一時的に選択を解除
        const prevSelected = this.selectedObject;
        this.selectedObject = null;
        
        // モザイクオブジェクトを除外して描画
        const prevObjects = this.objects;
        this.objects = this.objects.filter(o => o.id !== mosaicObj.id);
        this.render();
        
        // 領域の画像データを取得
        const imageData = this.ctx.getImageData(
            mosaicObj.x * this.dpr,
            mosaicObj.y * this.dpr,
            mosaicObj.width * this.dpr,
            mosaicObj.height * this.dpr
        );
        
        // モザイク処理を適用
        const mosaicImageData = this.applyMosaic(imageData, mosaicObj.pixelSize * this.dpr);
        
        // 処理済み画像をCanvasに変換
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = mosaicObj.width * this.dpr;
        tempCanvas.height = mosaicObj.height * this.dpr;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.putImageData(mosaicImageData, 0, 0);
        
        // Data URLとして保存
        mosaicObj.imageDataURL = tempCanvas.toDataURL();
        
        // オブジェクトを復元
        this.objects = prevObjects;
        this.selectedObject = prevSelected;
        this.render();
    }
    
    applyMosaic(imageData, pixelSize) {
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        
        // ピクセルサイズに基づいてモザイク処理
        for (let y = 0; y < height; y += pixelSize) {
            for (let x = 0; x < width; x += pixelSize) {
                // ブロック内の平均色を計算
                let r = 0, g = 0, b = 0, a = 0, count = 0;
                
                for (let py = y; py < Math.min(y + pixelSize, height); py++) {
                    for (let px = x; px < Math.min(x + pixelSize, width); px++) {
                        const idx = (py * width + px) * 4;
                        r += data[idx];
                        g += data[idx + 1];
                        b += data[idx + 2];
                        a += data[idx + 3];
                        count++;
                    }
                }
                
                // 平均値
                r = Math.floor(r / count);
                g = Math.floor(g / count);
                b = Math.floor(b / count);
                a = Math.floor(a / count);
                
                // ブロック全体に平均色を適用
                for (let py = y; py < Math.min(y + pixelSize, height); py++) {
                    for (let px = x; px < Math.min(x + pixelSize, width); px++) {
                        const idx = (py * width + px) * 4;
                        data[idx] = r;
                        data[idx + 1] = g;
                        data[idx + 2] = b;
                        data[idx + 3] = a;
                    }
                }
            }
        }
        
        return imageData;
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
        if (obj.type === 'image' || obj.type === 'rect' || obj.type === 'text' || obj.type === 'mosaic') {
            return x >= obj.x && x <= obj.x + obj.width &&
                   y >= obj.y && y <= obj.y + obj.height;
        } else if (obj.type === 'number') {
            const dx = x - (obj.x + obj.radius);
            const dy = y - (obj.y + obj.radius);
            return dx * dx + dy * dy <= obj.radius * obj.radius;
        } else if (obj.type === 'arrow') {
            // 矢印の線に近いかチェック
            const dist = this.distanceToLine(x, y, obj.x1, obj.y1, obj.x2, obj.y2);
            return dist < 10;
        }
        return false;
    }
    
    distanceToLine(px, py, x1, y1, x2, y2) {
        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        
        if (lenSq !== 0) param = dot / lenSq;
        
        let xx, yy;
        
        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }
        
        const dx = px - xx;
        const dy = py - yy;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    getResizeHandle(obj, x, y) {
        if (obj.type === 'arrow' || obj.type === 'number') return null;
        
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
        
        // キャンバス拡張チェック
        this.expandCanvasIfNeeded(obj.x + obj.width, obj.y + obj.height);
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
        } else if (this.currentTool === 'rect' || this.currentTool === 'arrow' || this.currentTool === 'number') {
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
        // 画像オブジェクトはImageオブジェクトを含むのでJSON化できない
        // dataURLに変換して保存
        const objectsForHistory = this.objects.map(obj => {
            if (obj.type === 'image') {
                return {
                    ...obj,
                    imageDataURL: obj.image.src
                };
            }
            return obj;
        });
        
        const state = JSON.stringify({
            objects: objectsForHistory,
            numberCounter: this.numberCounter,
            logicalWidth: this.logicalWidth,
            logicalHeight: this.logicalHeight
        });
        
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
        this.restoreFromHistory();
    }
    
    redo() {
        if (this.historyIndex >= this.history.length - 1) return;
        
        this.historyIndex++;
        this.restoreFromHistory();
    }
    
    restoreFromHistory() {
        const state = JSON.parse(this.history[this.historyIndex]);
        
        // 画像とモザイクオブジェクトを復元
        this.objects = state.objects.map(obj => {
            if (obj.type === 'image') {
                const img = new Image();
                img.src = obj.imageDataURL;
                return {
                    ...obj,
                    image: img
                };
            } else if (obj.type === 'mosaic' && obj.imageDataURL) {
                // モザイク画像をキャッシュ
                const img = new Image();
                img.src = obj.imageDataURL;
                return {
                    ...obj,
                    cachedImage: img
                };
            }
            return obj;
        });
        
        this.numberCounter = state.numberCounter;
        
        // 論理サイズを復元
        this.logicalWidth = state.logicalWidth;
        this.logicalHeight = state.logicalHeight;
        
        // 物理ピクセルサイズを更新
        this.canvas.width = this.logicalWidth * this.dpr;
        this.canvas.height = this.logicalHeight * this.dpr;
        
        // CSS表示サイズを更新
        this.canvas.style.width = this.logicalWidth + 'px';
        this.canvas.style.height = this.logicalHeight + 'px';
        
        // スケーリングを再適用
        this.ctx.scale(this.dpr, this.dpr);
        
        // 高品質レンダリング設定を再適用
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
        
        this.selectedObject = null;
        this.render();
        this.updateUI();
    }
    
    // ========================================
    // 描画
    // ========================================
    
    render() {
        // キャンバスをクリア（薄いグレー背景で描画を見やすく）
        this.ctx.fillStyle = '#f5f5f5';
        this.ctx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);
        
        // オブジェクトを描画（画像は最初に描画される）
        for (let obj of this.objects) {
            this.drawObject(obj);
        }
        
        // 選択オブジェクトのハンドルを描画
        if (this.selectedObject && this.currentTool === 'select') {
            this.drawSelectionHandles(this.selectedObject);
        }
    }
    
    drawObject(obj) {
        if (obj.type === 'image') {
            this.ctx.drawImage(obj.image, obj.x, obj.y, obj.width, obj.height);
            
        } else if (obj.type === 'rect') {
            this.ctx.strokeStyle = obj.strokeStyle;
            this.ctx.lineWidth = obj.lineWidth;
            this.ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
            
        } else if (obj.type === 'arrow') {
            this.drawArrow(obj);
            
        } else if (obj.type === 'text') {
            // 背景
            this.ctx.fillStyle = obj.backgroundColor;
            this.ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
            
            // テキスト
            this.ctx.fillStyle = obj.fillStyle;
            this.ctx.font = `${obj.fontSize}px ${obj.fontFamily}`;
            this.ctx.textBaseline = 'top';
            this.ctx.fillText(obj.text, obj.x + obj.padding, obj.y + obj.padding);
            
        } else if (obj.type === 'number') {
            this.drawNumber(obj);
            
        } else if (obj.type === 'mosaic') {
            // モザイク画像を描画
            if (obj.imageDataURL) {
                // 画像をキャッシュしない場合は毎回新規作成
                if (!obj.cachedImage) {
                    obj.cachedImage = new Image();
                    obj.cachedImage.src = obj.imageDataURL;
                }
                if (obj.cachedImage.complete) {
                    this.ctx.drawImage(obj.cachedImage, obj.x, obj.y, obj.width, obj.height);
                }
            } else {
                // モザイク未生成の場合、一時的に半透明の矩形を表示
                this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                this.ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
            }
        }
    }
    
    drawArrow(obj) {
        const headLength = 15;
        const angle = Math.atan2(obj.y2 - obj.y1, obj.x2 - obj.x1);
        
        // 線を描画
        this.ctx.strokeStyle = obj.strokeStyle;
        this.ctx.lineWidth = obj.lineWidth;
        this.ctx.lineCap = 'round';
        
        this.ctx.beginPath();
        this.ctx.moveTo(obj.x1, obj.y1);
        this.ctx.lineTo(obj.x2, obj.y2);
        this.ctx.stroke();
        
        // 矢印の頭を描画
        this.ctx.fillStyle = obj.strokeStyle;
        this.ctx.beginPath();
        this.ctx.moveTo(obj.x2, obj.y2);
        this.ctx.lineTo(
            obj.x2 - headLength * Math.cos(angle - Math.PI / 6),
            obj.y2 - headLength * Math.sin(angle - Math.PI / 6)
        );
        this.ctx.lineTo(
            obj.x2 - headLength * Math.cos(angle + Math.PI / 6),
            obj.y2 - headLength * Math.sin(angle + Math.PI / 6)
        );
        this.ctx.closePath();
        this.ctx.fill();
    }
    
    drawNumber(obj) {
        // 円を描画
        this.ctx.fillStyle = obj.fillStyle;
        this.ctx.beginPath();
        this.ctx.arc(obj.x + obj.radius, obj.y + obj.radius, obj.radius, 0, Math.PI * 2);
        this.ctx.fill();
        
        // 白い縁取り
        this.ctx.strokeStyle = '#fff';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        
        // 番号テキスト
        this.ctx.fillStyle = obj.textColor;
        this.ctx.font = `${obj.fontWeight} ${obj.fontSize}px Arial`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(obj.number.toString(), obj.x + obj.radius, obj.y + obj.radius);
    }
    
    drawSelectionHandles(obj) {
        if (obj.type === 'arrow' || obj.type === 'number') {
            // 矢印と番号には選択枠のみ
            this.ctx.strokeStyle = '#3498db';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            
            if (obj.type === 'arrow') {
                this.ctx.beginPath();
                this.ctx.arc(obj.x1, obj.y1, 5, 0, Math.PI * 2);
                this.ctx.stroke();
                this.ctx.beginPath();
                this.ctx.arc(obj.x2, obj.y2, 5, 0, Math.PI * 2);
                this.ctx.stroke();
            } else if (obj.type === 'number') {
                this.ctx.beginPath();
                this.ctx.arc(obj.x + obj.radius, obj.y + obj.radius, obj.radius + 5, 0, Math.PI * 2);
                this.ctx.stroke();
            }
            
            this.ctx.setLineDash([]);
            return;
        }
        
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
        if (this.objects.length === 0) return;
        
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
        } else if (e.key === 'a' || e.key === 'A') {
            if (!isMod) {
                this.setTool('arrow');
            }
        } else if (e.key === 't' || e.key === 'T') {
            if (!isMod) {
                this.setTool('text');
            }
        } else if (e.key === 'n' || e.key === 'N') {
            if (!isMod) {
                this.setTool('number');
            }
        } else if (e.key === 'm' || e.key === 'M') {
            if (!isMod) {
                this.setTool('mosaic');
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
        document.getElementById('btn-export').disabled = this.objects.length === 0;
        
        // 情報テキスト
        const imageCount = this.objects.filter(o => o.type === 'image').length;
        if (this.objects.length > 0) {
            this.infoText.textContent = `画像: ${imageCount}枚 | オブジェクト: ${this.objects.length}個 | 次の番号: ${this.numberCounter}`;
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
