# 技術仕様書 - スクリーンショット注釈ツール

## 📋 目次
1. [アーキテクチャ概要](#アーキテクチャ概要)
2. [データ構造詳細](#データ構造詳細)
3. [コア機能の実装](#コア機能の実装)
4. [バグりやすい点と対策](#バグりやすい点と対策)
5. [パフォーマンス最適化](#パフォーマンス最適化)
6. [今後の改善案](#今後の改善案)

---

## アーキテクチャ概要

### 技術スタック
- **フロントエンド**: Vanilla JavaScript (ES6+)
- **描画**: HTML5 Canvas API
- **スタイル**: CSS3
- **依存関係**: なし（ブラウザAPIのみ）

### ファイル構成と責務

```
webapp/
├── index.html          # DOM構造、UI要素配置
├── style.css           # ビジュアルデザイン、レスポンシブ
├── app.js              # アプリケーションロジック
│   ├── AnnotationApp   # メインクラス
│   │   ├── 状態管理
│   │   ├── イベント処理
│   │   ├── 描画エンジン
│   │   └── 履歴管理
└── README.md           # ユーザー向けドキュメント
```

### クラス設計: `AnnotationApp`

```javascript
class AnnotationApp {
    // === 状態 ===
    canvas, ctx              // Canvas要素とコンテキスト
    image                    // 読み込んだ画像
    objects[]                // 描画オブジェクト配列
    selectedObject           // 選択中のオブジェクト
    currentTool              // 'select' | 'rect' | 'text'
    
    // === 履歴 ===
    history[]                // JSON文字列の配列
    historyIndex             // 現在位置
    
    // === ドラッグ状態 ===
    isDragging               // ドラッグ中フラグ
    dragStartX, dragStartY   // ドラッグ開始座標
    dragObject               // ドラッグ中のオブジェクト
    resizeHandle             // リサイズハンドル名
    
    // === テキスト編集 ===
    editingText              // 編集中のテキストオブジェクト
    textInput                // HTML input要素
}
```

---

## データ構造詳細

### オブジェクトモデル

#### 1. 矩形（枠線）
```javascript
{
    id: number,              // 一意なID
    type: 'rect',            // オブジェクトタイプ
    x: number,               // 左上X座標
    y: number,               // 左上Y座標
    width: number,           // 幅
    height: number,          // 高さ
    strokeStyle: '#ff3b30',  // 枠線色（赤）
    lineWidth: 3             // 線の太さ
}
```

**設計理由**:
- 業務用に視認性の高い赤色を選択
- 線の太さ3pxで画面上でも見やすい

#### 2. テキスト
```javascript
{
    id: number,
    type: 'text',
    x: number,               // テキストボックス左上X
    y: number,               // テキストボックス左上Y
    width: number,           // ボックス幅（自動計算）
    height: number,          // ボックス高さ（固定）
    text: string,            // 表示テキスト
    fontSize: 18,            // フォントサイズ
    fontFamily: 'Noto Sans JP, sans-serif',
    fillStyle: '#000',       // テキスト色（黒）
    backgroundColor: 'rgba(255, 255, 255, 0.9)',  // 背景（白半透明）
    padding: 8               // 内側余白
}
```

**設計理由**:
- 背景を半透明にして画像が完全に隠れないように
- Noto Sans JPで日本語も綺麗に表示
- paddingで可読性を確保

### 履歴管理

#### データ構造
```javascript
history: string[]           // JSON.stringify(objects) の配列
historyIndex: number        // 現在の履歴位置
maxHistory: 50              // 最大保存数
```

#### 動作フロー
```
初期状態: history=[], historyIndex=-1

操作1実行 → saveHistory()
  history=['[{...}]'], historyIndex=0

操作2実行 → saveHistory()
  history=['[{...}]', '[{...,...}]'], historyIndex=1

Undo → historyIndex=0, objects復元

操作3実行 → saveHistory()
  history=['[{...}]', '[{...,...}]'], 履歴2を削除
  history=['[{...}]', '[{新規}]'], historyIndex=1
```

**設計理由**:
- JSON文字列化でディープコピーを簡単に実現
- 分岐履歴は削除（Photoshop方式）
- 50段階で十分な操作履歴を確保

---

## コア機能の実装

### 1. 画像読み込み

#### 3つの入力方法

```javascript
// A) クリップボード
document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    for (let item of items) {
        if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            loadImageFromFile(file);
        }
    }
});

// B) ドラッグ&ドロップ
element.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file && file.type.startsWith('image/')) {
        loadImageFromFile(file);
    }
});

// C) ファイル選択
<input type="file" accept="image/*">
```

#### 画像のリサイズロジック
```javascript
loadImage(img) {
    const maxWidth = containerWidth - 40;
    const maxHeight = containerHeight - 40;
    
    let width = img.width;
    let height = img.height;
    
    // アスペクト比を保って縮小
    if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width *= ratio;
        height *= ratio;
    }
    
    this.canvas.width = width;
    this.canvas.height = height;
}
```

**注意点**:
- `img.width` は画像の実サイズ
- Canvas座標系は表示サイズと一致
- DPIスケーリングは未実装（次節参照）

### 2. マウスイベント処理

#### イベントフロー
```
mousedown → isDragging=true, 座標記録
   ↓
mousemove → isDragging中のみ処理
   ↓        - 移動: オブジェクト座標更新
   ↓        - リサイズ: width/height更新
   ↓        - 矩形作成: 終点更新
   ↓
mouseup → isDragging=false, 履歴保存
```

#### 座標変換
```javascript
handleMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;  // ブラウザ座標 → Canvas座標
    const y = e.clientY - rect.top;
    
    // ... オブジェクト操作
}
```

**重要**: `getBoundingClientRect()` でCanvas要素の位置を取得し、相対座標に変換

### 3. オブジェクト選択

#### ヒットテスト
```javascript
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
    return x >= obj.x && x <= obj.x + obj.width &&
           y >= obj.y && y <= obj.y + obj.height;
}
```

**設計理由**:
- 配列の後ろ（レイヤー上位）から検索
- 矩形の単純な内外判定（十分高速）

### 4. リサイズ処理

#### ハンドル判定
```javascript
getResizeHandle(obj, x, y) {
    const handleSize = 10;  // ヒット判定サイズ
    const corners = [
        { name: 'tl', x: obj.x, y: obj.y },  // top-left
        { name: 'tr', x: obj.x + obj.width, y: obj.y },
        { name: 'bl', x: obj.x, y: obj.y + obj.height },
        { name: 'br', x: obj.x + obj.width, y: obj.y + obj.height }
    ];
    
    for (let corner of corners) {
        if (Math.abs(x - corner.x) < handleSize && 
            Math.abs(y - corner.y) < handleSize) {
            return corner.name;
        }
    }
    return null;
}
```

#### リサイズ計算
```javascript
resizeObject(obj, handle, dx, dy) {
    if (handle === 'tl') {
        obj.x += dx;        // 左上を動かす = 位置も変わる
        obj.y += dy;
        obj.width -= dx;    // 幅は逆方向に変化
        obj.height -= dy;
    }
    // ... 他のハンドル
    
    // 最小サイズ制限
    if (obj.width < 20) obj.width = 20;
    if (obj.height < 20) obj.height = 20;
}
```

### 5. テキスト編集

#### 編集フロー
```
1. テキストツールでクリック → 新規テキストオブジェクト作成
2. editText() → HTML input要素を表示
3. ユーザー入力
4. Enter → finishTextEdit() → テキスト確定、履歴保存
   Escape → cancelTextEdit() → キャンセル
```

#### input要素の配置
```javascript
editText(textObj) {
    const rect = this.canvas.getBoundingClientRect();
    this.textInput.style.left = (rect.left + textObj.x) + 'px';
    this.textInput.style.top = (rect.top + textObj.y) + 'px';
    this.textInput.style.display = 'block';
    this.textInput.focus();
}
```

**設計理由**:
- Canvas上の直接編集はIME対応が困難
- HTML input要素を使うことで安定した日本語入力を実現
- 位置を合わせることで違和感のないUX

### 6. 描画エンジン

#### 描画順序
```javascript
render() {
    // 1. クリア
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // 2. 画像（背景）
    if (this.image) {
        this.ctx.drawImage(this.image, 0, 0, 
            this.canvas.width, this.canvas.height);
    }
    
    // 3. オブジェクト（レイヤー順）
    for (let obj of this.objects) {
        this.drawObject(obj);
    }
    
    // 4. 選択ハンドル（最前面）
    if (this.selectedObject) {
        this.drawSelectionHandles(this.selectedObject);
    }
}
```

#### オブジェクト描画
```javascript
drawObject(obj) {
    if (obj.type === 'rect') {
        this.ctx.strokeStyle = obj.strokeStyle;
        this.ctx.lineWidth = obj.lineWidth;
        this.ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
    } 
    else if (obj.type === 'text') {
        // 背景
        this.ctx.fillStyle = obj.backgroundColor;
        this.ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
        
        // テキスト
        this.ctx.fillStyle = obj.fillStyle;
        this.ctx.font = `${obj.fontSize}px ${obj.fontFamily}`;
        this.ctx.textBaseline = 'top';
        this.ctx.fillText(obj.text, 
            obj.x + obj.padding, 
            obj.y + obj.padding);
    }
}
```

### 7. PNG出力

```javascript
exportPNG() {
    // 選択状態を一時解除
    const prevSelected = this.selectedObject;
    this.selectedObject = null;
    this.render();
    
    // Canvas → Data URL → ダウンロード
    const dataURL = this.canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `annotated_${timestamp}.png`;
    link.href = dataURL;
    link.click();
    
    // 選択状態を復元
    this.selectedObject = prevSelected;
    this.render();
}
```

**重要**: 選択ハンドルを出力に含めないため一時解除

---

## バグりやすい点と対策

### 1. 座標変換のズレ

#### 問題
```javascript
// ❌ 間違い
const x = e.clientX;
const y = e.clientY;
```
→ ブラウザウィンドウ座標がそのまま使われる

#### 対策
```javascript
// ✅ 正しい
const rect = this.canvas.getBoundingClientRect();
const x = e.clientX - rect.left;
const y = e.clientY - rect.top;
```
→ Canvas要素内の相対座標に変換

### 2. DPI/Retina対応

#### 問題
- 高DPIディスプレイで画像がぼやける
- `window.devicePixelRatio` が2以上の場合、Canvas内部解像度が不足

#### 現在の状況
- **未実装**（通常ディスプレイでは問題なし）

#### 対策案
```javascript
// 高DPI対応の例
const dpr = window.devicePixelRatio || 1;
this.canvas.width = width * dpr;
this.canvas.height = height * dpr;
this.canvas.style.width = width + 'px';
this.canvas.style.height = height + 'px';
this.ctx.scale(dpr, dpr);

// 座標変換も調整
const x = (e.clientX - rect.left) * dpr;
const y = (e.clientY - rect.top) * dpr;
```

### 3. 日本語入力（IME）の問題

#### 問題
- Canvas上で `keypress` イベントを使うとIME入力が不安定
- 変換中の文字が正しく取得できない

#### 対策（実装済み）
```javascript
// ✅ HTML input要素を使用
<input type="text" id="text-input">

// Canvas上には配置するが、入力は別要素で行う
editText(textObj) {
    this.textInput.style.left = (rect.left + textObj.x) + 'px';
    this.textInput.style.top = (rect.top + textObj.y) + 'px';
    this.textInput.focus();
}
```

### 4. Undo/Redo時のメモリリーク

#### 問題
- 履歴が無限に増えるとメモリを圧迫

#### 対策（実装済み）
```javascript
saveHistory() {
    const state = JSON.stringify(this.objects);
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(state);
    this.historyIndex++;
    
    // 最大50段階に制限
    if (this.history.length > this.maxHistory) {
        this.history.shift();
        this.historyIndex--;
    }
}
```

### 5. 矩形の負のサイズ

#### 問題
```javascript
// 右下から左上にドラッグすると
obj.width = -100;   // 負の値
obj.height = -50;
```
→ 描画が正しくない

#### 対策（実装済み）
```javascript
handleMouseUp(e) {
    const obj = this.dragObject;
    // 負のサイズを正規化
    if (obj.width < 0) {
        obj.x += obj.width;
        obj.width = -obj.width;
    }
    if (obj.height < 0) {
        obj.y += obj.height;
        obj.height = -obj.height;
    }
}
```

### 6. イベントリスナーの重複登録

#### 問題
```javascript
// ❌ 毎回addEventListenerすると重複する
button.addEventListener('click', handler);
button.addEventListener('click', handler);  // 2回呼ばれる
```

#### 対策（実装済み）
```javascript
// ✅ 初期化時に一度だけ登録
bindEvents() {
    // constructorから一度だけ呼ばれる
    document.getElementById('btn-undo').addEventListener('click', () => this.undo());
}
```

---

## パフォーマンス最適化

### 1. 再描画の最小化

#### 現在の実装
```javascript
// ドラッグ中は毎フレーム描画
handleMouseMove(e) {
    if (!this.isDragging) return;  // 早期リターン
    
    // 座標更新
    this.dragObject.x += dx;
    this.dragObject.y += dy;
    
    this.render();  // 再描画
}
```

#### 改善案
- **ダーティフラグ**: 変更があった時のみ描画
- **リクエストアニメーションフレーム**: ブラウザのリフレッシュレートに同期

```javascript
// 改善例
handleMouseMove(e) {
    if (!this.isDragging) return;
    
    this.dragObject.x += dx;
    this.dragObject.y += dy;
    
    // 次のフレームで描画（重複防止）
    if (!this.renderScheduled) {
        this.renderScheduled = true;
        requestAnimationFrame(() => {
            this.render();
            this.renderScheduled = false;
        });
    }
}
```

### 2. 大きい画像の処理

#### 現在の実装
- コンテナサイズに収まるように自動リサイズ
- Canvas解像度を下げることで描画負荷を軽減

#### さらなる改善案
```javascript
// オフスクリーンCanvasでバッファリング
this.offscreenCanvas = document.createElement('canvas');
this.offscreenCtx = this.offscreenCanvas.getContext('2d');

// 背景画像はオフスクリーンに一度だけ描画
loadImage(img) {
    this.offscreenCanvas.width = width;
    this.offscreenCanvas.height = height;
    this.offscreenCtx.drawImage(img, 0, 0, width, height);
}

// 再描画時は高速なコピー
render() {
    this.ctx.drawImage(this.offscreenCanvas, 0, 0);
    // オブジェクト描画...
}
```

### 3. オブジェクト検索の最適化

#### 現在の実装
- 線形探索 O(n)
- 小規模（数十個）では十分高速

#### 大規模対応（100個以上）
```javascript
// 空間分割（Quad Tree）の導入
class QuadTree {
    insert(obj) { ... }
    query(x, y) { ... }  // O(log n)
}

getObjectAt(x, y) {
    const candidates = this.quadTree.query(x, y);
    for (let obj of candidates) {
        if (this.isPointInObject(obj, x, y)) {
            return obj;
        }
    }
}
```

---

## 今後の改善案

### 優先度: 高

#### 1. テキストの複数行対応
```javascript
// 実装案
{
    type: 'text',
    text: '行1\n行2\n行3',  // 改行コードを含む
    lines: ['行1', '行2', '行3'],  // 描画用
    lineHeight: 1.5
}

// 描画
let y = obj.y + obj.padding;
for (let line of obj.lines) {
    this.ctx.fillText(line, obj.x + obj.padding, y);
    y += obj.fontSize * obj.lineHeight;
}
```

#### 2. 枠線の色・太さ変更
```javascript
// UIに追加
<input type="color" id="stroke-color" value="#ff3b30">
<input type="range" id="line-width" min="1" max="10" value="3">

// オブジェクト作成時に現在の設定を使用
const newRect = {
    // ...
    strokeStyle: this.currentStrokeColor,
    lineWidth: this.currentLineWidth
};
```

#### 3. Retina対応（前述のDPI対応）

### 優先度: 中

#### 4. 矢印ツール
```javascript
{
    type: 'arrow',
    x1, y1,  // 始点
    x2, y2,  // 終点
    strokeStyle: '#ff3b30',
    lineWidth: 3,
    arrowSize: 10
}

// 描画
drawArrow(obj) {
    // 線を描画
    this.ctx.beginPath();
    this.ctx.moveTo(obj.x1, obj.y1);
    this.ctx.lineTo(obj.x2, obj.y2);
    this.ctx.stroke();
    
    // 矢印の頭を描画（三角形）
    const angle = Math.atan2(obj.y2 - obj.y1, obj.x2 - obj.x1);
    // ... 三角形の頂点計算
}
```

#### 5. ぼかしツール（モザイク）
```javascript
{
    type: 'blur',
    x, y, width, height,
    blurAmount: 20
}

// 描画
drawBlur(obj) {
    // 対象領域の画像データを取得
    const imageData = this.ctx.getImageData(
        obj.x, obj.y, obj.width, obj.height
    );
    
    // ピクセル操作でモザイク処理
    // または既存のぼかしフィルタを適用
    
    this.ctx.putImageData(imageData, obj.x, obj.y);
}
```

### 優先度: 低

#### 6. 画像のズーム・パン
```javascript
// 状態追加
this.zoom = 1.0;
this.panX = 0;
this.panY = 0;

// 描画時に変換行列を適用
render() {
    this.ctx.save();
    this.ctx.translate(this.panX, this.panY);
    this.ctx.scale(this.zoom, this.zoom);
    
    // ... 通常の描画
    
    this.ctx.restore();
}

// マウスホイールでズーム
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    this.zoom *= e.deltaY > 0 ? 0.9 : 1.1;
    this.render();
});
```

---

## まとめ

### 達成した機能
✅ クリップボード・D&D・ファイルの3種類の画像入力  
✅ 枠線とテキストの追加  
✅ 選択・移動・リサイズ  
✅ 50段階のUndo/Redo  
✅ ショートカットキー完備  
✅ PNG出力  
✅ 日本語入力対応  
✅ 軽量（依存なし）  

### 主要な設計判断
1. **Vanilla JS**: 軽量化と学習コスト削減
2. **Canvas API**: 高速な描画とピクセル単位の制御
3. **オブジェクト配列**: シンプルで拡張しやすいデータ構造
4. **JSON履歴**: ディープコピーが簡単
5. **HTML input**: IME対応の安定性

### パフォーマンス特性
- **小規模画像** (1920x1080以下): 非常に高速
- **中規模画像** (4K): 快適に動作
- **大規模画像** (8K以上): 自動リサイズで対応

### 拡張性
- 新しいオブジェクトタイプの追加が容易
- 各機能が独立したメソッドで実装
- プラグイン化も可能な設計

---

**作成日**: 2026-01-14  
**バージョン**: 1.0.0
