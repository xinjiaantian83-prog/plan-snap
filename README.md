# PlanSnap

CADほど複雑ではなく、手書きより速く・きれいに平面図を作る、現場向けの軽量作図アプリです。スマートフォンを最優先に、タブレットとPCでも同じデータ・操作体系で使えます。

## 起動方法

Node.js 20 以上を用意し、次を実行します。

```bash
npm install
npm run dev
```

本番ビルドとテストは次の通りです。

```bash
npm run test
npm run build
npm run preview
```

## 採用技術

- React + TypeScript + Vite: 小さく始めやすく、PWAやCapacitorを利用したストア展開へ発展可能
- SVG: ベクター線を軽量に描画でき、DOMイベントでタッチ・マウス操作を共通化しやすい
- Pointer Events: ペン、タッチ、マウスを同一実装で扱う
- IndexedDB: ログインやサーバーなしで、複数の図面を端末内に保存
- Web App Manifest + Service Worker: PWA化の土台

外部UIライブラリや重いCADライブラリは使わず、第1段階の操作感と保守性を優先しています。

## 操作

- PCでは「線」を選び、始点をクリックしてからポインタでプレビューし、終点をクリックして確定。Escまたは右クリックでキャンセル
- スマートフォン・タブレットでは2タップ方式と、従来のドラッグ確定方式の両方に対応
- 「図形」から横・縦の実寸を入力して四角形を中央へ生成。4頂点を個別ドラッグして台形・不整形四辺形へ変形でき、各辺の実寸、全体移動・回転も再編集可能
- 線をタップして選択し、ドラッグで移動
- 選択時だけ表示されるパネルから長さ（mm）、色、太さ、実線・破線を編集
- 2本指のピンチでズーム、2本指で移動。PCはホイールでズーム、Space + ドラッグで移動
- 右上の「…」から新規作成、端末保存、再編集、グリッドとスナップの表示切替
- 下部の「戻る」と、その上の「やり直し」で Undo / Redo

「テンプレ」「文字」は将来の入口として配置していますが、現段階では未実装です。

## データ構造

```ts
type DrawingDocument = {
  id: string
  name: string
  updatedAt: number
  lines: DrawingLine[]
  rectangles: DrawingRectangle[]
}

type DrawingLine = {
  id: string
  start: { x: number; y: number }
  end: { x: number; y: number }
  lengthMm: number
  color: string
  width: number
  style: 'solid' | 'dashed'
}

type DrawingRectangle = {
  id: string
  points: [{ x: number; y: number }, { x: number; y: number },
           { x: number; y: number }, { x: number; y: number }]
  edgeLengthsMm: [number, number, number, number]
  rotation: number
  color: string
  width: number
}
```

座標はキャンバスの論理座標、`lengthMm` は入力された実寸値です。表示倍率・パン位置は図面データと分離しています。保存先はブラウザの `plansnap-db` IndexedDB です。

## 今後追加可能な機能

- 円・寸法線・文字
- 部屋、建具、設備などのテンプレート
- 端点・交点・等間隔スナップ
- レイヤー、複数選択、コピー
- PWAのオフラインキャッシュ強化、CapacitorによるiOS/Androidアプリ化
- JSONの入出力、画像出力、PDF出力
- 将来的な任意ログイン、クラウド同期、共同編集

課金、クラウド同期、アカウント、AI、手書き認識、PDF出力、R作図、複雑なCAD機能は今回の範囲に含めていません。
